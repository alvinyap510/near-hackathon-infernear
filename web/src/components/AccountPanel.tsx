import { useEffect, useState, type FormEvent } from 'react';
import { HANDLE_RULE, validHandle } from '../data/accounts.ts';
import { formatUsd, shortHex } from '../data/money.ts';
import { data, DataError, type LinkTicket, type Session, type UserAccount } from '../data/index.ts';
import { CopyButton, ErrorNote, Spinner, errorText } from './ui.tsx';

/** "EVM · Base" / "NEAR" and a short form of a wallet id (`eip155:8453:0x…` or `near:mainnet:…`). */
const walletLabel = (id: string) => id.startsWith('near:mainnet:')
  ? { kind: 'NEAR', name: id.slice(13).length > 28 ? shortHex(id.slice(13), 8, 6) : id.slice(13) }
  : { kind: 'EVM · Base', name: shortHex(id.slice(id.lastIndexOf(':') + 1)) };

/**
 * The account behind the connected wallet: pick a handle, see the linked wallets, link another,
 * unlink this one. It holds no state of its own beyond the form: the caller owns the account,
 * the pending link and the wallet switch, so the panel can be placed anywhere.
 */
export function AccountPanel({ session, account, pending, onAccount, onUnlinked, onPending, onSwitchWallet }: {
  session: Session;
  /** The connected wallet's account, as far as this browser knows; null when none is known. */
  account: UserAccount | null;
  /** An invitation signed by another wallet of the account, waiting for the wallet being added. */
  pending: LinkTicket | null;
  /** The relay's answer for the connected wallet: its account, or null when it has none. */
  onAccount(account: UserAccount | null): void;
  /** The connected wallet has left; `rest` is the account it left, as it is now. */
  onUnlinked(rest: UserAccount): void;
  onPending(link: LinkTicket | null): void;
  onSwitchWallet(): void;
}) {
  const [handle, setHandle] = useState(''), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false), [checked, setChecked] = useState(false), [total, setTotal] = useState<bigint | null>(null);
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError(null);
    try { await action(); }
    catch (e) { if (e instanceof DataError && e.code === 'accounts_disabled') setDisabled(true); else setError(errorText(e)); }
    finally { setBusy(null); }
  };
  // Credits across the linked wallets, shown only when there is more than one. A failed read shows nothing.
  useEffect(() => {
    setTotal(null);
    if (!account || account.wallets.length < 2) return;
    let stopped = false;
    void Promise.all(account.wallets.map(wallet => data.walletCredits(wallet)))
      .then(amounts => { if (!stopped) setTotal(amounts.reduce((sum, amount) => sum + amount, 0n)); }).catch(() => {});
    return () => { stopped = true; };
  }, [account]);
  if (disabled) return null;

  // The wallet being added has connected: one signature finishes the link.
  if (pending && !account) return (
    <section className="card rise" aria-labelledby="acct-h">
      <h2 id="acct-h" className="card-title">Finish linking to {pending.handle}</h2>
      <p className="card-sub">This wallet ({walletLabel(session.user).name}) will join the account <b>{pending.handle}</b>. It signs one message; no transaction is sent.</p>
      <ErrorNote error={error} />
      <div className="confirm">
        <button type="button" className="btn primary" disabled={busy !== null}
          onClick={() => void run('join', async () => { const next = await data.finishLink(session, pending); onPending(null); onAccount(next); })}>
          {busy === 'join' ? <><Spinner /> Waiting for your wallet…</> : 'Link this wallet'}
        </button>
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => onPending(null)}>Cancel</button>
      </div>
    </section>
  );

  if (!account) {
    const typed = handle.trim().toLowerCase(), ok = validHandle(typed);
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (ok) void run('create', async () => onAccount(await data.createAccount(session, typed)));
    };
    return (
      <section className="card rise" aria-labelledby="acct-h">
        <h2 id="acct-h" className="card-title">Pick a handle</h2>
        <p className="card-sub">Your handle names your account. You can link another wallet to it later, EVM or NEAR, and keep one identity.</p>
        <form onSubmit={submit}>
          <label className="field"><span className="field-k">Handle</span>
            <span className="input-wrap"><input value={handle} onChange={e => setHandle(e.target.value)} placeholder="yourname" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} aria-describedby="acct-rule" /></span>
          </label>
          <p id="acct-rule" className="fineprint">{HANDLE_RULE}{typed && !ok ? ' That one does not fit.' : ''}</p>
          <ErrorNote error={error} />
          <div className="confirm">
            <button type="submit" className="btn primary" disabled={!ok || busy !== null}>{busy === 'create' ? <><Spinner /> Waiting for your wallet…</> : 'Create account'}</button>
            <button type="button" className="btn ghost" disabled={busy !== null}
              onClick={() => void run('signin', async () => { const found = await data.accountMe(session); setChecked(true); onAccount(found); })}>
              {busy === 'signin' ? <><Spinner /> Waiting for your wallet…</> : 'I already have one: sign in'}
            </button>
          </div>
          {checked && <p className="fineprint">This wallet has no account yet.</p>}
          <p className="fineprint">Each step asks your wallet to sign a message. No transaction is sent and nothing is charged.</p>
        </form>
      </section>
    );
  }

  const full = account.wallets.length >= 4;
  return (
    <section className="card rise" aria-labelledby="acct-h">
      <div className="card-row"><h2 id="acct-h" className="card-title">{account.handle}</h2><CopyButton text={account.uid} label="Copy account ID" /></div>
      <p className="card-sub">Account ID {shortHex(account.uid, 10, 6)} · {account.wallets.length === 1 ? '1 wallet' : `${account.wallets.length} wallets`}</p>
      <ul className="kv">
        {account.wallets.map(wallet => { const label = walletLabel(wallet); return (
          <li key={wallet}><span>{label.kind}</span><span title={wallet}>{label.name}{wallet === session.user && <> <span className="badge">Connected</span></>}</span></li>
        ); })}
      </ul>
      {total !== null && <p className="fineprint">Credits across these wallets: {formatUsd(total, 4)}. Each wallet keeps its own balance on NEAR.</p>}
      <ErrorNote error={error} />
      {pending ? (
        <div className="needs-key">
          <p>Now connect the wallet you want to add. It will sign once to join <b>{pending.handle}</b>. The invitation lasts ten minutes.</p>
          <div className="confirm">
            <button type="button" className="btn primary" onClick={onSwitchWallet}>Switch wallet</button>
            <button type="button" className="btn ghost" onClick={() => onPending(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="confirm">
          <button type="button" className="btn primary" disabled={full || busy !== null}
            onClick={() => void run('invite', async () => onPending(await data.startLink(session, account.handle)))}>
            {busy === 'invite' ? <><Spinner /> Waiting for your wallet…</> : 'Link another wallet'}
          </button>
          {account.wallets.length > 1 && (
            <button type="button" className="btn ghost" disabled={busy !== null}
              onClick={() => void run('leave', async () => onUnlinked(await data.unlinkWallet(session, account.handle)))}>
              {busy === 'leave' ? <><Spinner /> Waiting for your wallet…</> : 'Unlink this wallet'}
            </button>
          )}
        </div>
      )}
      {full && <p className="fineprint">An account holds at most four wallets.</p>}
    </section>
  );
}
