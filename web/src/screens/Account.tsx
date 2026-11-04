import { useState, type FormEvent } from 'react';
import { ErrorNote, Source, Spinner, errorText } from '../components/ui.tsx';
import { config, shown } from '../config.ts';
import { data, type Address, type Overview } from '../data/index.ts';
import { formatUsd, parseUsdc, shortHex, USDC_DECIMALS } from '../data/money.ts';

/** Dollars to the cent, with the next two digits set lighter: yield moves in fractions of a cent. */
function Amount({ micro, fine = false }: { micro: bigint; fine?: boolean }) {
  const full = formatUsd(micro, 4);
  return (
    <>
      {full.slice(0, -2)}
      {fine ? <span className="fine">{full.slice(-2)}</span> : null}
    </>
  );
}

const pct = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 10_000n) / whole) / 100);

export function Account({
  address,
  overview,
  onChanged,
  onBridge,
}: {
  address: Address;
  overview: Overview;
  onChanged: () => Promise<void>;
  onBridge: () => void;
}) {
  const { vault, credits } = overview;
  const waiting = vault.yieldCredited > credits.credited ? vault.yieldCredited - credits.credited : 0n;

  return (
    <div className="screen">
      <header className="page-head rise">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="title">Your vault and credits</h1>
        </div>
        <p className="user-id">
          <span className="k">User id</span> <code>{overview.user}</code>
        </p>
      </header>

      <section className="ledger rise d1" aria-label="Balances">
        <div className="figure principal">
          <span className="figure-k">
            <LockIcon /> Principal
          </span>
          <span className="figure-v">
            <Amount micro={vault.principal} />
          </span>
          <span className="figure-note">Yours. Redeem it any time; it is never spent.</span>
        </div>
        <div className="figure">
          <span className="figure-k">Yield credited</span>
          <span className="figure-v">
            <Amount micro={vault.yieldCredited} fine />
          </span>
          <span className="figure-note">Attributed to you by the vault, all time</span>
        </div>
        <div className="figure accent">
          <span className="figure-k">Credits available</span>
          <span className="figure-v">
            <Amount micro={credits.available} fine />
          </span>
          <span className="figure-note">On NEAR, ready to spend on API calls</span>
        </div>
        <div className="figure">
          <span className="figure-k">Spent</span>
          <span className="figure-v">
            <Amount micro={credits.spent} fine />
          </span>
          <span className="figure-note">Debited per call, each with a receipt</span>
        </div>
      </section>

      <section className="yieldbar rise d2" aria-label="Where your yield is">
        <div className="yieldbar-head">
          <span>
            Your yield, <strong>{formatUsd(vault.yieldCredited, 4)}</strong>
          </span>
          <span className="muted">Principal is never part of this bar</span>
        </div>
        <div className="bar" role="img" aria-label={`Spent ${formatUsd(credits.spent, 4)}, available ${formatUsd(credits.available, 4)}, waiting to post ${formatUsd(waiting, 4)}`}>
          <span className="seg spent" style={{ width: `${pct(credits.spent, vault.yieldCredited)}%` }} />
          <span className="seg avail" style={{ width: `${pct(credits.available, vault.yieldCredited)}%` }} />
          <span className="seg wait" style={{ width: `${pct(waiting, vault.yieldCredited)}%` }} />
        </div>
        <ul className="legend">
          <li>
            <i className="sw spent" /> Spent {formatUsd(credits.spent, 4)}
          </li>
          <li>
            <i className="sw avail" /> Available {formatUsd(credits.available, 4)}
          </li>
          <li>
            <i className="sw wait" /> Waiting for the next post to NEAR {formatUsd(waiting, 4)}
          </li>
        </ul>
      </section>

      <div className="split">
        <VaultForm address={address} overview={overview} onChanged={onChanged} onBridge={onBridge} />

        <section className="card sources rise d4" aria-labelledby="sources-h">
          <h2 id="sources-h" className="card-title">
            Where these numbers come from
          </h2>
          <p className="card-sub">Every figure is a public read. Nothing here comes from an InferNear database; there isn’t one.</p>
          <dl className="source-list">
            <div>
              <dt>Principal</dt>
              <dd>
                <Source>Base</Source>
                <code>vault.convertToAssets(balanceOf(you))</code>
              </dd>
            </div>
            <div>
              <dt>Yield credited</dt>
              <dd>
                <Source>Base</Source>
                <code>vault.yieldCredited(you)</code>
              </dd>
            </div>
            <div>
              <dt>Credits, spent</dt>
              <dd>
                <Source>NEAR</Source>
                <code>connector.account(user id)</code>
              </dd>
            </div>
          </dl>
          <dl className="kv">
            <div>
              <dt>Vault</dt>
              <dd>
                <code>{shown(config.vaultAddress, 'VITE_VAULT_ADDRESS')}</code>
              </dd>
            </div>
            <div>
              <dt>Connector</dt>
              <dd>
                <code>{shown(config.connectorAccount, 'VITE_NEAR_CONNECTOR_ACCOUNT')}</code>
              </dd>
            </div>
          </dl>
          <p className="fineprint">
            The vault pays yield to InferNear before any balance changes. The keeper then posts each holder’s yield credited
            to NEAR, and the connector refuses to credit more than the vault has actually paid.
          </p>
        </section>
      </div>
    </div>
  );
}

function VaultForm({ address, overview, onChanged, onBridge }: { address: Address; overview: Overview; onChanged: () => Promise<void>; onBridge: () => void }) {
  const [mode, setMode] = useState<'deposit' | 'redeem'>('deposit');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ mode: string; hash: string; amount: bigint } | null>(null);

  const max = mode === 'deposit' ? overview.vault.walletUsdc : overview.vault.shares;
  const amount = parseUsdc(input);
  const invalid = input !== '' && amount === null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (amount === null) return setError('Enter a USDC amount, up to 6 decimals.');
    setBusy(true);
    setError(null);
    try {
      const tx = mode === 'deposit' ? await data.deposit(address, amount) : await data.redeem(address, amount);
      setDone({ mode, hash: tx.txHash, amount });
      setInput('');
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const toMax = () => {
    const s = (max / 10n ** BigInt(USDC_DECIMALS)).toString();
    const frac = (max % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
    setInput(frac ? `${s}.${frac}` : s);
  };

  return (
    <section className="card vault-form rise d3" aria-labelledby="vault-h">
      <div className="card-row">
        <h2 id="vault-h" className="card-title">
          Aave USDC vault · Base
        </h2>
        <div className="seg-control" role="radiogroup" aria-label="Action">
          {(['deposit', 'redeem'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => {
                setMode(m);
                setError(null);
                setDone(null);
              }}
            >
              {m === 'deposit' ? 'Deposit' : 'Redeem'}
            </button>
          ))}
        </div>
      </div>
      <p className="card-sub">
        {mode === 'deposit'
          ? 'Your USDC earns Aave yield. One share is one USDC of principal, and only you can redeem it.'
          : 'Redeem shares for your USDC principal. Yield already credited stays as credits.'}
      </p>

      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-k">
            {mode === 'deposit' ? 'Amount' : 'Shares'}
            <button type="button" className="link" onClick={toMax}>
              {mode === 'deposit' ? 'Wallet' : 'Principal'} {formatUsd(max)}
            </button>
          </span>
          <span className={`input-wrap ${invalid ? 'bad' : ''}`}>
            <input
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-invalid={invalid}
            />
            <span className="unit">{mode === 'deposit' ? 'USDC' : 'shares'}</span>
          </span>
        </label>
        <p className="preview">
          {amount !== null && amount > 0n
            ? mode === 'deposit'
              ? `You get ${formatUsd(amount).slice(1)} shares. Your wallet asks you to approve USDC first.`
              : `You receive ${formatUsd(amount)} USDC at ${shortHex(address)}.`
            : ' '}
        </p>
        <button type="submit" className="btn primary block" disabled={busy || amount === null || amount === 0n}>
          {busy ? <Spinner /> : null}
          {busy ? 'Confirm in your wallet…' : mode === 'deposit' ? 'Deposit' : 'Redeem'}
        </button>
        <ErrorNote error={error} />
        {done && (
          <p className="success" role="status">
            {done.mode === 'deposit' ? 'Deposited' : 'Redeemed'} {formatUsd(done.amount)} · <code>{shortHex(done.hash, 10, 6)}</code>
          </p>
        )}
      </form>
      <p className="fineprint">
        USDC on another chain?{' '}
        <button type="button" className="link" onClick={onBridge}>
          Bring it to Base with NEAR Intents
        </button>
      </p>
    </section>
  );
}

function LockIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
