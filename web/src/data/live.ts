import {
  BaseError, UserRejectedRequestError, createPublicClient, createWalletClient,
  custom, defineChain, getAddress, http, type EIP1193Provider, type Hash,
} from 'viem';
import { caip10, type LiveConfig } from '../config.ts';
import { vaultAbi, usdcAbi } from './abi.ts';
import { DataError } from './errors.ts';
import { createMockData } from './mock.ts';
import { walletProofMessage } from './proof.ts';
import type { Address, DashboardData, WalletProof } from './types.ts';

type Dependencies = {
  ethereum?: Pick<EIP1193Provider, 'request'>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};

/** JSON U128 values must remain strings until bigint parsing; JSON numbers can already have lost precision. */
function amount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    throw new DataError('near_rpc', 'NEAR returned an invalid integer amount.');
  return BigInt(value);
}

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
  const token = () => publicClient.readContract({ address: settings.vaultAddress, abi: vaultAbi, functionName: 'asset' });

  const relay = async <T>(path: string, proof?: WalletProof): Promise<T> => {
    const response = await fetcher(`${settings.relayUrl.replace(/\/$/, '')}${path}`, proof ? {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: proof.message, signature: proof.signature }),
    } : undefined);
    const body = await response.json();
    if (!response.ok) throw new DataError(body.error?.code ?? `http_${response.status}`, body.error?.message ?? `Relay request failed (${response.status}).`);
    return body as T;
  };
  const nearView = async <T>(methodName: string, args: Record<string, string>): Promise<T> => {
    const bytes = new TextEncoder().encode(JSON.stringify(args));
    const response = await fetcher(settings.nearRpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: methodName, method: 'query', params: {
        request_type: 'call_function', finality: 'final', account_id: settings.connectorAccount,
        method_name: methodName, args_base64: btoa(String.fromCharCode(...bytes)),
      } }),
    });
    const body = await response.json();
    if (!response.ok || body.error || body.result?.error)
      throw new DataError('near_rpc', body.error?.message ?? body.result?.error ?? `NEAR view failed (${response.status}).`);
    if (!Array.isArray(body.result?.result)) throw new DataError('near_rpc', 'NEAR returned no view result.');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
  };

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
      const read = { address: settings.vaultAddress, abi: vaultAbi, blockNumber } as const;
      const user = caip10(address, chain.id);
      const [shares, yieldCredited, usdc, credits] = await Promise.all([
        publicClient.readContract({ ...read, functionName: 'balanceOf', args: [address] }),
        publicClient.readContract({ ...read, functionName: 'yieldCredited', args: [address] }),
        publicClient.readContract({ ...read, functionName: 'asset' }),
        nearView<{ credited: string; spent: string; available: string; key_epoch: number }>('account', { user }),
      ]);
      const [principal, walletUsdc, allowance] = await Promise.all([
        publicClient.readContract({ ...read, functionName: 'convertToAssets', args: [shares] }),
        publicClient.readContract({ address: usdc, abi: usdcAbi, blockNumber, functionName: 'balanceOf', args: [address] }),
        publicClient.readContract({ address: usdc, abi: usdcAbi, blockNumber, functionName: 'allowance', args: [address, settings.vaultAddress] }),
      ]);
      if (!Number.isSafeInteger(credits.key_epoch) || credits.key_epoch < 0)
        throw new DataError('near_rpc', 'NEAR returned an invalid key epoch.');
      return { user, vault: { principal, shares, yieldCredited, walletUsdc, allowance }, credits: {
        credited: amount(credits.credited), spent: amount(credits.spent), available: amount(credits.available), keyEpoch: credits.key_epoch,
      } };
    }),
    deposit: (address, assets) => guarded(async () => {
      if (assets <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      const client = await readyWallet(address);
      const usdc = await token();
      const allowance = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'allowance', args: [address, settings.vaultAddress] });
      if (allowance < assets) await confirmed(await client.writeContract({
        address: usdc, abi: usdcAbi, functionName: 'approve', args: [settings.vaultAddress, assets], account: address,
      }));
      return confirmed(await client.writeContract({
        address: settings.vaultAddress, abi: vaultAbi, functionName: 'deposit', args: [assets, address], account: address,
      }));
    }),
    redeem: (address, shares) => guarded(async () => {
      if (shares <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      const client = await readyWallet(address);
      return confirmed(await client.writeContract({
        address: settings.vaultAddress, abi: vaultAbi, functionName: 'redeem', args: [shares, address, address], account: address,
      }));
    }),
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
