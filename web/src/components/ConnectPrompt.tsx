import { useId, type JSX, type ReactNode } from 'react';

/**
 * What a wallet-only tab shows before a wallet is connected. Without children it offers a
 * "Connect wallet" button (onConnect opens the chooser); pass a <WalletChooser> as children to
 * show the choice inline instead.
 */
export function ConnectPrompt({ title, onConnect, children }: { title: string; onConnect(): void; children?: ReactNode }): JSX.Element {
  const titleId = useId();
  return (
    <section className={`cp rise${children ? ' has-chooser' : ''}`} aria-labelledby={titleId}>
      <EmptyFrame />
      <h1 id={titleId} className="cp-title">
        {title}
      </h1>
      <p className="cp-text">Connect a wallet to see this.</p>
      {children ? (
        <div className="cp-chooser">{children}</div>
      ) : (
        <button type="button" className="btn primary lg" onClick={onConnect}>
          <span className="btn-dot" aria-hidden="true" />
          Connect wallet
        </button>
      )}
    </section>
  );
}

/** The logo's brackets around an empty core: nothing of yours is shown yet. */
function EmptyFrame() {
  return (
    <svg className="cp-frame" width="44" height="44" viewBox="4 4 24 24" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12v4H8v16h4v4H5.5A1.5 1.5 0 0 1 4 26.5zM20 4h6.5A1.5 1.5 0 0 1 28 5.5v21a1.5 1.5 0 0 1-1.5 1.5H20v-4h4V8h-4z"
        fill="currentColor"
      />
      <rect x="12.75" y="12.75" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
