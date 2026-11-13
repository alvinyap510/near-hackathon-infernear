import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { shortHex } from '../data/money.ts';
import { avatarColors } from './avatar.ts';
import { CopyButton } from './ui.tsx';

/** A round avatar painted from `seed` alone; the caller decides what the seed is. */
export function Avatar({ seed, size }: { seed: string; size: number }) {
  return <span className="avatar" aria-hidden="true" style={{ width: size, height: size, background: avatarColors(seed).background }} />;
}

const shortId = (id: string, kind: 'evm' | 'near') =>
  kind === 'evm' ? shortHex(id) : id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;

// The first-connection hint shows until this browser has opened the account dropdown once.
const HINT_KEY = 'infernear:handle-hint-seen';
const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } };
const rememberHint = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode: show it again next time */ } };
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href]';

/**
 * The connected header's one account control: an avatar button that opens a small panel with the
 * identity (the account's handle when there is one), the account section, Switch wallet and
 * Logout. The panel holds a form, so it is a dialog popover rather than a menu: Tab stays inside
 * it, arrow keys move between its buttons, Escape closes it and returns focus to the button.
 */
export function AccountMenu({ seed, id, kind, handle, hint, onSwitch, onLogout, children }: {
  seed: string;
  /** The connected EVM address or NEAR account id. */
  id: string;
  kind: 'evm' | 'near';
  /** The account's handle, once the connected wallet belongs to one. */
  handle?: string;
  /** Points a wallet with no account at the handle form, once per browser. */
  hint?: boolean;
  onSwitch?: () => void;
  onLogout?: () => void;
  /** The account section; `close` shuts the panel, for actions that move elsewhere. */
  children?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(() => !hintSeen());
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // Opened from the keyboard, focus goes to the first control; opened with a pointer, to the panel.
  const byPointer = useRef(false);
  const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    if (showHint) { rememberHint(); setShowHint(false); }
    if (byPointer.current) panel.current?.focus();
    else focusables()[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    const list = focusables();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab') {
      // Focus stays in the panel: past the last control it wraps to the first, and back.
      if (e.shiftKey ? i <= 0 : i === list.length - 1) {
        e.preventDefault();
        list[e.shiftKey ? list.length - 1 : 0]?.focus();
      }
      return;
    }
    // Arrow keys step through the buttons; inside the text field they keep their usual meaning.
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const buttons = list.filter((el) => el.tagName !== 'INPUT');
    const j = buttons.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? j + 1 : e.key === 'ArrowUp' ? (j < 0 ? -1 : j - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? -1 : null;
    if (next === null) return;
    e.preventDefault();
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };
  const choose = (action?: () => void) => {
    setOpen(false);
    action?.();
  };
  const name = handle ?? shortId(id, kind);

  return (
    <div className="acct" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="acct-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={handle ? `${handle} · ${id}` : id}
        onPointerDown={() => (byPointer.current = true)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          byPointer.current = false;
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Avatar seed={seed} size={24} />
        <span className={handle ? 'acct-id acct-handle' : 'acct-id'}>{name}</span>
        <svg className="acct-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
      </button>
      {hint && showHint && !open && (
        <p className="acct-hint">
          <button type="button" className="acct-hint-open" onClick={() => { byPointer.current = false; setOpen(true); }}>
            New here? Pick a handle for your account
          </button>
          <button type="button" className="acct-hint-x" aria-label="Dismiss" onClick={() => { rememberHint(); setShowHint(false); }}>×</button>
        </p>
      )}
      {open && (
        <div className="acct-menu" id={panelId} role="dialog" aria-label={`Account ${name}`} tabIndex={-1} ref={panel} onKeyDown={onPanelKey}>
          <div className="acct-who">
            <Avatar seed={seed} size={38} />
            <span className="acct-who-text">
              {handle ? (
                <>
                  <span className="acct-name">{handle}</span>
                  <span className="acct-sub"><span className="acct-kind">{kind === 'evm' ? 'EVM · Base' : 'NEAR'}</span> <span className="acct-who-id" title={id}>{kind === 'evm' ? shortHex(id) : id}</span></span>
                </>
              ) : (
                <>
                  <span className="acct-kind">{kind === 'evm' ? 'EVM · Base' : 'NEAR'}</span>
                  <span className="acct-who-id" title={id}>{kind === 'evm' ? shortHex(id) : id}</span>
                </>
              )}
            </span>
            <CopyButton text={id} />
          </div>
          {children?.(close)}
          <div className="acct-end">
            {onSwitch && (
              <button type="button" className="acct-item" onClick={() => choose(onSwitch)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" /></svg>
                Switch wallet
              </button>
            )}
            {onLogout && (
              <button type="button" className="acct-item danger" onClick={() => choose(onLogout)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 11l3-3-3-3M13.5 8H6" /></svg>
                Logout
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
