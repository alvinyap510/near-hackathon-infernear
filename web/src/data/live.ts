import {
  BaseError, UserRejectedRequestError, createPublicClient, createWalletClient,
  custom, defineChain, getAddress, http, type EIP1193Provider, type Hash,
} from 'viem';
import { caip10, type LiveConfig } from '../config.ts';
import { vaultAbi, usdcAbi } from './abi.ts';
import { DataError, readAmount as amount } from './errors.ts';
import { createMockData } from './mock.ts';
import { createRheaData, type NearView } from './rhea.ts';
import { walletProofMessage } from './proof.ts';
import { LOSS_NOTES, type Address, type DashboardData, type VaultAccount } from './types.ts';

type Dependencies = {
  ethereum?: Pick<EIP1193Provider, 'request'>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};

export function dataError(error: unknown): DataError {
  if (error instanceof DataError) return error;
  if ((error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError) instanceof UserRejectedRequestError) ||
      (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001))
    return new DataError('wallet_rejected', 'The request was declined in your wallet.');
  return new DataError('rpc', error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'The request failed.');
}

export function createLiveData(settings: LiveConfig, dependencies: Dependencies = {}): DashboardData {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const now = dependencies.now ?? (() => new Date());
  const chain = defineChain({
    id: settings.vaultChainId,
    name: 'Vault chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [settings.baseRpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(settings.baseRpcUrl, { fetchFn: fetcher }) });
  // These methods stay simulated until the SDK spike lands. They cannot spend live credits.
  const simulated = createMockData();

  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { throw dataError(error); }
  };
  const wallet = () => {
    const provider = dependencies.ethereum ?? (globalThis as typeof globalThis & { ethereum?: Pick<EIP1193Provider, 'request'> }).ethereum;
    if (!provider) throw new DataError('wallet_missing', 'Install or enable an injected Ethereum wallet.');
    return createWalletClient({ chain, transport: custom(provider) });
  };
  const readyWallet = async (address: Address) => {
    const client = wallet();
    const [selected] = await client.getAddresses();
    if (selected?.toLowerCase() !== address.toLowerCase())
      throw new DataError('wallet_account', 'Switch back to the connected wallet account before signing or sending.');
    if (await client.getChainId() !== chain.id) await client.switchChain({ id: chain.id });
    return client;
  };
  const confirmed = async (hash: Hash) => {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new DataError('transaction_reverted', 'The transaction reverted on-chain.');
    return { txHash: hash };
  };
  const token = (address = settings.vaultAddress) => publicClient.readContract({ address, abi: vaultAbi, functionName: 'asset' });

  const relay = async <T>(path: string, proof?: unknown): Promise<T> => {
    const response = await fetcher(`${settings.relayUrl.replace(/\/$/, '')}${path}`, proof ? {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(proof),
    } : undefined);
    const body = await response.json();
    if (!response.ok) throw new DataError(body.error?.code ?? `http_${response.status}`, body.error?.message ?? `Relay request failed (${response.status}).`);
    return body as T;
  };
  const nearView: NearView = async <T>(methodName: string, args: Record<string, unknown>, contract = settings.connectorAccount): Promise<T> => {
    const bytes = new TextEncoder().encode(JSON.stringify(args));
    const response = await fetcher(settings.nearRpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: methodName, method: 'query', params: {
        request_type: 'call_function', finality: 'final', account_id: contract,
        method_name: methodName, args_base64: btoa(String.fromCharCode(...bytes)),
      } }),
    });
    const body = await response.json();
    if (!response.ok || body.error || body.result?.error)
      throw new DataError('near_rpc', body.error?.message ?? body.result?.error ?? `NEAR view failed (${response.status}).`);
    if (!Array.isArray(body.result?.result)) throw new DataError('near_rpc', 'NEAR returned no view result.');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
  };

  const evmVaults = [
    { kind: 'aave', address: settings.vaultAddress, name: 'Aave USDC', symbol: 'USDC', decimals: 6, units: 'USDC' },
    { kind: 'rate', address: settings.rateVaultAddress, name: 'cbETH RateVault', symbol: 'cbETH', decimals: 18, units: 'ETH wei' },
    { kind: 'pendle', address: settings.pendleVaultAddress, name: 'PT-deJAAA', symbol: 'PT-deJAAA', decimals: 18, units: 'USDC-scaled18' },
  ] as const;
  const selectVault = (id?: string) => {
    const selected = id === undefined ? evmVaults[0] : evmVaults.find(vault => caip10(vault.address, chain.id) === id);
    if (!selected) throw new DataError('vault', 'Choose an EVM vault; Rhea uses its bridge and signed withdrawal methods.');
    return selected;
  };
  const rhea = createRheaData(settings, { fetch: fetcher, now, nearView, relay,
    ready: async address => { await readyWallet(address); },
    sign: async (address, message) => (await readyWallet(address)).signMessage({ account: getAddress(address), message }),
    transfer: async (address, to, assets) => {
      const client = await readyWallet(address);
      return confirmed(await client.writeContract({ address: await token(), abi: usdcAbi, functionName: 'transfer', args: [to, assets], account: address }));
    },
  });

  return {
    isMock: false,
    isRunMock: true,
    connect: () => guarded(async () => {
      const client = wallet();
      const [address] = await client.requestAddresses();
      if (!address) throw new DataError('wallet_account', 'The wallet returned no account.');
      if (await client.getChainId() !== chain.id) await client.switchChain({ id: chain.id });
      return address.toLowerCase() as Address;
    }),
    overview: (address) => guarded(async () => {
      // Use one Base block so the redemption preview refers to the shares displayed.
      const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
      const user = caip10(address, chain.id);
      const [vaults, credits, rheaPosition, coverage, busy, intentsBalance] = await Promise.all([
        Promise.all(evmVaults.map(async (vault): Promise<VaultAccount> => {
          const read = { address: vault.address, abi: vaultAbi, blockNumber } as const;
          const [shares, yieldCredited, asset, yieldToken] = await Promise.all([
            publicClient.readContract({ ...read, functionName: 'balanceOf', args: [address] }),
            publicClient.readContract({ ...read, functionName: 'yieldCredited', args: [address] }),
            publicClient.readContract({ ...read, functionName: 'asset' }),
            publicClient.readContract({ ...read, functionName: 'yieldToken' }),
          ]);
          const [principal, walletBalance, allowance] = await Promise.all([
            publicClient.readContract({ ...read, functionName: 'convertToAssets', args: [shares] }),
            publicClient.readContract({ address: asset, abi: usdcAbi, blockNumber, functionName: 'balanceOf', args: [address] }),
            publicClient.readContract({ address: asset, abi: usdcAbi, blockNumber, functionName: 'allowance', args: [address, vault.address] }),
          ]);
          return { id: caip10(vault.address, chain.id), kind: vault.kind, name: vault.name,
            chain: { id: `eip155:${chain.id}`, name: 'Base' }, asset: { address: asset, symbol: vault.symbol, decimals: vault.decimals },
            yieldToken: { address: yieldToken, symbol: vault.symbol, decimals: vault.decimals }, unitsLabel: vault.units,
            lossNote: LOSS_NOTES[vault.kind],
            ...(vault.kind === 'pendle' ? { buyUrl: settings.pendleAppUrl } : {}),
            position: { principal, shares, yieldCredited, walletBalance, allowance } };
        })),
        nearView<{ credited: string; spent: string; available: string; key_epoch: number }>('account', { user }),
        nearView<{ principal: string; yield_credited: string; pending_in: string; pending_out: string | null }>('position', { user }, settings.rheaVaultAccount),
        nearView<string>('coverage', {}, settings.rheaVaultAccount),
        nearView<boolean>('busy', {}, settings.rheaVaultAccount),
        nearView<string>('mt_balance_of', { account_id: address.toLowerCase(), token_id: `nep141:${settings.nearUsdcAccount}` }, settings.intentsAccount),
      ]);
      if (!Number.isSafeInteger(credits.key_epoch) || credits.key_epoch < 0 || typeof busy !== 'boolean')
        throw new DataError('near_rpc', 'NEAR returned invalid account state.');
      const rheaToken = { address: settings.nearUsdcAccount, symbol: 'USDC', decimals: 6 } as const;
      vaults.push({ id: `near:mainnet:${settings.rheaVaultAccount}`, kind: 'rhea', name: 'Rhea USDC', chain: { id: 'near:mainnet', name: 'NEAR' },
        asset: rheaToken, yieldToken: rheaToken, unitsLabel: 'USDC', lossNote: LOSS_NOTES.rhea,
        position: { principal: amount(rheaPosition.principal) * amount(coverage) / (10n ** 18n), shares: amount(rheaPosition.principal),
          yieldCredited: amount(rheaPosition.yield_credited), walletBalance: vaults[0].position.walletBalance, allowance: 0n,
          rhea: { pendingIn: amount(rheaPosition.pending_in), pendingOut: rheaPosition.pending_out === null ? null : amount(rheaPosition.pending_out),
            coverage: amount(coverage), busy, intentsBalance: amount(intentsBalance) } } });
      return { user, vaults, vault: { ...vaults[0].position, walletUsdc: vaults[0].position.walletBalance }, credits: {
        credited: amount(credits.credited), spent: amount(credits.spent), available: amount(credits.available), keyEpoch: credits.key_epoch,
      } };
    }),
    deposit: (address, assets, vaultId) => guarded(async () => {
      if (assets <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      const client = await readyWallet(address);
      const selected = selectVault(vaultId);
      const usdc = await token(selected.address);
      const allowance = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'allowance', args: [address, selected.address] });
      if (allowance < assets) await confirmed(await client.writeContract({
        address: usdc, abi: usdcAbi, functionName: 'approve', args: [selected.address, assets], account: address,
      }));
      return confirmed(await client.writeContract({
        address: selected.address, abi: vaultAbi, functionName: 'deposit', args: [assets, address], account: address,
      }));
    }),
    redeem: (address, shares, vaultId) => guarded(async () => {
      if (shares <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      const client = await readyWallet(address);
      const selected = selectVault(vaultId);
      return confirmed(await client.writeContract({
        address: selected.address, abi: vaultAbi, functionName: 'redeem', args: [shares, address, address], account: address,
      }));
    }),
    rheaQuote: (...args) => guarded(() => rhea.rheaQuote(...args)),
    rheaDeposit: (...args) => guarded(() => rhea.rheaDeposit(...args)),
    rheaWithdraw: (...args) => guarded(() => rhea.rheaWithdraw(...args)),
    rheaExit: (...args) => guarded(() => rhea.rheaExit(...args)),
    rheaStatus: (...args) => guarded(() => rhea.rheaStatus(...args)),
    walletProof: (address) => guarded(async () => {
      const client = await readyWallet(address);
      const { nonce } = await relay<{ nonce: string }>('/auth/nonce');
      const message = walletProofMessage(address, nonce, settings.relayUrl, chain.id, now());
      return { message, signature: await client.signMessage({ account: getAddress(address), message }) };
    }),
    createKey: (proof) => guarded(async () => {
      const result = await relay<{ key: string; key_epoch: number; expires_at: number }>('/keys', proof);
      return { key: result.key, keyEpoch: result.key_epoch, expiresAt: new Date(result.expires_at * 1000).toISOString() };
    }),
    revokeAll: (proof) => guarded(async () => {
      const result = await relay<{ key_epoch: number; tx_hash: string }>('/keys/revoke', proof);
      return { keyEpoch: result.key_epoch, txHash: result.tx_hash };
    }),
    debitedAmount: (id) => guarded(async () => {
      const result = await nearView<string | null>('debited_amount', { inference_id: id });
      return result === null ? null : amount(result);
    }),
    models: simulated.models,
    run: simulated.run,
    bridgeChains: simulated.bridgeChains,
    bridgeQuote: simulated.bridgeQuote,
  };
}
