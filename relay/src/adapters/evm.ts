import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, erc20Abi, http, isAddress, parseAbi, parseAbiItem, zeroAddress, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Mutex } from '../types.ts';
import { RateUnavailable, type BridgePort, type VaultPort } from '../keeper/keeper.ts';

const vaultAbi = parseAbi(['function skim()', 'function unpaid() view returns (uint256)', 'function paidTotal() view returns (uint256)', 'function yieldCredited(address) view returns (uint256)', 'function yieldToken() view returns (address)']);
const feedAbi = parseAbi(['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)']);
const oracleAbi = parseAbi(['function getPtToAssetRate(address market, uint32 duration) view returns (uint256)']);
// `topup` is the CreditTopUp contract: credits bought with USDC, read and posted like a vault's paid yield.
export type EvmVaultConfig = { address: Address } & ({ kind: 'aave' } | { kind: 'rate'; feed: Address; heartbeat: number } | { kind: 'pendle'; market: Address; oracle: Address } | { kind: 'topup' });
export type BridgeToken = { token: Address; originAsset: string; minimumBaseUnits: string };

// Canonical Multicall3. One eth_call runs paidTotal, skim, paidTotal in sequence, so the
// difference is exactly what skim() would pay out now, without sending a transaction.
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const multicallAbi = parseAbi(['struct Call3 { address target; bool allowFailure; bytes callData; }', 'struct Result { bool success; bytes returnData; }', 'function aggregate3(Call3[] calls) payable returns (Result[] returnData)']);

const topUpAbi = parseAbi(['function paid(address) view returns (uint256)', 'function paidTotal() view returns (uint256)', 'function usdc() view returns (address)']);
const paidEvent = parseAbiItem('event Paid(address indexed payer, address indexed beneficiary, uint256 amount)');
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export function evmPorts(config: { rpc: string; chainId: number; key: Hex; vaults: EvmVaultConfig[]; fromBlock: bigint; oneClickUrl: string; oneClickToken?: string; bridgeTokens: BridgeToken[]; destinationAsset: string; recipient: string; slippageBps: number; minYieldMicro: bigint; now?: () => number }): { vaults: VaultPort[]; bridge: BridgePort } {
  const chain = defineChain({ id: config.chainId, name: 'vault chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpc] } } });
  const account = privateKeyToAccount(config.key);
  const publicClient = createPublicClient({ chain, transport: http(config.rpc) });
  const wallet = createWalletClient({ chain, account, transport: http(config.rpc) });
  const signingLock = new Mutex();
  const pendingBridges = new Map<string, { hash: Hash; amount: string; depositAddress: string }>();
  // A refunded or failed swap already cost gas and fees. Wait 1, 2, 4... hours (at most a day) before the next one.
  const failedBridges = new Map<string, { failures: number; until: number }>();
  const now = config.now ?? Date.now;
  const yieldTokens = new Set<Address>();
  const vaults: VaultPort[] = config.vaults.map(entry => {
    if (!['aave', 'rate', 'pendle', 'topup'].includes(entry.kind)) throw new Error('Invalid EVM vault kind');
    const address = entry.address;
    let nextBlock = config.fromBlock;
    const holders = new Set<Address>();
    return {
      id: `eip155:${config.chainId}:${address.toLowerCase()}`, kind: entry.kind,
      async skim() {
        if (entry.kind === 'topup') return;
        await signingLock.run(async () => {
          const hash = await wallet.writeContract({ address, abi: vaultAbi, functionName: 'skim' });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (receipt.status !== 'success') throw new Error(`skim reverted: ${hash}`);
        });
      },
      async snapshot() {
        const block = await publicClient.getBlock({ blockTag: 'finalized' });
        const blockNumber = block.number;
        // Event scans start at deployment; chunking avoids RPC log-range limits, not archive-state reads.
        while (nextBlock <= blockNumber) {
          const toBlock = nextBlock + 1999n < blockNumber ? nextBlock + 1999n : blockNumber;
          if (entry.kind === 'topup') {
            for (const log of await publicClient.getLogs({ address, event: paidEvent, fromBlock: nextBlock, toBlock })) if (log.args.beneficiary) holders.add(log.args.beneficiary.toLowerCase() as Address);
          } else {
            const logs = await publicClient.getLogs({ address, event: transferEvent, fromBlock: nextBlock, toBlock });
            for (const log of logs) for (const owner of [log.args.from, log.args.to]) if (owner && owner !== zeroAddress) holders.add(owner.toLowerCase() as Address);
          }
          nextBlock = toBlock + 1n;
        }
        if (entry.kind === 'topup') {
          // A purchase is paid in full when it is made: nothing is ever unpaid, and there is nothing to skim.
          const [paid, token] = await Promise.all([publicClient.readContract({ address, abi: topUpAbi, functionName: 'paidTotal', blockNumber }), publicClient.readContract({ address, abi: topUpAbi, functionName: 'usdc', blockNumber })]);
          yieldTokens.add(token.toLowerCase() as Address);
          const entries: [string, bigint][] = [];
          for (const owner of holders) entries.push([`eip155:${config.chainId}:${owner}`, await publicClient.readContract({ address, abi: topUpAbi, functionName: 'paid', args: [owner], blockNumber })]);
          return { block: blockNumber, unpaid: 0n, paid, rate: 1_000_000_000_000_000_000n, entries, work: null };
        }
        const read = (functionName: 'unpaid' | 'paidTotal' | 'yieldToken') => publicClient.readContract({ address, abi: vaultAbi, functionName, blockNumber });
        const [unpaid, paid, token] = await Promise.all([read('unpaid'), read('paidTotal'), read('yieldToken')]);
        yieldTokens.add(String(token).toLowerCase() as Address);
        let rate = 1_000_000_000_000_000_000n;
        try {
          if (entry.kind === 'rate') {
            const [, answer,, updatedAt] = await publicClient.readContract({ address: entry.feed, abi: feedAbi, functionName: 'latestRoundData', blockNumber });
            if (answer <= 0n) throw new RateUnavailable('nonpositive_feed');
            if (block.timestamp - updatedAt > BigInt(entry.heartbeat)) throw new RateUnavailable('stale_feed');
            rate = answer / 100n; // cbETH/USD's 8 dp -> micro-USD per cbETH (1e18 wei).
          } else if (entry.kind === 'pendle') {
            const answer = await publicClient.readContract({ address: entry.oracle, abi: oracleAbi, functionName: 'getPtToAssetRate', args: [entry.market, 900], blockNumber });
            if (answer <= 0n) throw new RateUnavailable('nonpositive_feed');
            rate = answer / 1_000_000_000_000n;
          }
        } catch (error) { if (error instanceof RateUnavailable) throw error; throw new RateUnavailable('feed_read_failed'); }
        const entries: [string, bigint][] = [];
        for (const owner of holders) {
          const amount = await publicClient.readContract({ address, abi: vaultAbi, functionName: 'yieldCredited', args: [owner], blockNumber });
          entries.push([`eip155:${config.chainId}:${owner}`, amount]);
        }
        // skim() is worth its gas only once the yield it pays out reaches the configured USD value.
        // If the simulation fails (say the strategy is paused), there is nothing to send, and the
        // finalized entries above must still be posted.
        let work: string | null = null;
        try {
          const paidTotal = encodeFunctionData({ abi: vaultAbi, functionName: 'paidTotal' });
          const { result } = await publicClient.simulateContract({ address: MULTICALL3, abi: multicallAbi, functionName: 'aggregate3',
            args: [[paidTotal, encodeFunctionData({ abi: vaultAbi, functionName: 'skim' }), paidTotal].map(callData => ({ target: address, allowFailure: false, callData }))] });
          const payable = BigInt(result[2].returnData) - BigInt(result[0].returnData);
          if (payable * rate / 1_000_000_000_000_000_000n >= config.minYieldMicro) work = 'yield';
        } catch { /* no skim this pass */ }
        return { block: blockNumber, unpaid: unpaid as bigint, paid: paid as bigint, rate, entries, work };
      },
    };
  });
  async function bridgeToken(token: BridgeToken) {
    const tokenKey = token.token.toLowerCase();
    const pendingBridge = pendingBridges.get(tokenKey);
    if (pendingBridge) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: pendingBridge.hash });
      const pending = pendingBridge;
      if (receipt.status !== 'success') { pendingBridges.delete(tokenKey); throw new Error(`bridge deposit reverted: ${pending.hash}`); }
      const response = await fetch(config.oneClickUrl.replace(/\/$/, '') + '/v0/status?depositAddress=' + encodeURIComponent(pending.depositAddress),
        { headers: config.oneClickToken ? { authorization: `Bearer ${config.oneClickToken}` } : {} });
      if (!response.ok) throw new Error(`1Click status HTTP ${response.status}`);
      const swap = await response.json() as { status: string };
      if (['SUCCESS', 'REFUNDED', 'FAILED'].includes(swap.status)) pendingBridges.delete(tokenKey);
      if (swap.status === 'SUCCESS') failedBridges.delete(tokenKey);
      else if (swap.status !== 'PROCESSING' && !pendingBridges.has(tokenKey)) {
        const failures = (failedBridges.get(tokenKey)?.failures ?? 0) + 1;
        failedBridges.set(tokenKey, { failures, until: now() + Math.min(3_600_000 * 2 ** (failures - 1), 86_400_000) });
      }
      return { dry: false, amount: pending.amount, tx_hash: pending.hash, depositAddress: pending.depositAddress, status: swap.status };
    }
    const amount = await publicClient.readContract({ address: token.token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
    if (amount === 0n) return { dry: true, amount: '0', status: 'empty_treasury' };
    if (now() < (failedBridges.get(tokenKey)?.until ?? 0)) return { dry: true, amount: String(amount), status: 'waiting_after_failed_swap' };
    const dry = amount < BigInt(token.minimumBaseUnits);
    const response = await fetch(config.oneClickUrl.replace(/\/$/, '') + '/v0/quote', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(config.oneClickToken ? { authorization: `Bearer ${config.oneClickToken}` } : {}) },
      body: JSON.stringify({ dry, swapType: 'EXACT_INPUT', slippageTolerance: config.slippageBps,
        originAsset: token.originAsset, destinationAsset: config.destinationAsset, depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN',
        amount: String(amount), recipient: config.recipient, refundTo: account.address, refundType: 'ORIGIN_CHAIN', deadline: new Date(Date.now() + 600_000).toISOString() }),
    });
    if (!response.ok) throw new Error(`1Click quote HTTP ${response.status}: ${await response.text()}`);
    const quote = await response.json() as { quote: { depositAddress?: string; amountIn: string; amountOut: string } };
    if (dry) return { dry: true, amount: String(amount), quote: quote.quote, status: 'below_minimum_quote_only' };
    const deposit = quote.quote.depositAddress;
    if (!deposit || !isAddress(deposit) || BigInt(quote.quote.amountIn) !== amount) throw new Error('Invalid 1Click deposit quote');
    const hash = await signingLock.run(async () => {
      const hash = await wallet.writeContract({ address: token.token, abi: erc20Abi, functionName: 'transfer', args: [deposit, amount] });
      pendingBridges.set(tokenKey, { hash, amount: String(amount), depositAddress: deposit });
      return hash;
    });
    return { dry: false, amount: String(amount), tx_hash: hash, depositAddress: deposit, status: 'deposit_broadcast' };
  }
  const bridge: BridgePort = {
    async tick() {
      const tokens: Record<string, unknown>[] = [];
      const configured = new Set(config.bridgeTokens.map(token => token.token.toLowerCase()));
      for (const token of config.bridgeTokens) tokens.push({ token: token.token, ...await bridgeToken(token) });
      for (const token of yieldTokens) if (!configured.has(token)) tokens.push({ token, status: 'held_unconfigured' });
      return { tokens };
    },
  };
  return { vaults, bridge };
}
