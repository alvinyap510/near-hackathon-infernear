import { useEffect, useState } from 'react';
import { Check, CopyButton, ErrorNote, Spinner, errorText } from '../components/ui.tsx';
import { apiBaseUrl } from '../config.ts';
import { data, type Attestation, type Model, type RunResult } from '../data/index.ts';
import { formatPerMillion, formatUsd, shortHex, signedUsageCost } from '../data/money.ts';
import { quickstartJs, quickstartPython, SDK_PIN } from '../quickstart.ts';

const MAX_TOKENS = 256;
const LANGS = [
  { id: 'js', label: 'JavaScript', render: quickstartJs },
  { id: 'py', label: 'Python', render: quickstartPython },
] as const;

type Phase = 'idle' | 'attesting' | 'encrypting' | 'streaming' | 'done';

export function TryApi({ apiKey, onChanged, onKeys }: { apiKey: string | null; onChanged: () => Promise<void>; onKeys: () => void }) {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState<Model | null>(null);
  const [lang, setLang] = useState<(typeof LANGS)[number]['id']>('js');
  const [prompt, setPrompt] = useState('In one sentence, what does a TEE attestation prove?');
  const [phase, setPhase] = useState<Phase>('idle');
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [cipher, setCipher] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void data.models().then((list) => {
      setModels(list);
      setModel(list[0] ?? null);
    });
  }, []);

  const code = (LANGS.find((l) => l.id === lang) ?? LANGS[0]).render({
    baseUrl: apiBaseUrl(),
    model: model?.id ?? '<model>',
    maxTokens: MAX_TOKENS,
  });

  const run = async () => {
    if (!apiKey || !model) return;
    setError(null);
    setResult(null);
    setAttestation(null);
    setCipher('');
    setText('');
    setPhase('attesting');
    try {
      const r = await data.run({ key: apiKey, model, prompt, maxTokens: MAX_TOKENS }, (ev) => {
        if (ev.kind === 'attested') {
          setAttestation(ev.attestation);
          setPhase('encrypting');
        } else if (ev.kind === 'encrypted') {
          setCipher(ev.ciphertext);
          setPhase('streaming');
        } else setText((t) => t + ev.delta);
      });
      setResult(r);
      setPhase('done');
      await onChanged();
    } catch (e) {
      setError(errorText(e));
      setPhase('idle');
    }
  };

  const running = phase !== 'idle' && phase !== 'done';

  return (
    <div className="screen">
      <header className="page-head rise">
        <div>
          <p className="eyebrow">Try the API</p>
          <h1 className="title">One encrypted call, verified end to end</h1>
        </div>
        <p className="page-note">
          This code is the whole integration. <strong>Run</strong> makes the same call from this browser with your key.
        </p>
      </header>

      <div className="try-grid">
        <section className="codecard rise d1" aria-labelledby="qs-h">
          <div className="codecard-head">
            <h2 id="qs-h" className="sr-only">
              Quickstart
            </h2>
            <div className="lang-tabs" role="tablist" aria-label="Language">
              {LANGS.map((l) => (
                <button key={l.id} type="button" role="tab" aria-selected={lang === l.id} onClick={() => setLang(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
            <CopyButton text={code} tone="seal" />
          </div>
          <pre className="code" tabIndex={0} aria-label={`${lang === 'js' ? 'JavaScript' : 'Python'} quickstart`}>
            <code>{code}</code>
          </pre>
          <p className="codecard-foot">
            SDK pinned at <code>{SDK_PIN.repo}@{SDK_PIN.commit.slice(0, 7)}</code>, the E2EE v3 build. The relay refuses older
            versions.
          </p>
        </section>

        <div className="console">
          <section className="card run rise d2" aria-labelledby="run-h">
            <div className="card-row">
              <h2 id="run-h" className="card-title">
                Run it here
              </h2>
              {model && (
                <span className="model-chip" title={model.id}>
                  {models.length > 1 ? (
                    <select
                      aria-label="Model"
                      value={model.id}
                      onChange={(e) => setModel(models.find((m) => m.id === e.target.value) ?? model)}
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    model.name
                  )}
                  <span className="model-price">
                    in {formatPerMillion(model.inPriceNano)} · out {formatPerMillion(model.outPriceNano)}
                  </span>
                </span>
              )}
            </div>
            <label className="field">
              <span className="field-k">Prompt</span>
              <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </label>
            {apiKey ? (
              <button type="button" className="btn primary block" onClick={run} disabled={running || !prompt.trim()}>
                {running ? <Spinner /> : <span className="btn-dot" aria-hidden="true" />}
                {phase === 'attesting'
                  ? 'Verifying the model’s TEE…'
                  : phase === 'encrypting'
                    ? 'Encrypting to the model key…'
                    : phase === 'streaming'
                      ? 'Decrypting the reply…'
                      : 'Run'}
              </button>
            ) : (
              <div className="needs-key">
                <span>Run uses your own API key, held only in this tab.</span>
                <button type="button" className="btn primary" onClick={onKeys}>
                  Create a key first
                </button>
              </div>
            )}
            <ErrorNote error={error} />

            {(cipher || text) && (
              <div className="exchange" aria-live="polite">
                <div className="wire">
                  <span className="wire-k">What the relay sees</span>
                  <code className="wire-v">{cipher}</code>
                </div>
                <div className="reply">
                  <span className="wire-k">What you see</span>
                  <p className="reply-v">
                    {text}
                    {phase === 'streaming' && <span className="caret" aria-hidden="true" />}
                  </p>
                </div>
              </div>
            )}
          </section>

          {attestation && <Verified attestation={attestation} result={result} />}
          {result && <BillCheck result={result} />}
        </div>
      </div>
    </div>
  );
}

function Verified({ attestation, result }: { attestation: Attestation; result: RunResult | null }) {
  const rows = [
    {
      k: 'TEE hardware',
      v: `Intel TDX ${attestation.tcbStatus} · NVIDIA GPU ${attestation.gpuEvidence}`,
      ok: true,
    },
    {
      k: 'Fresh nonce',
      v: shortHex(attestation.nonce, 16, 8),
      note: 'generated here, cache off',
      ok: true,
    },
    {
      k: 'Images',
      v: attestation.deploymentProvenance === 'verified' ? 'NEAR’s builds, per provenance policy' : 'not checked',
      ok: attestation.deploymentProvenance === 'verified',
    },
    {
      k: 'Model signing key',
      v: shortHex(attestation.modelSigningKey, 12, 8),
      note: 'your prompt was encrypted to this key',
      ok: true,
    },
    {
      k: 'Reply signature',
      v: result ? `${result.reply.signatureKind === 'provider_tee' ? 'Signed by the model TEE' : 'Signed by NEAR’s gateway'} · ${shortHex(result.reply.signer)}` : 'waiting for the reply',
      ok: result !== null,
    },
  ];
  return (
    <section className="verified rise" aria-labelledby="ver-h">
      <div className="verified-head">
        <h2 id="ver-h" className="card-title">
          Verified
        </h2>
        <span className="verified-model">{attestation.model}</span>
      </div>
      <ul className="ver-list">
        {rows.map((r) => (
          <li key={r.k} className={r.ok ? 'ok' : 'pending'}>
            <Check state={r.ok ? 'ok' : 'pending'} />
            <span className="ver-k">{r.k}</span>
            <span className="ver-v">
              <code>{r.v}</code>
              {r.note && <span className="ver-note">{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="verified-foot">
        From <code>client.verify(model)</code> and <code>client.verifyResponse(id)</code>, checked in this browser.
      </p>
    </section>
  );
}

function BillCheck({ result }: { result: RunResult }) {
  const { receipt } = result;
  const [debited, setDebited] = useState<bigint | null | undefined>(undefined);

  useEffect(() => {
    setDebited(undefined);
    void data.debitedAmount(receipt.inferenceId).then(setDebited);
  }, [receipt.inferenceId]);

  const expected = signedUsageCost(receipt);
  const signed = receipt.source === 'signed_usage';
  const verdict =
    debited === undefined
      ? 'reading'
      : debited === null
        ? 'missing'
        : !signed || expected === null
          ? 'reported'
          : debited === expected
            ? 'match'
            : debited < expected
              ? 'under'
              : 'over';

  return (
    <section className="card bill rise" aria-labelledby="bill-h">
      <div className="card-row">
        <h2 id="bill-h" className="card-title">
          Bill check
        </h2>
        <span className={`verdict ${verdict}`} role="status">
          {verdict === 'reading'
            ? 'Reading NEAR…'
            : verdict === 'missing'
              ? 'Debit not on NEAR yet'
              : verdict === 'reported'
                ? 'NEAR-reported cost'
                : verdict === 'match'
                  ? 'Matches the signed usage'
                  : verdict === 'under'
                    ? 'Capped at the reservation'
                    : 'Charged above signed usage'}
        </span>
      </div>
      <table className="bill-table">
        <tbody>
          {signed ? (
            <>
              <tr>
                <th scope="row">Prompt tokens</th>
                <td>{receipt.promptTokens}</td>
                <td>× {formatPerMillion(receipt.inPriceNano)}</td>
              </tr>
              <tr>
                <th scope="row">Completion tokens</th>
                <td>{receipt.completionTokens}</td>
                <td>× {formatPerMillion(receipt.outPriceNano)}</td>
              </tr>
              <tr className="total">
                <th scope="row">Signed usage × price</th>
                <td colSpan={2}>{expected !== null ? formatUsd(expected, 6) : '—'}</td>
              </tr>
            </>
          ) : (
            <tr>
              <th scope="row">Token counts</th>
              <td colSpan={2}>No signed usage in this reply; NEAR AI’s billing reported the cost</td>
            </tr>
          )}
          <tr className="total">
            <th scope="row">
              Debited on NEAR <span className="muted">debited_amount(id)</span>
            </th>
            <td colSpan={2}>{debited === undefined ? '…' : debited === null ? 'none yet' : formatUsd(debited, 6)}</td>
          </tr>
        </tbody>
      </table>
      <p className="fineprint">
        Inference <code>{shortHex(receipt.inferenceId, 8, 4)}</code> · token counts are{' '}
        {signed ? 'from the model-signed usage' : 'not model-signed'}. A debit is never above the amount reserved when the
        call was admitted.
      </p>
    </section>
  );
}
