// Accounts: a handle and a permanent UID, with one or more linked wallets. The registry lives in
// the relay; balances stay per wallet on the NEAR credit ledger.
import { DataError } from './errors.ts';
import type { LinkTicket, Session, UserAccount, WalletProof } from './types.ts';

/** What each wallet signature authorises. The relay refuses a proof signed for another action. */
export const ACCOUNT_STATEMENTS = {
  signIn: 'Sign in to InferNear.',
  create: (handle: string) => `Create InferNear account "${handle}".`,
  invite: (handle: string) => `Add a wallet to InferNear account "${handle}".`,
  join: (handle: string) => `Link this wallet to InferNear account "${handle}".`,
  leave: (handle: string) => `Unlink this wallet from InferNear account "${handle}".`,
};

const HANDLE = /^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/;
const RESERVED = new Set(['admin', 'api', 'app', 'infernear', 'me', 'near', 'null', 'root', 'support', 'undefined']);
export const HANDLE_RULE = '3 to 20 characters: a-z, 0-9, - and _, starting and ending with a letter or digit.';
export const validHandle = (value: string): boolean => HANDLE.test(value) && !RESERVED.has(value);

type RawAccount = { uid: string; handle: string; wallets: string[]; avatar_seed: string; created_at: number };
const raw = (account: UserAccount): RawAccount =>
  ({ uid: account.uid, handle: account.handle, wallets: account.wallets, avatar_seed: account.avatarSeed, created_at: account.createdAt });
export function parseAccount(value: unknown): UserAccount {
  const account = value as Partial<RawAccount> | null;
  if (!account || typeof account.uid !== 'string' || typeof account.handle !== 'string' || typeof account.avatar_seed !== 'string' ||
      !Number.isSafeInteger(account.created_at) || !Array.isArray(account.wallets) || !account.wallets.length || !account.wallets.every(wallet => typeof wallet === 'string'))
    throw new DataError('account', 'The relay returned an invalid account.');
  return { uid: account.uid, handle: account.handle, wallets: [...account.wallets], avatarSeed: account.avatar_seed, createdAt: account.created_at! };
}

export type AccountPorts = {
  post<T>(path: string, body: unknown): Promise<T>;
  /** One fresh wallet signature over `statement`, by the connected wallet. */
  proof(session: Session, statement: string): Promise<WalletProof>;
};
export function accountClient(ports: AccountPorts) {
  const send = async (path: string, session: Session, statement: string, extra: Record<string, unknown> = {}) =>
    ports.post<{ account?: unknown; ticket?: string; expires_at?: number }>(path, { ...extra, ...await ports.proof(session, statement) });
  return {
    /** The connected wallet's account, or null. One signature. */
    async accountMe(session: Session): Promise<UserAccount | null> {
      const { account } = await send('/accounts/me', session, ACCOUNT_STATEMENTS.signIn);
      return account == null ? null : parseAccount(account);
    },
    /** Creates the account. If this wallet already has one, the relay returns it and so does this. */
    async createAccount(session: Session, handle: string): Promise<UserAccount> {
      if (!validHandle(handle)) throw new DataError('invalid_handle', `A handle is ${HANDLE_RULE}`);
      try { return parseAccount((await send('/accounts', session, ACCOUNT_STATEMENTS.create(handle), { handle })).account); }
      catch (error) {
        const existing = error instanceof DataError && error.code === 'account_exists' ? (error.body as { account?: unknown } | undefined)?.account : undefined;
        if (existing === undefined) throw error;
        return parseAccount(existing);
      }
    },
    /** Signed by a wallet already in the account. The ticket lets one other wallet join within ten minutes. */
    async startLink(session: Session, handle: string): Promise<LinkTicket> {
      const { ticket, expires_at } = await send('/accounts/link/start', session, ACCOUNT_STATEMENTS.invite(handle), { handle });
      if (typeof ticket !== 'string' || !Number.isSafeInteger(expires_at)) throw new DataError('account', 'The relay returned an invalid link ticket.');
      return { ticket, handle, expiresAt: expires_at! };
    },
    /** Signed by the wallet being added. */
    async finishLink(session: Session, link: LinkTicket): Promise<UserAccount> {
      return parseAccount((await send('/accounts/link', session, ACCOUNT_STATEMENTS.join(link.handle), { ticket: link.ticket })).account);
    },
    /** Removes the connected wallet from its account. */
    async unlinkWallet(session: Session, handle: string): Promise<UserAccount> {
      return parseAccount((await send('/accounts/unlink', session, ACCOUNT_STATEMENTS.leave(handle), { handle })).account);
    },
  };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const safely = <T>(run: () => T, fallback: T): T => { try { return run(); } catch { return fallback; } };

/**
 * Remembers each wallet's account in this browser so a returning user sees their handle and avatar
 * before signing anything. Public data only (UID, handle, wallet ids); whatever the relay returns
 * replaces it. An entry is used only for a wallet that is listed in it.
 */
export function accountCache(storage: Store | undefined = safely(() => globalThis.localStorage, undefined)) {
  const key = (user: string) => `infernear.account.${user}`;
  return {
    read(user: string): UserAccount | null {
      return safely(() => {
        const text = storage?.getItem(key(user));
        const account = text ? parseAccount(JSON.parse(text)) : null;
        return account?.wallets.includes(user) ? account : null;
      }, null);
    },
    /** Records `account` for every wallet in it, and forgets it for `left` (a wallet just unlinked). */
    write(account: UserAccount, left?: string): void {
      safely(() => { for (const wallet of account.wallets) storage?.setItem(key(wallet), JSON.stringify(raw(account))); if (left) storage?.removeItem(key(left)); }, undefined);
    },
    forget(user: string): void { safely(() => storage?.removeItem(key(user)), undefined); },
  };
}

/**
 * The link ticket has to outlive the wallet switch between its two signatures, and nothing else:
 * it is kept for this tab only and dropped when it expires, is used or is cancelled.
 */
export function pendingLink(storage: Store | undefined = safely(() => globalThis.sessionStorage, undefined), now: () => number = Date.now) {
  const KEY = 'infernear.pending-link';
  let memory: LinkTicket | null = null;
  const clear = () => { memory = null; safely(() => storage?.removeItem(KEY), undefined); };
  return {
    get(): LinkTicket | null {
      const stored = memory ?? safely(() => { const text = storage?.getItem(KEY); return text ? JSON.parse(text) as LinkTicket : null; }, null);
      if (!stored || typeof stored.ticket !== 'string' || typeof stored.handle !== 'string' || !(stored.expiresAt * 1000 > now())) { clear(); return null; }
      return memory = stored;
    },
    set(link: LinkTicket): void { memory = link; safely(() => storage?.setItem(KEY, JSON.stringify(link)), undefined); },
    clear,
  };
}
