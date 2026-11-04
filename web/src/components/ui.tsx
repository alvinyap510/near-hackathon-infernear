import { useState, type ReactNode } from 'react';

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

export function SealGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="seal-glyph">
      <rect width="32" height="32" rx="8" fill="var(--seal)" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="var(--signal)" strokeWidth="2.5" />
      <circle cx="16" cy="16" r="3" fill="var(--signal)" />
    </svg>
  );
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
