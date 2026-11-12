import type { EIP1193Provider } from 'viem';
import type { WalletSelector, Wallet, InjectedWallet } from '@near-wallet-selector/core';
import { config } from '../config.ts';
import { DataError } from './errors.ts';
import type { Session, WalletOption } from './types.ts';

export type InjectedProvider = Pick<EIP1193Provider, 'request'>;
export type Wallets = ReturnType<typeof createWallets>;
export type WalletDependencies = {
  target?: EventTarget;
  ethereum?: InjectedProvider;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  selector?: () => Promise<WalletSelector>;
};

export function createWallets(settings: { vaultChainId: number; rheaVaultAccount: string; nearRpcUrl?: string }, deps: WalletDependencies = {}) {
  const target = deps.target ?? (typeof window === 'undefined' ? undefined : window);
  const storage = deps.storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  const providers = new Map<string, { provider: InjectedProvider; info: { name: string; icon?: string } }>();
  let selectedProvider: InjectedProvider | undefined;
  let session: Session | null = null;
  let selectedNearId: string | undefined;
  let selectorPromise: Promise<WalletSelector> | undefined;
  const fallback = () => deps.ethereum ?? (globalThis as typeof globalThis & { ethereum?: InjectedProvider }).ethereum;
  const selector = () => selectorPromise ??= (deps.selector ? deps.selector() : (async () => {
    const [{ setupWalletSelector }, { setupMeteorWallet }] = await Promise.all([
      import('@near-wallet-selector/core'), import('@near-wallet-selector/meteor-wallet'),
    ]);
    return setupWalletSelector({ network: 'mainnet', modules: [setupMeteorWallet()], debug: false });
  })());
  target?.addEventListener('eip6963:announceProvider', (event) => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail?.info?.rdns !== 'string' || typeof detail.info.name !== 'string' || typeof detail.provider?.request !== 'function') return;
    const id = `evm:${detail.info.rdns}`;
    if (!providers.has(id)) providers.set(id, { provider: detail.provider, info: detail.info });
  });
  const discover = () => target?.dispatchEvent(new Event('eip6963:requestProvider'));
  discover();
  const save = (id: string, next: Session) => { storage?.setItem('infernear.wallet', id); session = next; return next; };
  const evmSession = (address: string): Session => ({ kind: 'evm', address: address.toLowerCase() as `0x${string}`, user: `eip155:${settings.vaultChainId}:${address.toLowerCase()}` });
  const nearSession = (accountId: string): Session => ({ kind: 'near', accountId, user: `near:mainnet:${accountId}` });
  return {
    async walletOptions(): Promise<WalletOption[]> {
      discover();
      const evm: WalletOption[] = [...providers].map(([id, { info }]) => ({ id, kind: 'evm', name: info.name, icon: info.icon, available: true }));
      if (!evm.length && fallback()) evm.push({ id: 'evm:injected', kind: 'evm', name: 'Injected EVM wallet', available: true });
      // The NEAR wallet code loads on demand; if that fails, the EVM wallets are still offered.
      let state;
      try { state = (await selector()).store.getState(); }
      catch { selectorPromise = undefined; return evm; }
      return [...evm, ...state.modules.map(module => ({ id: `near:${module.id}`, kind: 'near' as const, name: module.metadata.name,
        icon: module.metadata.iconUrl, available: module.metadata.available,
        installUrl: 'downloadUrl' in module.metadata ? String(module.metadata.downloadUrl) : undefined }))];
    },
    async connectWallet(id: string): Promise<Session> {
      if (id.startsWith('evm:')) {
        discover();
        const provider = id === 'evm:injected' ? fallback() : providers.get(id)?.provider;
        if (!provider) throw new DataError('wallet_missing', 'The selected EVM wallet is unavailable.');
        if (!Number.isSafeInteger(settings.vaultChainId) || settings.vaultChainId <= 0) throw new DataError('config', 'Configure the vault chain before connecting.');
        const accounts = await provider.request({ method: 'eth_requestAccounts' });
        if (!accounts[0]) throw new DataError('wallet_account', 'The wallet returned no account.');
        selectedProvider = provider; selectedNearId = undefined;
        return save(id, evmSession(accounts[0]));
      }
      if (!id.startsWith('near:')) throw new DataError('wallet_missing', 'Unknown wallet.');
      const wallet = await (await selector()).wallet<InjectedWallet>(id.slice(5));
      // No function-call access key is requested. Every transaction stays in the wallet.
      const previous = storage?.getItem('infernear.wallet');
      storage?.setItem('infernear.wallet', id); // Survives wallets that navigate away during sign-in.
      let accounts;
      try { accounts = await wallet.signIn({}); }
      catch (error) { if (previous) storage?.setItem('infernear.wallet', previous); else storage?.removeItem('infernear.wallet'); throw error; }
      if (!accounts?.[0]) throw new DataError('wallet_redirect', 'Continue in your wallet, then return to restore your account.');
      selectedProvider = undefined; selectedNearId = id.slice(5);
      return save(id, nearSession(accounts[0].accountId));
    },
    async restoreSession(): Promise<Session | null> {
      const id = storage?.getItem('infernear.wallet');
      if (id === 'disconnected') return session = null;
      if (id?.startsWith('evm:')) {
        discover(); selectedProvider = id === 'evm:injected' ? fallback() : providers.get(id)?.provider;
        const accounts = await selectedProvider?.request({ method: 'eth_accounts' });
        return session = accounts?.[0] ? evmSession(accounts[0]) : null;
      }
      const select = await selector(), state = select.store.getState();
      const walletId = id?.startsWith('near:') ? id.slice(5) : state.selectedWalletId ?? undefined;
      if (!walletId) return session = null;
      const accounts = await (await select.wallet(walletId)).getAccounts();
      const account = accounts.find(account => state.accounts.some(a => a.active && a.accountId === account.accountId)) ?? accounts[0];
      if (!account) return session = null;
      selectedNearId = walletId;
      return save(`near:${walletId}`, nearSession(account.accountId));
    },
    async disconnect(): Promise<void> {
      if (session?.kind === 'near') await (await (await selector()).wallet(selectedNearId)).signOut();
      selectedProvider = undefined; selectedNearId = undefined; session = null; storage?.setItem('infernear.wallet', 'disconnected');
    },
    evmProvider(): InjectedProvider | undefined { return selectedProvider ?? fallback(); },
    async nearWallet(accountId: string): Promise<Wallet> {
      const wallet = await (await selector()).wallet(selectedNearId);
      if (!(await wallet.getAccounts()).some(account => account.accountId === accountId))
        throw new DataError('wallet_account', 'Switch back to the connected NEAR account before signing.');
      return wallet;
    },
  };
}

const wallets = createWallets({ vaultChainId: Number(config.vaultChainId), rheaVaultAccount: config.rheaVaultAccount ?? '', nearRpcUrl: config.nearRpcUrl });
export const walletOptions = () => wallets.walletOptions();
export const connectWallet = (id: string) => wallets.connectWallet(id);
export const restoreSession = () => wallets.restoreSession();
export const disconnect = () => wallets.disconnect();
export const defaultWallets = wallets;
