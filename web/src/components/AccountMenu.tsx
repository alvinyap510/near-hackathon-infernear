import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { shortHex } from '../data/money.ts';
import { avatarColors } from './avatar.ts';
import { CopyButton } from './ui.tsx';

/** A round avatar painted from `seed` alone; the caller decides what the seed is. */
export function Avatar({ seed, size }: { seed: string; size: number }) {
  return <span className="avatar" aria-hidden="true" style={{ width: size, height: size, background: avatarColors(seed).background }} />;
}

const shortId = (id: string, kind: 'evm' | 'near') =>
  kind === 'evm' ? shortHex(id) : id.length > 20 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;

/**
 * The connected header's one account control: an avatar button that opens a small menu with the
 * wallet's identity, Switch wallet and Logout.
 */
export function AccountMenu({ seed, id, kind, onSwitch, onLogout }: {
  seed: string;
  /** The connected EVM address or NEAR account id. */
  id: string;
  kind: 'evm' | 'near';
  onSwitch?: () => void;
  onLogout?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Opened from the keyboard, focus goes to the first item; opened with a pointer, to the menu.
  const byPointer = useRef(false);
  const items = () => [...(panel.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];

  useEffect(() => {
    if (!open) return;
    if (byPointer.current) panel.current?.focus();
    else items()[0]?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (e.key === 'Tab') return setOpen(false);
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? (i < 0 ? -1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? -1 : null;
    if (next === null) return;
    e.preventDefault();
    list[(next + list.length) % list.length]?.focus();
  };
  const choose = (action?: () => void) => {
    setOpen(false);
    action?.();
  };

  return (
    <div className="acct" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="acct-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={id}
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
        <span className="acct-id">{shortId(id, kind)}</span>
        <svg className="acct-chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
      </button>
      {open && (
        <div className="acct-menu" id={menuId} role="menu" aria-label={`Account ${shortId(id, kind)}`} tabIndex={-1} ref={panel} onKeyDown={onMenuKey}>
          <div className="acct-who" role="none">
            <Avatar seed={seed} size={38} />
            <span className="acct-who-text">
              <span className="acct-kind">{kind === 'evm' ? 'EVM · Base' : 'NEAR'}</span>
              <span className="acct-who-id" title={id}>{kind === 'evm' ? shortHex(id) : id}</span>
            </span>
            <CopyButton text={id} role="menuitem" />
          </div>
          {onSwitch && (
            <button type="button" role="menuitem" className="acct-item" onClick={() => choose(onSwitch)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" /></svg>
              Switch wallet
            </button>
          )}
          {onLogout && (
            <button type="button" role="menuitem" className="acct-item danger" onClick={() => choose(onLogout)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3M10.5 11l3-3-3-3M13.5 8H6" /></svg>
              Logout
            </button>
          )}
        </div>
      )}
    </div>
  );
}
