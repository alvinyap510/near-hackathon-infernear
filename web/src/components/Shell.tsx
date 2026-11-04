import { useRef, type KeyboardEvent } from 'react';
import type { Address } from '../data/index.ts';
import { shortHex } from '../data/money.ts';
import { SealGlyph } from './ui.tsx';

export const TABS = [
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

export function Header({ address, tab, onTab }: { address: Address | null; tab: Tab; onTab: (t: Tab) => void }) {
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
        <a className="brand" href="#account" aria-label="InferNear home">
          <SealGlyph size={26} />
          <span className="brand-word">
            Infer<em>Near</em>
          </span>
        </a>
        {address && (
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
        )}
        <div className="wallet">
          {address ? (
            <>
              <span className="chip net">
                <span className="net-dot" aria-hidden="true" /> Base
              </span>
              <span className="chip addr" title={address}>
                <span className="avatar" aria-hidden="true" style={{ ['--h' as string]: parseInt(address.slice(2, 5), 16) % 360 }} />
                {shortHex(address)}
              </span>
            </>
          ) : (
            <span className="chip muted">Not connected</span>
          )}
        </div>
      </div>
    </header>
  );
}
