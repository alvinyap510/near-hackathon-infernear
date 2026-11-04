import { useEffect, useState, type FormEvent } from 'react';
import { ErrorNote, Spinner, errorText } from '../components/ui.tsx';
import { data, type Address, type BridgeQuote, type Chain } from '../data/index.ts';
import { formatUsd, parseUsdc, shortHex } from '../data/money.ts';

export function Bridge({ address, onDeposit }: { address: Address; onDeposit: () => void }) {
  const [chains, setChains] = useState<Chain[]>([]);
  const [from, setFrom] = useState('');
  const [input, setInput] = useState('250');
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void data.bridgeChains().then((list) => {
      setChains(list);
      setFrom(list[0]?.id ?? '');
    });
  }, []);

  const amount = parseUsdc(input);
  const chainName = (id: string) => chains.find((c) => c.id === id)?.name ?? id;

  const getQuote = async (e: FormEvent) => {
    e.preventDefault();
    if (amount === null) return setError('Enter a USDC amount, up to 6 decimals.');
    setBusy(true);
    setError(null);
    try {
      setQuote(await data.bridgeQuote(from, amount, address));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <header className="page-head rise">
        <div>
          <p className="eyebrow">From another chain</p>
          <h1 className="title">Bring USDC to Base, then deposit</h1>
        </div>
        <p className="page-note">NEAR Intents moves the funds to your own address. You stay in control at both steps.</p>
      </header>

      <ol className="bridge rise d1">
        <li className="card bridge-step">
          <span className="step-n" aria-hidden="true">01</span>
          <h2 className="card-title">Move USDC with NEAR Intents 1Click</h2>
          <p className="card-sub">Delivered to your own Base address, never to the vault or to InferNear.</p>
          <form onSubmit={getQuote} noValidate>
            <div className="row-2">
              <label className="field">
                <span className="field-k">From</span>
                <span className="input-wrap">
                  <select value={from} onChange={(e) => { setFrom(e.target.value); setQuote(null); }}>
                    {chains.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="field">
                <span className="field-k">Amount</span>
                <span className={`input-wrap ${input !== '' && amount === null ? 'bad' : ''}`}>
                  <input inputMode="decimal" value={input} onChange={(e) => { setInput(e.target.value); setQuote(null); }} />
                  <span className="unit">USDC</span>
                </span>
              </label>
            </div>
            <div className="field">
              <span className="field-k">To, on Base</span>
              <span className="input-wrap readonly">
                <code>{address}</code>
                <span className="unit">you</span>
              </span>
            </div>
            <button type="submit" className="btn primary block" disabled={busy || !from || amount === null || amount === 0n}>
              {busy ? <Spinner /> : null}
              Get quote
            </button>
            <ErrorNote error={error} />
          </form>

          {quote && (
            <div className="quote" role="status">
              <dl className="kv">
                <div>
                  <dt>You send</dt>
                  <dd>
                    {formatUsd(quote.amountIn)} USDC on {chainName(quote.fromChain)}
                  </dd>
                </div>
                <div>
                  <dt>You receive</dt>
                  <dd>
                    <strong>≈ {formatUsd(quote.amountOut)} USDC</strong> on Base
                  </dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>
                    <code>{shortHex(quote.recipient, 8, 6)}</code>
                  </dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>about {quote.etaSeconds} s</dd>
                </div>
              </dl>
              {quote.dry && (
                <p className="fineprint">Dry-run quote: it shows the price but issues no deposit address, so nothing can be sent yet.</p>
              )}
            </div>
          )}
        </li>

        <li className="bridge-arrow" aria-hidden="true">
          <svg viewBox="0 0 48 16"><path d="M0 8h44M38 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </li>

        <li className="card bridge-step">
          <span className="step-n" aria-hidden="true">02</span>
          <h2 className="card-title">Deposit into the vault</h2>
          <p className="card-sub">When the USDC lands on Base, deposit it like any other. From then on, its yield pays for your API calls.</p>
          <ul className="ticks">
            <li>Principal stays yours and redeemable</li>
            <li>Yield is attributed to you on-chain</li>
            <li>Credits appear after the next post to NEAR</li>
          </ul>
          <button type="button" className="btn outline block" onClick={onDeposit}>
            Go to deposit
          </button>
        </li>
      </ol>
    </div>
  );
}
