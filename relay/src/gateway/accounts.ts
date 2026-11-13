import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, reportError, type Report } from '../types.ts';

// An account is identified by its UID and handle, not by a wallet. Wallets are linked to it.
// The NEAR credit ledger is not involved: balances stay per wallet id on the connector.
export type Account = { uid: string; handle: string; wallets: string[]; avatar_seed: string; created_at: number };

// Named risk for both bounds: every admission reads the ledger once per linked wallet, and anyone
// with a wallet can create an account, so neither list may grow without limit.
export const MAX_WALLETS = 4;
export const MAX_ACCOUNTS = 10_000;

const HANDLE = /^[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/;
const RESERVED = new Set(['admin', 'api', 'app', 'infernear', 'me', 'near', 'null', 'root', 'support', 'undefined']);
export const validHandle = (value: unknown): value is string => typeof value === 'string' && HANDLE.test(value) && !RESERVED.has(value);

// What each wallet signature authorises. A proof made for one statement is refused for any other.
export const statements = {
  signIn: 'Sign in to InferNear.',
  create: (handle: string) => `Create InferNear account "${handle}".`,
  invite: (handle: string) => `Add a wallet to InferNear account "${handle}".`,
  join: (handle: string) => `Link this wallet to InferNear account "${handle}".`,
  leave: (handle: string) => `Unlink this wallet from InferNear account "${handle}".`,
};

export class Accounts {
  private byUid = new Map<string, Account>();
  private byHandle = new Map<string, Account>();
  private byWallet = new Map<string, Account>();
  private queue: Promise<void> = Promise.resolve();
  private file: string;
  private now: () => number;
  private constructor(file: string, now: () => number) { this.file = file; this.now = now; }

  // The API must come up even if the registry file is damaged: an unreadable file is moved
  // aside and reported, and the relay starts with no accounts. No balance depends on this file.
  static async open(directory: string, report: Report, now: () => number = Date.now): Promise<Accounts> {
    await mkdir(directory, { recursive: true });
    const accounts = new Accounts(join(directory, 'accounts.json'), now);
    let text: string | undefined;
    try { text = await readFile(accounts.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (text !== undefined) {
      try {
        for (const account of (JSON.parse(text) as { accounts: Account[] }).accounts) accounts.index(account);
      } catch (error) {
        accounts.byUid.clear(); accounts.byHandle.clear(); accounts.byWallet.clear();
        await rename(accounts.file, `${accounts.file}.corrupt-${Math.floor(now() / 1000)}`);
        reportError(report, 'accounts_store_corrupt', error);
      }
    }
    return accounts;
  }
  private index(account: Account): void {
    this.byUid.set(account.uid, account); this.byHandle.set(account.handle, account);
    for (const wallet of account.wallets) this.byWallet.set(wallet, account);
  }

  of(wallet: string): Account | null { return this.byWallet.get(wallet) ?? null; }
  byId(uid: string): Account | null { return this.byUid.get(uid) ?? null; }

  create(handle: string, wallet: string): Promise<Account> {
    return this.change(() => {
      const existing = this.byWallet.get(wallet);
      if (existing) throw new AccountExists(existing);
      if (this.byHandle.has(handle)) throw new HttpError(409, 'handle_taken', 'That handle is taken');
      if (this.byUid.size >= MAX_ACCOUNTS) throw new HttpError(503, 'accounts_full', 'No new accounts can be created right now');
      const uid = `acc_${randomBytes(16).toString('hex')}`;
      const account: Account = { uid, handle, wallets: [wallet], avatar_seed: uid, created_at: Math.floor(this.now() / 1000) };
      this.index(account);
      return { account, undo: () => { this.byUid.delete(uid); this.byHandle.delete(handle); this.byWallet.delete(wallet); } };
    });
  }
  link(uid: string, wallet: string): Promise<Account> {
    return this.change(() => {
      const account = this.byUid.get(uid);
      if (!account) throw new HttpError(404, 'no_account', 'No such account');
      if (this.byWallet.has(wallet)) throw new HttpError(409, 'wallet_linked', 'That wallet is already in an account');
      if (account.wallets.length >= MAX_WALLETS) throw tooManyWallets();
      account.wallets.push(wallet); this.byWallet.set(wallet, account);
      return { account, undo: () => { account.wallets.pop(); this.byWallet.delete(wallet); } };
    });
  }
  unlink(wallet: string): Promise<Account> {
    return this.change(() => {
      const account = this.byWallet.get(wallet);
      if (!account) throw new HttpError(404, 'no_account', 'This wallet has no account');
      if (account.wallets.length === 1) throw new HttpError(409, 'last_wallet', 'An account keeps at least one wallet');
      const at = account.wallets.indexOf(wallet);
      account.wallets.splice(at, 1); this.byWallet.delete(wallet);
      return { account, undo: () => { account.wallets.splice(at, 0, wallet); this.byWallet.set(wallet, account); } };
    });
  }

  // Changes run one at a time: each is checked, applied and written before the next begins, so
  // two requests can never interleave and a failed write is undone exactly. The file is replaced
  // whole, so a crash leaves the old or the new copy, and memory never runs ahead of the disk.
  private change(apply: () => { account: Account; undo(): void }): Promise<Account> {
    const run = this.queue.then(async () => {
      const { account, undo } = apply();
      try {
        const temporary = `${this.file}.tmp`;
        const handle = await open(temporary, 'w');
        try { await handle.writeFile(JSON.stringify({ version: 1, accounts: [...this.byUid.values()] })); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, this.file);
      } catch { undo(); throw new HttpError(503, 'service_unavailable', 'The account could not be saved; retry'); }
      return account;
    });
    this.queue = run.then(() => {}, () => {});
    return run;
  }
}

export class AccountExists extends HttpError {
  account: Account;
  constructor(account: Account) { super(409, 'account_exists', 'This wallet already has an account'); this.account = account; }
}
export const tooManyWallets = () => new HttpError(409, 'too_many_wallets', `An account holds at most ${MAX_WALLETS} wallets`);
