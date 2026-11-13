import { useState, type CSSProperties, type ReactNode } from 'react';
import ExchangeCoinbase from '@web3icons/react/icons/exchanges/ExchangeCoinbase';
import NetworkBase from '@web3icons/react/icons/networks/NetworkBase';
import NetworkNearProtocol from '@web3icons/react/icons/networks/NetworkNearProtocol';
import TokenAAVE from '@web3icons/react/icons/tokens/TokenAAVE';
import TokenCBETH from '@web3icons/react/icons/tokens/TokenCBETH';
import TokenPENDLE from '@web3icons/react/icons/tokens/TokenPENDLE';
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC';
import rheaLogo from '../assets/rhea-logo.svg';
import type { Token } from '../data/index.ts';
import { formatAmount } from '../data/money.ts';

export function CopyButton({ text, label = 'Copy', tone = 'paper', role }: { text: string; label?: string; tone?: 'paper' | 'seal'; role?: 'menuitem' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button type="button" className={`btn-copy ${tone}`} onClick={copy} aria-live="polite" role={role}>
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
 * Brand logos from @web3icons/react, as the package draws them, in one of four forms:
 * - mark: the full-colour logo. Every logo used here is drawn in the middle 18 units of a
 *   24-unit box, so the viewBox is cropped to that area and `size` is the logo's real size.
 * - glyph: the one-colour logo, cropped the same way, in the current text colour.
 * - coin: the package's logo-on-brand-colour variant, cut to a disc.
 * - disc: the one-colour logo, white, centred on a disc of the brand's colour.
 * Every token reads as a solid disc of the same size: USDC's mark already is one; cbETH's mark
 * is a thin ring, so it is a coin; Pendle's logo is a large white disc that would read as a
 * ring, so it is a disc with a smaller glyph. PT-deJAAA has no logo of its own: it is Pendle's.
 */
const MARKS = {
  base: [NetworkBase, 'mark'],
  near: [NetworkNearProtocol, 'mark'],
  usdc: [TokenUSDC, 'mark'],
  cbeth: [TokenCBETH, 'coin'],
  pendle: [TokenPENDLE, 'disc'],
  aave: [TokenAAVE, 'coin'],
  coinbase: [ExchangeCoinbase, 'coin'],
} as const;

export type Brand = keyof typeof MARKS;
type Form = 'mark' | 'glyph' | 'coin' | 'disc';
const VARIANT = { mark: 'branded', glyph: 'mono', coin: 'background' } as const;
const CROP = { viewBox: '3 3 18 18' };

export function BrandMark({ brand, size = 18, form, className = '' }: { brand: Brand; size?: number; form?: Form; className?: string }) {
  const [Icon, preferred] = MARKS[brand];
  const shown = form ?? preferred;
  if (shown === 'disc') {
    return (
      <span className={`brand-mark is-disc ${brand} ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
        <Icon variant="mono" size="52%" {...CROP} aria-hidden="true" focusable="false" />
      </span>
    );
  }
  return (
    <Icon
      variant={VARIANT[shown]}
      size={size}
      {...(shown === 'coin' ? {} : CROP)}
      className={`brand-mark is-${shown} ${className}`.trim()}
      aria-hidden="true"
      focusable="false"
    />
  );
}

export type Protocol = 'aave' | 'coinbase' | 'pendle' | 'rhea';

/**
 * A strategy's protocol logo as a small disc. Rhea is not in @web3icons: its logo is the file
 * from Rhea's own site, mint on transparent, so it sits on Rhea's near-black brand colour.
 */
export function ProtocolMark({ protocol, size = 16, className = '' }: { protocol: Protocol; size?: number; className?: string }) {
  if (protocol !== 'rhea') return <BrandMark brand={protocol} size={size} className={className} />;
  return (
    <span className={`brand-mark is-coin rhea-coin ${className}`.trim()} style={{ width: size, height: size, padding: size * 0.16 }} aria-hidden="true">
      <img src={rheaLogo} alt="" />
    </span>
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

/**
 * A vault's identity: its deposit asset as a disc, with its chain as a small round badge on
 * the lower-right edge. `size` is the disc in px; a layout can override it with
 * --vault-mark-size on an ancestor.
 */
export function VaultMark({ assetSymbol, chainName, size = 48 }: { assetSymbol: string; chainName: string; size?: number }) {
  const asset = ASSET_BRAND[assetSymbol];
  const chain = CHAIN_BRAND[chainName];
  return (
    <span className="vault-mark" role="img" aria-label={`${assetSymbol} on ${chainName}`} style={{ '--vm-size': `${size}px` } as CSSProperties}>
      {asset ? (
        <BrandMark brand={asset} size={size} className="vault-mark-asset" />
      ) : (
        <span className="vault-mark-asset vault-mark-text" aria-hidden="true">
          {assetSymbol.slice(0, 1)}
        </span>
      )}
      {chain && (
        <span className="vault-mark-chain" aria-hidden="true">
          {/* NEAR's full-colour mark is light green, so on the white badge it is its black glyph. */}
          <BrandMark brand={chain} form={chain === 'near' ? 'glyph' : 'mark'} size={Math.round(size * 0.16)} />
        </span>
      )}
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
