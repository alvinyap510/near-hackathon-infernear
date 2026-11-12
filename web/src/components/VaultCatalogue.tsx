import type { JSX } from 'react';
import { ChainBadge, ErrorNote, LockIcon } from './ui.tsx';

// Presentation only: renders what the props carry and invents no figures.
export type CatalogueVault = {
  id: string;
  kind: 'aave' | 'rate' | 'pendle' | 'rhea';
  name: string; // 'Aave USDC', 'cbETH RateVault', 'PT-deJAAA', 'Rhea USDC'
  chainName: 'Base' | 'NEAR';
  assetSymbol: string; // what you deposit
  yieldShape: string; // 'Growing balance', 'Uncapped appreciation', 'Capped appreciation', 'Lending interest'
  strategy: string; // one sentence on where the yield comes from
  lossNote: string; // the existing "depositors bear ... losses" line
  wallets: ('evm' | 'near')[]; // which wallet kinds can deposit here
  deposited?: string; // total principal in the vault, formatted; undefined while loading
  cap?: string; // deposit cap, formatted
  rateNow?: string; // only when read from chain, e.g. '4.76% · Aave supply rate now, variable'
  yourPrincipal?: string; // when connected and non-zero
  yourYield?: string;
  status: 'open' | 'paused';
  statusNote?: string; // shown when paused
};

export type VaultCatalogueProps = {
  vaults: CatalogueVault[];
  loading: boolean;
  error?: string | null;
  connectedKind: 'evm' | 'near' | null; // null = no wallet
  onChoose(id: string): void; // open that vault's deposit/redeem view
  onConnect(): void; // open the wallet chooser
};

const WALLET_NAME = { evm: 'EVM', near: 'NEAR' } as const;

export function VaultCatalogue({ vaults, loading, error = null, connectedKind, onChoose, onConnect }: VaultCatalogueProps): JSX.Element {
  const skeleton = loading && vaults.length === 0;
  return (
    <div className="screen vc-screen">
      <header className="page-head rise">
        <div>
          <p className="eyebrow">Vaults</p>
          <h1 className="title">Choose a vault</h1>
        </div>
        <div className="vc-intro">
          <p className="page-note">
            Deposit an asset you already hold and keep the principal. Only the yield above it goes to InferNear, and it
            comes back to you as API credits on NEAR.
          </p>
          {connectedKind === null && (
            <a className="vc-learn" href="https://infernear.dev">
              New here? How InferNear works
            </a>
          )}
        </div>
      </header>

      {connectedKind === null && (
        <ol className="vc-steps rise d1" aria-label="How it works">
          <li>
            <span className="vc-step-n">1</span> Deposit and keep your principal
          </li>
          <li>
            <span className="vc-step-n">2</span> Its yield becomes API credits on NEAR
          </li>
          <li>
            <span className="vc-step-n">3</span> Create an API key and call the endpoint
          </li>
        </ol>
      )}

      <ErrorNote error={error} />

      {skeleton ? (
        <div className="vc-grid" aria-busy="true">
          <p className="sr-only" role="status">
            Reading the vaults…
          </p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="vc-card is-skel" aria-hidden="true">
              <span className="vc-skel w-30" />
              <span className="vc-skel w-50 tall" />
              <span className="vc-skel w-80" />
              <span className="vc-skel w-100 block" />
              <span className="vc-skel w-40 btn-like" />
            </div>
          ))}
        </div>
      ) : (
        <div className="vc-grid">
          {vaults.map((vault, i) => (
            <VaultCard
              key={vault.id}
              vault={vault}
              index={i}
              loading={loading}
              connectedKind={connectedKind}
              onChoose={onChoose}
              onConnect={onConnect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VaultCard({
  vault,
  index,
  loading,
  connectedKind,
  onChoose,
  onConnect,
}: {
  vault: CatalogueVault;
  index: number;
  loading: boolean;
  connectedKind: 'evm' | 'near' | null;
  onChoose(id: string): void;
  onConnect(): void;
}) {
  const paused = vault.status === 'paused';
  const fill = capFraction(vault.deposited, vault.cap);
  const nameId = `vc-${vault.id}`;
  const [rateValue, rateRest] = splitFirst(vault.rateNow);

  return (
    <article className={`vc-card rise d${Math.min(index + 2, 5)}${paused ? ' is-paused' : ''}`} aria-labelledby={nameId}>
      <div className="vc-head">
        <span className="ticket-badges">
          <ChainBadge name={vault.chainName} />
          <span className="badge asset">{vault.assetSymbol}</span>
          {paused && <span className="badge vc-paused">Paused</span>}
        </span>
        <span className="vc-shape">
          <ShapeGlyph kind={vault.kind} />
          {vault.yieldShape}
        </span>
      </div>

      <h2 id={nameId} className="vc-name">
        {vault.name}
      </h2>
      <p className="vc-strategy">{vault.strategy}</p>

      <dl className="vc-facts">
        <div className="vc-fact vc-deposited">
          <dt>Deposited</dt>
          <dd>
            {vault.deposited !== undefined ? (
              <span className="vc-num">{vault.deposited}</span>
            ) : loading ? (
              <span className="vc-skel w-60" aria-label="Loading" />
            ) : (
              <span className="vc-num muted" aria-label="Not available">
                —
              </span>
            )}
            {vault.cap && <span className="vc-of"> of {vault.cap} cap</span>}
            {fill !== null && (
              <span className="vc-cap" aria-hidden="true">
                <span style={{ width: `${(fill * 100).toFixed(2)}%` }} />
              </span>
            )}
          </dd>
        </div>
        {vault.rateNow && (
          <div className="vc-fact">
            <dt>Rate now</dt>
            <dd>
              <span className="vc-num">{rateValue}</span>
              {rateRest && <span className="vc-rate-note">{rateRest}</span>}
            </dd>
          </div>
        )}
        <div className="vc-fact">
          <dt>Deposit with</dt>
          <dd className="vc-wallets">
            {vault.wallets.map((w) => (
              <span key={w} className={`vc-wallet${connectedKind === w ? ' is-yours' : ''}`}>
                {WALLET_NAME[w]} wallet
              </span>
            ))}
          </dd>
        </div>
      </dl>

      {(vault.yourPrincipal || vault.yourYield) && (
        <p className="vc-yours">
          <span className="vc-yours-k">Yours</span>
          {vault.yourPrincipal && (
            <span className="vc-yours-p">
              <LockIcon /> {vault.yourPrincipal}
            </span>
          )}
          {vault.yourYield && (
            <span className="vc-yours-y">
              + {vault.yourYield} <span className="muted">yield credited</span>
            </span>
          )}
        </p>
      )}

      <div className="vc-foot">
        <p className="vc-loss">{vault.lossNote}</p>
        <div className="vc-action">
          <Action vault={vault} connectedKind={connectedKind} onChoose={onChoose} onConnect={onConnect} />
        </div>
      </div>
    </article>
  );
}

function Action({
  vault,
  connectedKind,
  onChoose,
  onConnect,
}: {
  vault: CatalogueVault;
  connectedKind: 'evm' | 'near' | null;
  onChoose(id: string): void;
  onConnect(): void;
}) {
  if (vault.status === 'paused') return <p className="vc-status">{vault.statusNote ?? 'Deposits paused'}</p>;
  if (connectedKind === null) {
    return (
      <button type="button" className="btn outline" onClick={onConnect}>
        Connect wallet<span className="sr-only"> to deposit into {vault.name}</span>
      </button>
    );
  }
  if (!vault.wallets.includes(connectedKind)) return <p className="vc-needs">{needsText(vault.wallets)}</p>;
  return (
    <button type="button" className="btn primary" onClick={() => onChoose(vault.id)}>
      <span className="btn-dot" aria-hidden="true" />
      {vault.yourPrincipal ? 'Deposit or redeem' : 'Deposit'}
      <span className="sr-only"> {vault.yourPrincipal ? 'in' : 'into'} {vault.name}</span>
    </button>
  );
}

/** "Needs an EVM wallet", "Needs a NEAR or EVM wallet". */
function needsText(wallets: ('evm' | 'near')[]) {
  if (!wallets.length) return 'No wallet can deposit here';
  const names = wallets.map((w) => WALLET_NAME[w]);
  return `Needs ${names[0] === 'EVM' ? 'an' : 'a'} ${names.join(' or ')} wallet`;
}

/** Splits '4.76% · Aave supply rate now, variable' into its figure and its description. */
function splitFirst(text?: string): [string, string] {
  if (!text) return ['', ''];
  const at = text.indexOf(' · ');
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 3)];
}

/**
 * How full the cap is, only when both strings are plain numbers in the same unit
 * ("4,210.00 USDC" of "10,000.00 USDC", "$4,210" of "$10,000"). Anything else ("≈ $10K",
 * mixed units, other number formats) draws no bar rather than a guessed one.
 */
function capFraction(deposited?: string, cap?: string): number | null {
  const d = parsePlain(deposited);
  const c = parsePlain(cap);
  if (!d || !c || d.unit !== c.unit || !(c.n > 0)) return null;
  return Math.min(1, Math.max(0, d.n / c.n));
}

function parsePlain(s?: string) {
  const m = s?.trim().match(/^([^\d]*?)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*([^\d]*)$/);
  if (!m) return null;
  const n = Number(m[2].replace(/,/g, ''));
  return Number.isFinite(n) ? { n, unit: `${m[1].trim()}|${m[3].trim()}` } : null;
}

/** The yield shape as a line over the principal (dashed); the green area is the yield. */
function ShapeGlyph({ kind }: { kind: CatalogueVault['kind'] }) {
  const shapes = {
    // Balance grows steadily.
    aave: { line: 'M2 16L38 6', area: 'M2 16L38 6V16Z' },
    // Exchange rate rises with no ceiling.
    rate: { line: 'M2 16C16 15.5 27 12 38 3', area: 'M2 16C16 15.5 27 12 38 3V16Z' },
    // Pulls to par at expiry, then flat.
    pendle: { line: 'M2 16L29 5H38', area: 'M2 16L29 5H38V16Z' },
    // Interest settles in cycles.
    rhea: { line: 'M2 16H8V14H14V12H20V10H26V8H32V6H38', area: 'M2 16H8V14H14V12H20V10H26V8H32V6H38V16Z' },
  } as const;
  const s = shapes[kind];
  return (
    <svg className="vc-glyph" viewBox="0 0 40 20" aria-hidden="true">
      <path d={s.area} className="vc-glyph-area" />
      {kind === 'pendle' && <path d="M2 5H38" className="vc-glyph-cap" />}
      <path d="M2 16H38" className="vc-glyph-base" />
      <path d={s.line} className="vc-glyph-line" />
    </svg>
  );
}
