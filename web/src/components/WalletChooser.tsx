import { useEffect, useId, useRef, type JSX } from 'react';
import { ErrorNote, Spinner } from './ui.tsx';

// Presentation only: no wallet code. The caller discovers wallets, maps them to options and
// connects on onSelect.
export type WalletOption = {
  id: string; // e.g. 'evm:io.metamask', 'near:meteor-wallet'
  kind: 'evm' | 'near';
  name: string; // 'MetaMask', 'Rabby', 'Meteor Wallet', ...
  icon?: string; // data: or https URL supplied by the wallet; a neutral glyph is drawn when absent
  available: boolean; // false = not installed / cannot open here
  installUrl?: string; // shown as "Install" when not available
};

export type WalletChooserProps = {
  options: WalletOption[];
  busyId?: string | null; // option currently connecting: progress on that row, the rest disabled
  error?: string | null; // connection error, shown inside the chooser
  onSelect(id: string): void;
};

const GROUPS = [
  { kind: 'evm', title: 'EVM wallet', note: 'All four vaults, from Base' },
  { kind: 'near', title: 'NEAR wallet', note: 'API keys and the Rhea USDC vault on NEAR, no bridge' },
] as const;

export function WalletChooser({ options, busyId = null, error = null, onSelect }: WalletChooserProps): JSX.Element {
  const uid = useId();
  return (
    <div className={`wc${busyId !== null ? ' is-busy' : ''}`}>
      {GROUPS.map((group) => {
        // Available first; otherwise keep the caller's order (Array.prototype.sort is stable).
        const rows = options.filter((o) => o.kind === group.kind).sort((a, b) => Number(b.available) - Number(a.available));
        if (!rows.length) return null;
        const headId = `${uid}-${group.kind}`;
        return (
          <div className="wc-group" role="group" aria-labelledby={headId} key={group.kind}>
            <p className="wc-group-head">
              <span id={headId} className="wc-group-k">
                {group.title}
              </span>
              <span className="wc-group-note">{group.note}</span>
            </p>
            <ul className="wc-list">
              {rows.map((option) => (
                <li key={option.id}>
                  <WalletRow option={option} busyId={busyId} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <ErrorNote error={error} />
    </div>
  );
}

function WalletRow({ option, busyId, onSelect }: { option: WalletOption; busyId: string | null; onSelect(id: string): void }) {
  const busy = busyId === option.id;
  const locked = busyId !== null;
  const face = (
    <>
      <WalletIcon icon={option.icon} />
      <span className="wc-name">{option.name}</span>
    </>
  );

  if (option.available) {
    return (
      <button
        type="button"
        className={`wc-row${busy ? ' is-busy' : ''}`}
        onClick={() => onSelect(option.id)}
        disabled={locked}
        aria-busy={busy || undefined}
      >
        {face}
        {busy ? (
          <span className="wc-state busy">
            <Spinner /> Connecting…
          </span>
        ) : (
          <>
            <span className="wc-state ok">Detected</span>
            <Chevron />
          </>
        )}
      </button>
    );
  }

  if (option.installUrl) {
    return (
      <a
        className={`wc-row is-install${locked ? ' is-locked' : ''}`}
        href={option.installUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={locked || undefined}
        tabIndex={locked ? -1 : undefined}
      >
        {face}
        <span className="wc-state install">
          Install <span aria-hidden="true">↗</span>
          <span className="sr-only"> (opens a new tab)</span>
        </span>
      </a>
    );
  }

  return (
    <div className="wc-row is-off" aria-disabled="true">
      {face}
      <span className="wc-state off">Not available</span>
    </div>
  );
}

function WalletIcon({ icon }: { icon?: string }) {
  return (
    <span className="wc-icon" aria-hidden="true">
      {icon ? (
        <img src={icon} alt="" width={32} height={32} />
      ) : (
        <svg viewBox="0 0 24 24">
          <rect x="3.5" y="6" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 6l9-2.5a1.5 1.5 0 0 1 1.9 1.45V6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <rect x="14.5" y="11" width="6" height="4" rx="1" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

function Chevron() {
  return (
    <svg className="wc-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The chooser in a modal dialog, for the header's "Connect wallet" button. A native modal <dialog>
 * keeps focus inside (the rest of the page is inert), closes on Esc and returns focus to the opener.
 */
export function WalletDialog({ open, onClose, ...chooser }: WalletChooserProps & { open: boolean; onClose(): void }): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('.wc-row:not(:disabled):not([aria-disabled])')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="wd"
      aria-labelledby={titleId}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself; the panel fills the dialog box.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wd-panel">
        <div className="wd-head">
          <h2 id={titleId} className="wd-title">
            Connect a wallet
          </h2>
          <button type="button" className="wd-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="wd-sub">Pick the wallet that holds what you want to deposit.</p>
        <WalletChooser {...chooser} />
      </div>
    </dialog>
  );
}
