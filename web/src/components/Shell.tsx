import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { AccountMenu } from './AccountMenu.tsx';
import { canonicalSeed } from './avatar.ts';
import { SealGlyph } from './ui.tsx';

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
  accountSeed: storedSeed,
  handle,
  promptHandle,
  accountPanel,
}: {
  address: string | null;
  /** The account's fixed avatar seed (its UID), once the connected wallet is known to be in an account. */
  accountSeed?: string;
  /** The account's handle, shown as the name on the account button and in its panel. */
  handle?: string;
  /** The connected wallet has no account yet: point it at the handle form once. */
  promptHandle?: boolean;
  /** The account section, for the dropdown (`menu`) and for the pending-link strip under the header (`banner`). */
  accountPanel?: (place: 'menu' | 'banner', close: () => void) => ReactNode;
  chainName?: 'Base' | 'NEAR';
  onDisconnect?: () => void;
  tab: Tab;
  onTab: (t: Tab) => void;
  /** Opens the wallet chooser; without it the header shows "Not connected". */
  onConnect?: () => void;
}) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  // The avatar's seed: the account's stored seed when there is an account, so the avatar stays
  // fixed across linked wallets; otherwise the connected wallet's canonical id.
  const accountSeed = address ? storedSeed ?? canonicalSeed(address) : null;

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
          {address && accountSeed ? (
            <AccountMenu seed={accountSeed} id={address} kind={chainName === 'NEAR' ? 'near' : 'evm'} handle={handle} hint={promptHandle}
              onSwitch={onConnect} onLogout={onDisconnect}>
              {accountPanel && ((close) => accountPanel('menu', close))}
            </AccountMenu>
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
      {address && accountPanel?.('banner', () => {})}
    </header>
  );
}
