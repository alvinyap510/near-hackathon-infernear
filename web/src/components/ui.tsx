import { useState, type ReactNode } from 'react';
import ExchangeCoinbase from '@web3icons/react/icons/exchanges/ExchangeCoinbase';
import NetworkBase from '@web3icons/react/icons/networks/NetworkBase';
import NetworkNearProtocol from '@web3icons/react/icons/networks/NetworkNearProtocol';
import TokenAAVE from '@web3icons/react/icons/tokens/TokenAAVE';
import TokenCBETH from '@web3icons/react/icons/tokens/TokenCBETH';
import TokenPENDLE from '@web3icons/react/icons/tokens/TokenPENDLE';
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC';
import type { Token } from '../data/index.ts';
import { formatAmount } from '../data/money.ts';

export function CopyButton({ text, label = 'Copy', tone = 'paper' }: { text: string; label?: string; tone?: 'paper' | 'seal' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" className={`btn-copy ${tone}`} onClick={copy} aria-live="polite">
      {copied ? 'Copied' : label}
    </button>
  );
}

/** A value read from a chain or the relay, with where it came from. */
export function Source({ children }: { children: ReactNode }) {
  return <span className="source">{children}</span>;
}

export function Check({ state }: { state: 'ok' | 'pending' | 'idle' }) {
  return (
    <span className={`check ${state}`} aria-hidden="true">
      {state === 'ok' ? (
        <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      ) : null}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}

/**
 * The InferNear mark: a bracketed enclave holding the private core in signal green.
 * Drawn on a 4-unit grid, so sizes in multiples of 6 px render with crisp edges.
 */
export function SealGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="4 4 24 24" aria-hidden="true" className="seal-glyph">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v4H8v16h4v4H5.5A1.5 1.5 0 0 1 4 26.5zM20 4h6.5A1.5 1.5 0 0 1 28 5.5v21a1.5 1.5 0 0 1-1.5 1.5H20v-4h4V8h-4z"
        fill="currentColor"
      />
      <rect x="12" y="12" width="8" height="8" rx="1" fill="var(--signal)" />
    </svg>
  );
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A token amount in its own decimals: cents for 6-dp tokens, four places for 18-dp ones. */
export const tokenAmount = (amount: bigint, token: Token, fine = false) =>
  `${formatAmount(amount, token.decimals, token.decimals === 6 ? (fine ? 4 : 2) : fine ? 6 : 4)} ${token.symbol}`;

/** An amount as a user would type it back: no grouping, no trailing zeros. */
export const plainAmount = (amount: bigint, token: Token) =>
  formatAmount(amount, token.decimals).replace(/,/g, '').replace(/\.?0+$/, '');

/**
 * Brand marks from @web3icons/react, drawn as the package ships them: the plain mark, or
 * with `tile` the package's own mark-on-brand-colour square. Pendle's plain mark is white on
 * transparent and vanishes on a white card, so it is always a tile. PT-deJAAA has no token
 * mark of its own: it is Pendle's token.
 */
const MARKS = {
  base: NetworkBase,
  near: NetworkNearProtocol,
  usdc: TokenUSDC,
  cbeth: TokenCBETH,
  pendle: TokenPENDLE,
  aave: TokenAAVE,
  coinbase: ExchangeCoinbase,
} as const;

export type Brand = keyof typeof MARKS;

export function BrandMark({ brand, size = 16, tile = false, className = '' }: { brand: Brand; size?: number; tile?: boolean; className?: string }) {
  const Icon = MARKS[brand];
  const asTile = tile || brand === 'pendle';
  return (
    <Icon
      variant={asTile ? 'background' : 'branded'}
      size={size}
      className={`brand-mark${asTile ? ' is-tile' : ''} ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
    />
  );
}

const CHAIN_BRAND: Record<string, Brand> = { Base: 'base', NEAR: 'near' };
const ASSET_BRAND: Record<string, Brand> = { USDC: 'usdc', cbETH: 'cbeth', 'PT-deJAAA': 'pendle' };

export function ChainBadge({ name }: { name: string }) {
  const brand = CHAIN_BRAND[name];
  return (
    <span className={`badge chain ${name === 'NEAR' ? 'near' : 'base'}${brand ? ' has-logo' : ''}`}>
      {brand ? <BrandMark brand={brand} className="badge-logo" /> : <span className="badge-dot" aria-hidden="true" />} {name}
    </span>
  );
}

/** A deposit asset's logo and symbol; an unknown symbol stays a plain text chip. */
export function AssetBadge({ symbol }: { symbol: string }) {
  const brand = ASSET_BRAND[symbol];
  if (!brand) return <span className="badge asset">{symbol}</span>;
  return (
    <span className="badge asset has-logo">
      <BrandMark brand={brand} className="badge-logo" /> {symbol}
    </span>
  );
}

export function LockIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
