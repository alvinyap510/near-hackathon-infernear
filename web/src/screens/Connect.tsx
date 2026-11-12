import { useState } from 'react';
import { ErrorNote, Spinner, errorText } from '../components/ui.tsx';
import { data, type Address } from '../data/index.ts';

const CIPHER =
  '9f1c4e07a2b85d3316e0c9f47ab2d18e5c03f6a99b7e21d4c80f5a3e6b19d72c04e8a5f13b6d90c27e4f81a5d3b0c96e72f1a84d5c3b09e6f';

export function Connect({ onConnected }: { onConnected: (a: Address) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      onConnected(await data.connect());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connect">
      <section className="hero">
        <div className="hero-copy rise">
          <p className="eyebrow">An OpenAI-format API on NEAR AI’s TEE models</p>
          <h1 className="display">
            Private AI, paid for by <em>your yield.</em>
          </h1>
          <p className="lede">
            Deposit USDC on Base and keep the principal. Its yield becomes API credits for NEAR AI’s attested models.
            NEAR AI’s SDK encrypts each prompt on your machine, so InferNear only ever relays ciphertext.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn primary lg" onClick={connect} disabled={busy}>
              {busy ? <Spinner /> : <span className="btn-dot" aria-hidden="true" />}
              {busy ? 'Connecting…' : 'Connect wallet'}
            </button>
            <span className="hint">EVM wallet · no NEAR account needed</span>
          </div>
          <ErrorNote error={error} />
        </div>

        <figure className="capsule rise d2" aria-label="How a request travels">
          <figcaption className="capsule-head">
            <span>One request, end to end</span>
            <span className="capsule-tag">E2EE v3</span>
          </figcaption>
          <ol className="track">
            <li className="station">
              <span className="station-k">Your app</span>
              <span className="prompt-chip">“Summarise the Q3 board notes”</span>
            </li>
            <li className="station">
              <span className="station-k">NEAR AI SDK · on your machine</span>
              <span className="station-v">Verifies the model’s TEE, encrypts to its key</span>
              <span className="cipher" aria-hidden="true">
                <span>{CIPHER}</span>
                <span>{CIPHER}</span>
              </span>
            </li>
            <li className="station dim">
              <span className="station-k">InferNear relay</span>
              <span className="station-v">Checks your key and credits, forwards the bytes unchanged</span>
            </li>
            <li className="station glow">
              <span className="station-k">NEAR AI · Intel TDX + NVIDIA confidential GPU</span>
              <span className="station-v">Decrypts inside the enclave, signs the reply</span>
            </li>
            <li className="station">
              <span className="station-k">Back on your machine</span>
              <span className="station-v ok">Reply decrypted · signature verified</span>
            </li>
          </ol>
        </figure>
      </section>

      <section className="pillars" aria-label="What InferNear guarantees">
        <article className="pillar rise d3">
          <span className="pillar-n">01</span>
          <h2>Principal stays yours</h2>
          <p>An ERC-4626 vault with no owner, admin or upgrade key. Only you can redeem your shares. A loss in the underlying protocol is shared by depositors pro-rata; it is never covered by InferNear.</p>
        </article>
        <article className="pillar rise d4">
          <span className="pillar-n">02</span>
          <h2>Yield becomes credits</h2>
          <p>The vault attributes each holder’s yield on-chain and pays it to InferNear. Your credits on NEAR match it.</p>
        </article>
        <article className="pillar rise d5">
          <span className="pillar-n">03</span>
          <h2>Every bill is checkable</h2>
          <p>Each call is debited on NEAR with a receipt. Recompute it from the model’s signed token counts.</p>
        </article>
      </section>
    </div>
  );
}
