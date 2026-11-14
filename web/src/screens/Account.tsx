import { useState, type FormEvent } from 'react';
import { AssetBadge, ChainBadge, ErrorNote, LockIcon, Source, Spinner, errorText, plainAmount, tokenAmount } from '../components/ui.tsx';
import { data, type Session, type Overview, type Token, type VaultAccount, type VaultKind } from '../data/index.ts';
import { formatUsd, parseAmount, shortHex } from '../data/money.ts';
import { RheaPanel } from './Rhea.tsx';
import { NativeRhea } from './NativeRhea.tsx';
import { TopUp } from './TopUp.tsx';
import { config } from '../config.ts';

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

/** What each strategy is, in plain words. The loss note itself comes with the vault's data. */
const ABOUT: Record<VaultKind, string> = {
  aave: 'Lends USDC on Aave v3 on Base. Interest grows the position; only the part above your principal becomes credits.',
  rate: 'cbETH is Coinbase’s liquid-staking ETH. Its value in ETH rises as staking rewards accrue, so principal is counted in ETH.',
  pendle: 'PT-deJAAA is a Pendle principal token on a Centrifuge AAA-rated CLO note. It accretes towards its USDC value at expiry on 26 Nov 2026.',
  rhea: 'Lends USDC through the InferNear vault on NEAR. EVM wallets bridge from Base; NEAR wallets use native USDC.',
};

export function Account({
  session, selectedId, onSelect, onConnect,
  overview,
  onChanged,
  onBridge,
}: {
  session: Session;
  selectedId?: string;
  onSelect(id:string): void;
  onConnect(): void;
  overview: Overview;
  onChanged: () => Promise<void>;
  onBridge: () => void;
}) {
  const { vaults, credits } = overview;
  const [refreshError,setRefreshError]=useState<string|null>(null);
  const selected = vaults.find((v) => v.id === selectedId) ?? (session.kind==='near'?vaults.find(v=>v.kind==='rhea'):vaults[0]);

  return (
    <div className="screen">
      <header className="page-head rise">
        <div>
          <p className="eyebrow">Account</p>
          <h1 className="title">Your vaults and credits</h1>
        </div>
        <p className="user-id">
          <span className="k">User id</span> <code>{overview.user}</code><br/><button type="button" className="btn ghost" onClick={()=>{setRefreshError(null);void onChanged().catch(e=>setRefreshError(errorText(e)));}}>Refresh balances</button>
        </p>
      </header>

      <ErrorNote error={refreshError}/>
      <section className="ledger rise d1" aria-label="Credits">
        <div className="figure accent">
          <span className="figure-k">Credits available</span>
          <span className="figure-v">
            <Amount micro={credits.available} fine />
          </span>
          <span className="figure-note">One balance for every vault, on NEAR</span>
        </div>
        <div className="figure">
          <span className="figure-k">Credited, all time</span>
          <span className="figure-v">
            <Amount micro={credits.credited} fine />
          </span>
          <span className="figure-note">Yield and direct credit purchases, posted on NEAR</span>
        </div>
        <div className="figure">
          <span className="figure-k">Spent</span>
          <span className="figure-v">
            <Amount micro={credits.spent} fine />
          </span>
          <span className="figure-note">Debited per call, each with a receipt</span>
        </div>
      </section>

      <section className="yieldbar rise d2" aria-label="Where your credits went">
        <div className="bar" role="img" aria-label={`Spent ${formatUsd(credits.spent, 4)} of ${formatUsd(credits.credited, 4)} credited`}>
          <span className="seg spent" style={{ width: `${pct(credits.spent, credits.credited)}%` }} />
          <span className="seg avail" style={{ width: `${pct(credits.available, credits.credited)}%` }} />
        </div>
        <ul className="legend">
          <li>
            <i className="sw spent" /> Spent {formatUsd(credits.spent, 4)}
          </li>
          <li>
            <i className="sw avail" /> Available {formatUsd(credits.available, 4)}
          </li>
          <li className="muted">Principal is never part of this bar</li>
        </ul>
      </section>

      {session.kind==='evm' && <TopUp session={session} credited={credits.credited} onChanged={onChanged}/>}

      <section className="picker-wrap rise d3" aria-labelledby="picker-h">
        <h2 id="picker-h" className="mini-h">
          Vaults · principal stays yours in each
        </h2>
        <div className="picker" role="radiogroup" aria-label="Vault">
          {vaults.map((v) => (
            <VaultTicket key={v.id} vault={v} selected={v.id === selected?.id} onSelect={() => onSelect(v.id)} />
          ))}
        </div>
      </section>

      {selected && (
        <div className="split rise d4" key={selected.id}>
          {selected.usable===false ? <section className="card vault-form"><h2 className="card-title">An EVM wallet is required</h2><p className="card-sub">This Base strategy is not available to a NEAR-only session.</p><button className="btn primary" onClick={onConnect}>Choose an EVM wallet</button></section>
            : selected.kind==='rhea' ? session.kind==='near' ? <NativeRhea session={session} vault={selected} paused={config.rheaStatusNote} onChanged={onChanged}/> : <RheaPanel session={session} vault={selected} paused={config.rheaStatusNote} onChanged={onChanged}/>
            : session.kind==='evm' ? <VaultForm session={session} vault={selected} onChanged={onChanged} onBridge={onBridge}/> : null}
          <AboutVault vault={selected} />
        </div>
      )}
    </div>
  );
}

function VaultTicket({ vault, selected, onSelect }: { vault: VaultAccount; selected: boolean; onSelect: () => void }) {
  const { position, asset, yieldToken } = vault;
  const r = position.rhea;
  const activity = r ? (r.pendingOut !== null || r.intentsBalance > 0n ? 'Withdrawal in progress' : r.pendingIn > 0n ? 'Deposit queued' : null) : null;
  return (
    <button type="button" role="radio" aria-checked={selected} className={`ticket ${selected ? 'on' : ''}`} onClick={onSelect}>
      <span className="ticket-badges">
        <ChainBadge name={vault.chain.name} />
        <AssetBadge symbol={asset.symbol}/>
      </span>
      <span className="ticket-name">{vault.name}</span>
      <span className="ticket-principal">
        <LockIcon /> {tokenAmount(position.principal, asset)}
      </span>
      <span className="ticket-yield">
        + {tokenAmount(position.yieldCredited, yieldToken, true)} <span className="muted">yield credited</span>
      </span>
      {activity && <span className="ticket-activity">{activity}</span>}
    </button>
  );
}

function AboutVault({ vault }: { vault: VaultAccount }) {
  const isRhea = vault.kind === 'rhea';
  return (
    <section className="card sources" aria-labelledby="about-h">
      <div className="card-row">
        <h2 id="about-h" className="card-title">
          About this vault
        </h2>
        <span className="ticket-badges">
          <ChainBadge name={vault.chain.name} />
          <AssetBadge symbol={vault.asset.symbol}/>
        </span>
      </div>
      <p className="card-sub">{ABOUT[vault.kind]}</p>
      <p className="loss-note">
        <span className="loss-k">If the strategy loses</span>
        {vault.lossNote}
      </p>
      <dl className="kv">
        <div>
          <dt>Deposit</dt>
          <dd>{vault.asset.symbol}</dd>
        </div>
        <div>
          <dt>Units</dt>
          <dd>
            <code>{vault.unitsLabel}</code>
          </dd>
        </div>
        <div>
          <dt>Yield paid in</dt>
          <dd>{vault.yieldToken.symbol}</dd>
        </div>
        <div>
          <dt>Vault</dt>
          <dd>
            <code>{vault.id}</code>
          </dd>
        </div>
      </dl>
      <h3 className="mini-h">Every figure is a public read</h3>
      <dl className="source-list">
        {isRhea ? (
          <div>
            <dt>Principal, yield</dt>
            <dd>
              <Source>NEAR</Source>
              <code>vault.position(user id)</code>
            </dd>
          </div>
        ) : (
          <>
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
          </>
        )}
        <div>
          <dt>Credits, spent</dt>
          <dd>
            <Source>NEAR</Source>
            <code>connector.account(user id)</code>
          </dd>
        </div>
      </dl>
      <p className="fineprint">
        The vault pays yield above principal to InferNear. The keeper posts each holder’s share to NEAR, priced once at the rate in
        that post, and the connector never credits more than the vault actually paid.
      </p>
    </section>
  );
}

function VaultForm({ session, vault, onChanged, onBridge }: { session: Extract<Session,{kind:'evm'}>; vault: VaultAccount; onChanged: () => Promise<void>; onBridge: () => void }) {
  const [mode, setMode] = useState<'deposit' | 'redeem'>('deposit');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ mode: string; hash: string; amount: bigint } | null>(null);

  const { asset, position } = vault;
  const address=session.address;
  const shareToken: Token = { ...asset, symbol: 'shares' };
  const max = mode === 'deposit' ? position.walletBalance : position.shares;
  const amount = parseAmount(input, asset.decimals);
  const invalid = input !== '' && amount === null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (amount === null) return setError(`Enter a ${asset.symbol} amount, up to ${asset.decimals} decimals.`);
    setBusy(true);
    setError(null);
    try {
      const tx = mode === 'deposit' ? await data.deposit(session, amount, vault.id) : await data.redeem(session, amount, vault.id);
      setDone({ mode, hash: tx.txHash, amount });
      setInput('');
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const preview =
    amount === null || amount === 0n
      ? ' '
      : mode === 'deposit'
        ? amount > position.allowance
          ? `Your wallet asks you to approve ${tokenAmount(amount, asset)} first, then deposit.`
          : `Deposits ${tokenAmount(amount, asset)} in one transaction.`
        : position.shares > 0n
          ? `You receive about ${tokenAmount((amount * position.principal) / position.shares, asset)} at ${shortHex(address)}.`
          : ' ';

  return (
    <section className="card vault-form" aria-labelledby="vault-h">
      <div className="card-row">
        <h2 id="vault-h" className="card-title">
          {vault.name}
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
          ? `Deposit ${asset.symbol}. Only you can redeem it, and only its yield becomes credits.`
          : `Redeem shares for your ${asset.symbol}. Yield already credited stays as credits.`}
      </p>

      {vault.kind === 'pendle' && mode === 'deposit' && (
        <div className="buy-pt">
          <span>This vault takes PT-deJAAA itself. Buy it on Pendle first; InferNear doesn’t swap for you.</span>
          {vault.buyUrl ? (
            <a className="btn outline" href={vault.buyUrl} target="_blank" rel="noreferrer">
              Buy PT on Pendle ↗
            </a>
          ) : (
            <code>$VITE_PENDLE_APP_URL</code>
          )}
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <label className="field">
          <span className="field-k">
            {mode === 'deposit' ? 'Amount' : 'Shares'}
            <button type="button" className="link" onClick={() => setInput(plainAmount(max, asset))}>
              {mode === 'deposit' ? `Wallet ${tokenAmount(max, asset)}` : `All ${tokenAmount(max, shareToken)}`}
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
            <span className="unit">{mode === 'deposit' ? asset.symbol : 'shares'}</span>
          </span>
        </label>
        <p className="preview">{preview}</p>
        <button type="submit" className="btn primary block" disabled={busy || amount === null || amount === 0n}>
          {busy ? <Spinner /> : null}
          {busy ? 'Confirm in your wallet…' : mode === 'deposit' ? 'Deposit' : 'Redeem'}
        </button>
        <ErrorNote error={error} />
        {done && (
          <p className="success" role="status">
            {done.mode === 'deposit' ? `Deposited ${tokenAmount(done.amount, asset)}` : `Redeemed ${tokenAmount(done.amount, shareToken)}`} ·{' '}
            <code>{shortHex(done.hash, 10, 6)}</code>
          </p>
        )}
      </form>
      {asset.symbol === 'USDC' && (
        <p className="fineprint">
          USDC on another chain?{' '}
          <button type="button" className="link" onClick={onBridge}>
            Bring it to Base with NEAR Intents
          </button>
        </p>
      )}
    </section>
  );
}
