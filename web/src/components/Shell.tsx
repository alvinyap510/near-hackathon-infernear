import { useRef, type KeyboardEvent } from 'react';
import { shortHex } from '../data/money.ts';
import { SealGlyph, ChainBadge } from './ui.tsx';

export const TABS = [
  { id: 'vaults', label: 'Vaults' },
  { id: 'account', label: 'Account' },
  { id: 'keys', label: 'API keys' },
  { id: 'try', label: 'Try the API' },
  { id: 'bridge', label: 'From another chain' },
] as const;

export type Tab = (typeof TABS)[number]['id'];

export function MockRibbon() {
  return (
    <div className="ribbon" role="note">
      <span className="ribbon-tag">Mock data</span>
      <span className="ribbon-text">
        Every balance, key and verification result here is simulated. Nothing is wired to Base, NEAR or NEAR AI yet.
      </span>
    </div>
  );
}

export function Header({
  address,
  tab,
  onTab,
  onConnect,
  onDisconnect,
  chainName = 'Base',
}: {
  address: string | null;
  chainName?: 'Base' | 'NEAR';
  onDisconnect?: () => void;
  tab: Tab;
  onTab: (t: Tab) => void;
  /** Opens the wallet chooser; without it the header shows "Not connected". */
  onConnect?: () => void;
}) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);

  // Arrow keys move between tabs, as in any tab list.
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + TABS.length) % TABS.length;
    refs.current[next]?.focus();
    onTab(TABS[next].id);
  };

  return (
    <header className="header">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div className="header-inner">
        <a className="brand" href="#vaults" aria-label="InferNear home">
          <SealGlyph size={18} />
          <span className="brand-word">InferNear</span>
        </a>
        <nav className="tabs" aria-label="Dashboard">
            {TABS.map((t, i) => (
              <a
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                href={`#${t.id}`}
                className="tab"
                aria-current={tab === t.id ? 'page' : undefined}
                onKeyDown={(e) => onKey(e, i)}
              >
                {t.label}
              </a>
            ))}
          </nav>
        <div className="wallet">
          {address ? (
            <>
              <ChainBadge name={chainName} />
              <span className="chip addr" title={address}>
                <span className="avatar" aria-hidden="true" style={{ ['--h' as string]: (parseInt(address.slice(2, 5), 16) || 0) % 360 }} />
                {shortHex(address)}
              </span>
              {onConnect && <button type="button" className="btn ghost" onClick={onConnect}>Switch wallet</button>}
              {onDisconnect && <button type="button" className="btn ghost" onClick={onDisconnect}>Disconnect</button>}
            </>
          ) : onConnect ? (
            <button type="button" className="btn primary header-connect" onClick={onConnect}>
              <span className="btn-dot" aria-hidden="true" />
              Connect wallet
            </button>
          ) : (
            <span className="chip muted">Not connected</span>
          )}
        </div>
      </div>
    </header>
  );
}
