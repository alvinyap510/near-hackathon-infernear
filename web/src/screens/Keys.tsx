import { useState } from 'react';
import { Check, CopyButton, ErrorNote, Spinner, errorText } from '../components/ui.tsx';
import { apiBaseUrl } from '../config.ts';
import { data, type Address, type IssuedKey, type Overview, type WalletProof } from '../data/index.ts';
import { shortHex } from '../data/money.ts';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function Keys({
  address,
  overview,
  issued,
  onIssued,
  onChanged,
  onTry,
}: {
  address: Address;
  overview: Overview;
  issued: IssuedKey | null;
  onIssued: (k: IssuedKey | null) => void;
  onChanged: () => Promise<void>;
  onTry: () => void;
}) {
  const [challenge, setChallenge] = useState<WalletProof | null>(null);
  const [proof, setProof] = useState<WalletProof | null>(null);
  const [busy, setBusy] = useState<'sign' | 'create' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<{ epoch: number; tx: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const act = async (kind: 'sign' | 'create' | 'revoke', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const signProof = () =>
    act('sign', async () => {
      const p = await data.walletProof(address);
      setChallenge(p);
      setProof(p);
    });

  const actionProof = async () => {
    const p = proof ?? await data.walletProof(address);
    setChallenge(p);
    setProof(null); // A proof belongs to one action; retries obtain a new nonce.
    return p;
  };

  const create = () =>
    act('create', async () => {
      setRevoked(null);
      onIssued(await data.createKey(await actionProof()));
    });

  const revoke = () =>
    act('revoke', async () => {
      const r = await data.revokeAll(await actionProof());
      setRevoked({ epoch: r.keyEpoch, tx: r.txHash });
      setConfirmRevoke(false);
      onIssued(null);
      await onChanged();
    });

  return (
    <div className="screen">
      <header className="page-head rise">
        <div>
          <p className="eyebrow">API keys</p>
          <h1 className="title">Keys for the endpoint</h1>
        </div>
        <p className="page-note">Sign with your wallet, create a key, call the API. No deposit needed to start.</p>
      </header>

      <div className="split keys-split">
        <ol className="steps rise d1">
          <li className={`step ${proof ? 'done' : 'current'}`}>
            <span className="step-n" aria-hidden="true">01</span>
            <div className="step-body">
              <h2 className="step-title">
                <Check state={proof ? 'ok' : 'idle'} /> Sign with Ethereum
              </h2>
              <p className="step-text">Your wallet signs a standard EIP-4361 message. No transaction, no gas.</p>
              {challenge && (
                <details className="siwe">
                  <summary>Message you signed</summary>
                  <pre>{challenge.message}</pre>
                </details>
              )}
              {proof ? (
                <p className="success" role="status">
                  Wallet proof ready · single-use
                </p>
              ) : (
                <button type="button" className="btn primary" onClick={signProof} disabled={busy !== null}>
                  {busy === 'sign' ? <Spinner /> : null}
                  {busy === 'sign' ? 'Sign in your wallet…' : 'Sign proof'}
                </button>
              )}
            </div>
          </li>

          <li className={`step ${issued ? 'done' : proof ? 'current' : ''}`}>
            <span className="step-n" aria-hidden="true">02</span>
            <div className="step-body">
              <h2 className="step-title">
                <Check state={issued ? 'ok' : 'idle'} /> Create an API key
              </h2>
              <p className="step-text">Valid for 30 days. InferNear keeps no copy, so it is shown once.</p>
              {issued ? (
                <div className="key-reveal" aria-live="polite">
                  <div className="key-row">
                    <code className="key-text">{issued.key}</code>
                    <CopyButton text={issued.key} tone="seal" />
                  </div>
                  <p className="key-meta">
                    <span className="warn-dot" aria-hidden="true" /> Copy it now. It won’t be shown again.
                    <span className="sep">·</span> Expires {day(issued.expiresAt)}
                    <span className="sep">·</span> Key epoch {issued.keyEpoch}
                  </p>
                  <div className="key-actions">
                    <button type="button" className="btn primary on-seal" onClick={onTry}>
                      Try it now →
                    </button>
                    <button type="button" className="btn ghost on-seal" onClick={create} disabled={busy !== null}>
                      Create another
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn primary" onClick={create} disabled={!proof || busy !== null}>
                  {busy === 'create' ? <Spinner /> : null}
                  Create key
                </button>
              )}
            </div>
          </li>

          <li className="step danger">
            <span className="step-n" aria-hidden="true">03</span>
            <div className="step-body">
              <h2 className="step-title">Revoke all keys</h2>
              <p className="step-text">
                Raises your key epoch on NEAR. Every key issued under an earlier epoch stops working at once.
              </p>
              <p className="epoch">
                On-chain key epoch <strong>{overview.credits.keyEpoch}</strong>
                {revoked && (
                  <span className="success inline">
                    {' '}
                    · raised to {revoked.epoch} in tx <code>{shortHex(revoked.tx, 8, 6)}</code>
                  </span>
                )}
              </p>
              {confirmRevoke ? (
                <div className="confirm">
                  <span>Every key you have stops working.</span>
                  <button type="button" className="btn danger" onClick={revoke} disabled={busy !== null}>
                    {busy === 'revoke' ? <Spinner /> : null}
                    Revoke all
                  </button>
                  <button type="button" className="btn ghost" onClick={() => setConfirmRevoke(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button type="button" className="btn outline-danger" onClick={() => setConfirmRevoke(true)} disabled={busy !== null}>
                  Revoke all keys…
                </button>
              )}
            </div>
          </li>
        </ol>

        <aside className="card endpoint rise d2" aria-labelledby="endpoint-h">
          <h2 id="endpoint-h" className="card-title">
            Endpoint
          </h2>
          <div className="endpoint-url">
            <code>{apiBaseUrl()}</code>
            <CopyButton text={apiBaseUrl()} />
          </div>
          <dl className="kv">
            <div>
              <dt>Format</dt>
              <dd>OpenAI Chat Completions</dd>
            </div>
            <div>
              <dt>Auth</dt>
              <dd>
                <code>Authorization: Bearer inf_…</code>
              </dd>
            </div>
            <div>
              <dt>Client</dt>
              <dd>NEAR AI’s SDK with E2EE v3. Unencrypted requests are refused.</dd>
            </div>
            <div>
              <dt>Models</dt>
              <dd>NEAR AI’s attested TEE models only</dd>
            </div>
          </dl>
          <h3 className="mini-h">Routes</h3>
          <ul className="routes">
            <li>
              <span className="verb">GET</span> <code>/models</code> <span className="free">free</span>
            </li>
            <li>
              <span className="verb">GET</span> <code>/attestation/report</code> <span className="free">free</span>
            </li>
            <li>
              <span className="verb post">POST</span> <code>/chat/completions</code> <span className="paid">credits</span>
            </li>
          </ul>
          <h3 className="mini-h">Errors</h3>
          <ul className="codes">
            <li><code>401</code> bad, expired or revoked key</li>
            <li><code>402</code> not enough credits</li>
            <li><code>400</code> unencrypted or unsupported parameter</li>
            <li><code>429</code> more than 4 requests in flight</li>
          </ul>
        </aside>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
