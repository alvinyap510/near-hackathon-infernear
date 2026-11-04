import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, isAddress, parseAbi, parseAbiItem, zeroAddress, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Mutex } from '../types.ts';
import type { BridgePort, VaultPort } from '../keeper/keeper.ts';

const vaultAbi = parseAbi(['function skim()', 'function unpaid() view returns (uint256)', 'function paidTotal() view returns (uint256)', 'function yieldCredited(address) view returns (uint256)', 'function yieldToken() view returns (address)']);
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export function evmPorts(config: { rpc: string; chainId: number; key: Hex; usdc: Address; addresses: Address[]; fromBlock: bigint; oneClickUrl: string; oneClickToken?: string; originAsset: string; destinationAsset: string; recipient: string; slippageBps: number; minimumBaseUnits: bigint }): { vaults: VaultPort[]; bridge: BridgePort } {
  const chain = defineChain({ id: config.chainId, name: 'vault chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpc] } } });
  const account = privateKeyToAccount(config.key);
  const publicClient = createPublicClient({ chain, transport: http(config.rpc) });
  const wallet = createWalletClient({ chain, account, transport: http(config.rpc) });
  const signingLock = new Mutex();
  let pendingBridge: { hash: Hash; amount: string; depositAddress: string } | undefined;
  const vaults: VaultPort[] = config.addresses.map(address => {
    let nextBlock = config.fromBlock;
    const holders = new Set<Address>();
    return {
      id: `eip155:${config.chainId}:${address.toLowerCase()}`,
      async skim() {
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
          const logs = await publicClient.getLogs({ address, event: transferEvent, fromBlock: nextBlock, toBlock });
          for (const log of logs) for (const owner of [log.args.from, log.args.to]) if (owner && owner !== zeroAddress) holders.add(owner.toLowerCase() as Address);
          nextBlock = toBlock + 1n;
        }
        const read = (functionName: 'unpaid' | 'paidTotal' | 'yieldToken') => publicClient.readContract({ address, abi: vaultAbi, functionName, blockNumber });
        const [unpaid, paid, token] = await Promise.all([read('unpaid'), read('paidTotal'), read('yieldToken')]);
        if (String(token).toLowerCase() !== config.usdc.toLowerCase()) throw new Error('v1 credits require USDC yieldToken');
        const entries: [string, bigint][] = [];
        for (const owner of holders) {
          const amount = await publicClient.readContract({ address, abi: vaultAbi, functionName: 'yieldCredited', args: [owner], blockNumber });
          entries.push([`eip155:${config.chainId}:${owner}`, amount]);
        }
        return { block: blockNumber, unpaid: unpaid as bigint, paid: paid as bigint, entries };
      },
    };
  });
  const bridge: BridgePort = {
    async tick() {
      if (pendingBridge) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: pendingBridge.hash });
        const pending = pendingBridge;
        if (receipt.status !== 'success') { pendingBridge = undefined; throw new Error(`bridge deposit reverted: ${pending.hash}`); }
        const response = await fetch(config.oneClickUrl.replace(/\/$/, '') + '/v0/status?depositAddress=' + encodeURIComponent(pending.depositAddress),
          { headers: config.oneClickToken ? { authorization: `Bearer ${config.oneClickToken}` } : {} });
        if (!response.ok) throw new Error(`1Click status HTTP ${response.status}`);
        const swap = await response.json() as { status: string };
        if (['SUCCESS', 'REFUNDED', 'FAILED'].includes(swap.status)) pendingBridge = undefined;
        return { dry: false, amount: pending.amount, tx_hash: pending.hash, depositAddress: pending.depositAddress, status: swap.status };
      }
      const amount = await publicClient.readContract({ address: config.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] });
      if (amount === 0n) return { dry: true, amount: '0', status: 'empty_treasury' };
      const dry = amount < config.minimumBaseUnits;
      const response = await fetch(config.oneClickUrl.replace(/\/$/, '') + '/v0/quote', {
        method: 'POST', headers: { 'content-type': 'application/json', ...(config.oneClickToken ? { authorization: `Bearer ${config.oneClickToken}` } : {}) },
        body: JSON.stringify({ dry, swapType: 'EXACT_INPUT', slippageTolerance: config.slippageBps,
          originAsset: config.originAsset, destinationAsset: config.destinationAsset, depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN',
          amount: String(amount), recipient: config.recipient, refundTo: account.address, refundType: 'ORIGIN_CHAIN', deadline: new Date(Date.now() + 600_000).toISOString() }),
      });
      if (!response.ok) throw new Error(`1Click quote HTTP ${response.status}: ${await response.text()}`);
      const quote = await response.json() as { quote: { depositAddress?: string; amountIn: string; amountOut: string } };
      if (dry) return { dry: true, amount: String(amount), quote: quote.quote, status: 'below_minimum_quote_only' };
      const deposit = quote.quote.depositAddress;
      if (!deposit || !isAddress(deposit) || BigInt(quote.quote.amountIn) !== amount) throw new Error('Invalid 1Click deposit quote');
      const hash = await signingLock.run(async () => {
        const hash = await wallet.writeContract({ address: config.usdc, abi: erc20Abi, functionName: 'transfer', args: [deposit, amount] });
        pendingBridge = { hash, amount: String(amount), depositAddress: deposit };
        return hash;
      });
      return { dry: false, amount: String(amount), tx_hash: hash, depositAddress: deposit, status: 'deposit_broadcast' };
    },
  };
  return { vaults, bridge };
}
