import { useEffect, useState, type FormEvent } from 'react';
import { HANDLE_RULE, validHandle } from '../data/accounts.ts';
import { formatUsd, shortHex } from '../data/money.ts';
import { data, DataError, type LinkTicket, type Session, type UserAccount } from '../data/index.ts';
import { CopyButton, ErrorNote, Spinner, errorText } from './ui.tsx';

/** "EVM · Base" / "NEAR" and a short form of a wallet id (`eip155:8453:0x…` or `near:mainnet:…`). */
const walletLabel = (id: string) => id.startsWith('near:mainnet:')
  ? { kind: 'NEAR', name: id.slice(13).length > 28 ? shortHex(id.slice(13), 8, 6) : id.slice(13) }
  : { kind: 'EVM · Base', name: shortHex(id.slice(id.lastIndexOf(':') + 1)) };

const LinkGlyph = () => (
  <svg className="ap-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" /></svg>
);
const waiting = <><Spinner /> Waiting for your wallet…</>;

/**
 * The account behind the connected wallet: pick a handle, see the linked wallets, link another,
 * unlink this one. It holds no state of its own beyond the form: the caller owns the account,
 * the pending link and the wallet switch, so the panel can be placed anywhere. `place` picks the
 * look: the account dropdown (`menu`), or the slim strip under the header that shows a pending
 * link on every tab (`banner`, empty when nothing is pending).
 */
export function AccountPanel({ session, account, pending, onAccount, onUnlinked, onPending, onSwitchWallet, place = 'menu' }: {
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
  place?: 'menu' | 'banner';
}) {
  const [handle, setHandle] = useState(''), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false), [checked, setChecked] = useState(false), [total, setTotal] = useState<bigint | null>(null);
  const [form, setForm] = useState(false);
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError(null);
    try { await action(); }
    catch (e) { if (e instanceof DataError && e.code === 'accounts_disabled') setDisabled(true); else setError(errorText(e)); }
    finally { setBusy(null); }
  };
  // Credits across the linked wallets, shown only when there is more than one. A failed read shows nothing.
  useEffect(() => {
    setTotal(null);
    if (place !== 'menu' || !account || account.wallets.length < 2) return;
    let stopped = false;
    void Promise.all(account.wallets.map(wallet => data.walletCredits(wallet)))
      .then(amounts => { if (!stopped) setTotal(amounts.reduce((sum, amount) => sum + amount, 0n)); }).catch(() => {});
    return () => { stopped = true; };
  }, [account, place]);
  if (disabled) return null;

  const join = () => void run('join', async () => { const next = await data.finishLink(session, pending!); onPending(null); onAccount(next); });
  const cancel = <button type="button" className="btn ghost ap-small" disabled={busy !== null} onClick={() => onPending(null)}>Cancel</button>;

  // A pending link, said the same way in the dropdown and in the strip under the header.
  if (pending) {
    const finishing = !account;
    const title = finishing
      ? <>Finish linking this wallet to <b>{pending.handle}</b></>
      : <>Connect the wallet you want to add to <b>{pending.handle}</b></>;
    const detail = finishing
      ? <>This wallet ({walletLabel(session.user).name}) will join the account <b>{pending.handle}</b>. It signs one message; no transaction is sent.</>
      : <>It will sign once to join <b>{pending.handle}</b>. The invitation lasts ten minutes.</>;
    const primary = finishing
      ? <button type="button" className="btn primary ap-small" disabled={busy !== null} onClick={join}>{busy === 'join' ? waiting : 'Link this wallet'}</button>
      : <button type="button" className="btn primary ap-small" onClick={onSwitchWallet}>Switch wallet</button>;
    if (place === 'banner') return (
      <div className="link-banner" role="status">
        <div className="link-banner-inner">
          <LinkGlyph />
          <p className="link-banner-text">{title}</p>
          {error && <span className="link-banner-error">{error}</span>}
          <div className="ap-row">{primary}{cancel}</div>
        </div>
      </div>
    );
    if (finishing) return (
      <section className="ap" aria-label="Link this wallet">
        <div className="ap-callout">
          <p className="ap-callout-h"><LinkGlyph />{title}</p>
          <p className="ap-callout-s">{detail}</p>
          <ErrorNote error={error} />
          <div className="ap-row">{primary}{cancel}</div>
        </div>
      </section>
    );
  }
  if (place === 'banner') return null;

  if (!account) {
    const typed = handle.trim().toLowerCase(), ok = validHandle(typed);
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (ok) void run('create', async () => onAccount(await data.createAccount(session, typed)));
    };
    if (!form) return (
      <section className="ap" aria-label="Account">
        <button type="button" className="ap-cta" onClick={() => setForm(true)}>
          <span className="ap-cta-plus" aria-hidden="true">+</span>
          <span className="ap-cta-text"><b>Pick a handle</b><span>Your handle names your account. Link another wallet to it later, EVM or NEAR.</span></span>
        </button>
      </section>
    );
    return (
      <section className="ap" aria-label="Pick a handle">
        <form className="ap-form" onSubmit={submit}>
          <label className="ap-k" htmlFor="ap-handle">Pick a handle</label>
          <input id="ap-handle" className="ap-input" value={handle} onChange={e => setHandle(e.target.value)} placeholder="yourname" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} aria-describedby="acct-rule" aria-invalid={typed !== '' && !ok} autoFocus />
          <p id="acct-rule" className={`ap-rule${typed && !ok ? ' bad' : ''}`}>{HANDLE_RULE}{typed && !ok ? ' That one does not fit.' : ''}</p>
          <ErrorNote error={error} />
          <button type="submit" className="btn primary ap-wide" disabled={!ok || busy !== null}>{busy === 'create' ? waiting : 'Create account'}</button>
          <button type="button" className="link ap-signin" disabled={busy !== null}
            onClick={() => void run('signin', async () => { const found = await data.accountMe(session); setChecked(true); onAccount(found); })}>
            {busy === 'signin' ? waiting : 'I already have one: sign in'}
          </button>
          {checked && <p className="ap-fine">This wallet has no account yet.</p>}
          <p className="ap-fine">Each step asks your wallet to sign a message. No transaction is sent and nothing is charged.</p>
        </form>
      </section>
    );
  }

  const full = account.wallets.length >= 4;
  return (
    <section className="ap" aria-label={`Account ${account.handle}`}>
      <div className="ap-head">
        <span className="ap-k">Linked wallets · {account.wallets.length}</span>
        <CopyButton text={account.uid} label="Copy account ID" />
      </div>
      <ul className="ap-wallets">
        {account.wallets.map(wallet => { const label = walletLabel(wallet), on = wallet === session.user; return (
          <li key={wallet} className={on ? 'on' : undefined}>
            <span className="ap-wkind">{label.kind}</span>
            <span className="ap-wid" title={wallet}>{label.name}</span>
            {on && <span className="ap-on">Connected</span>}
          </li>
        ); })}
      </ul>
      {total !== null && <p className="ap-fine">Credits across these wallets: {formatUsd(total, 4)}. Each wallet keeps its own balance on NEAR.</p>}
      <ErrorNote error={error} />
      {pending ? (
        <div className="ap-callout">
          <p className="ap-callout-h"><LinkGlyph /><span>Now connect the wallet you want to add to <b>{pending.handle}</b></span></p>
          <p className="ap-callout-s">It will sign once to join <b>{pending.handle}</b>. The invitation lasts ten minutes.</p>
          <div className="ap-row">
            {/* Takes focus when the invitation appears, so the next step is where the keyboard is. */}
            <button type="button" className="btn primary ap-small" onClick={onSwitchWallet} autoFocus>Switch wallet</button>
            {cancel}
          </div>
        </div>
      ) : (
        <div className="ap-actions">
          <button type="button" className="acct-item" disabled={full || busy !== null}
            onClick={() => void run('invite', async () => onPending(await data.startLink(session, account.handle)))}>
            <LinkGlyph />{busy === 'invite' ? waiting : 'Link another wallet'}
          </button>
          {account.wallets.length > 1 && (
            <button type="button" className="acct-item" disabled={busy !== null}
              onClick={() => void run('leave', async () => onUnlinked(await data.unlinkWallet(session, account.handle)))}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M3 3l10 10M8.2 4.3l.4-.4a2.6 2.6 0 0 1 3.7 3.7l-.4.4M7.8 11.7l-.4.4a2.6 2.6 0 0 1-3.7-3.7l.4-.4" /></svg>
              {busy === 'leave' ? waiting : 'Unlink this wallet'}
            </button>
          )}
          {full && <p className="ap-fine">An account holds at most four wallets.</p>}
        </div>
      )}
    </section>
  );
}
