import { useEffect, useState, type ReactNode } from 'react';
import { Check, ErrorNote, Spinner, errorText, plainAmount, tokenAmount } from '../components/ui.tsx';
import { data, type Address, type RheaQuote, type RheaTransfer, type VaultAccount } from '../data/index.ts';
import { parseAmount, shortHex } from '../data/money.ts';

const STATUS_POLL_MS = 5_000;
const VAULT_POLL_MS = 15_000;

type StepState = 'done' | 'current' | 'todo';

function Flow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ol className="flow" aria-label={label}>
      {children}
    </ol>
  );
}

function FlowStep({ state, title, sig, children }: { state: StepState; title: string; sig?: string; children?: ReactNode }) {
  return (
    <li className={`flow-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <Check state={state === 'done' ? 'ok' : state === 'current' ? 'pending' : 'idle'} />
      <div className="flow-body">
        <span className="flow-title">
          {title}
          {sig && <span className="sig-tag">{sig}</span>}
        </span>
        {children}
      </div>
    </li>
  );
}

/** Polls a 1Click swap until it reaches a terminal status. */
function useSwapStatus(depositAddress: string | undefined, onTerminal: (status: string) => void) {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!depositAddress) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await data.rheaStatus(depositAddress);
        if (stopped) return;
        setStatus(s.status);
        if (s.terminal) return onTerminal(s.status);
      } catch {
        // A failed status read is retried on the next tick; the swap itself is unaffected.
      }
      if (!stopped) timer = setTimeout(poll, STATUS_POLL_MS);
    };
    timer = setTimeout(poll, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // One poll loop per deposit address; onTerminal is read once, when the swap ends.
  }, [depositAddress]);
  return status;
}

function QuoteTable({ quote, from, to }: { quote: RheaQuote; from: string; to: string }) {
  const usdc = { address: '', symbol: 'USDC', decimals: 6 as const };
  return (
    <dl className="kv quote-kv">
      <div>
        <dt>You send</dt>
        <dd>
          {tokenAmount(quote.amountIn, usdc)} {from}
        </dd>
      </div>
      <div>
        <dt>Arrives</dt>
        <dd>
          <strong>≈ {tokenAmount(quote.amountOut, usdc)}</strong> {to}
        </dd>
      </div>
      <div>
        <dt>At least</dt>
        <dd>{tokenAmount(quote.minAmountOut, usdc)}</dd>
      </div>
      <div>
        <dt>Bridge fee</dt>
        <dd>{tokenAmount(quote.amountIn - quote.amountOut, usdc)}</dd>
      </div>
      <div>
        <dt>Time</dt>
        <dd>about {quote.etaSeconds} s</dd>
      </div>
    </dl>
  );
}

export function RheaPanel({ address, vault, onChanged }: { address: Address; vault: VaultAccount; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>(
    vault.position.rhea && (vault.position.rhea.pendingOut !== null || vault.position.rhea.intentsBalance > 0n) ? 'withdraw' : 'deposit',
  );
  const r = vault.position.rhea;

  // The vault settles queued deposits and withdrawals on its own cycle; re-read it while anything waits.
  const waiting = r !== undefined && (r.pendingIn > 0n || r.pendingOut !== null);
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void onChanged(), VAULT_POLL_MS);
    return () => clearInterval(id);
  }, [waiting, onChanged]);

  return (
    <section className="card vault-form rhea" aria-labelledby="vault-h">
      <div className="card-row">
        <h2 id="vault-h" className="card-title">
          {vault.name}
        </h2>
        <div className="seg-control" role="radiogroup" aria-label="Action">
          {(['deposit', 'withdraw'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {m === 'deposit' ? 'Deposit' : 'Withdraw'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'deposit' ? (
        <RheaDeposit address={address} vault={vault} onChanged={onChanged} />
      ) : (
        <RheaWithdraw address={address} vault={vault} onChanged={onChanged} />
      )}
    </section>
  );
}

function RheaDeposit({ address, vault, onChanged }: { address: Address; vault: VaultAccount; onChanged: () => Promise<void> }) {
  const { asset, position } = vault;
  const r = position.rhea!;
  const [input, setInput] = useState('');
  const [quote, setQuote] = useState<RheaQuote | null>(null);
  const [busy, setBusy] = useState<'quote' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<{ transfer: RheaTransfer; sharesBefore: bigint; outcome: string | null } | null>(null);

  const amount = parseAmount(input, asset.decimals);
  const invalid = input !== '' && amount === null;

  const status = useSwapStatus(flow?.transfer.quote.depositAddress, (s) => {
    setFlow((f) => (f ? { ...f, outcome: s } : f));
    void onChanged();
  });

  const preview = async () => {
    if (amount === null || amount === 0n) return;
    setBusy('quote');
    setError(null);
    try {
      setQuote(await data.rheaQuote(address, amount, 'deposit'));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!quote) return;
    setBusy('send');
    setError(null);
    try {
      const transfer = await data.rheaDeposit(address, quote.amountIn);
      setFlow({ transfer, sharesBefore: position.shares, outcome: null });
      setQuote(null);
      setInput('');
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  if (flow) {
    const delivered = flow.outcome === 'SUCCESS';
    const failed = flow.outcome !== null && !delivered;
    const activated = delivered && position.shares > flow.sharesBefore;
    const queued = delivered && !activated && r.pendingIn > 0n;
    const returned = delivered && !activated && !queued;
    const arriving = flow.transfer.quote.amountOut;
    return (
      <div className="rhea-flow" aria-live="polite">
        <p className="card-sub">
          {activated
            ? `${tokenAmount(arriving, asset)} is now principal in the Rhea vault. Its yield becomes credits.`
            : `Moving ${tokenAmount(flow.transfer.quote.amountIn, asset)} from Base to the Rhea vault on NEAR.`}
        </p>
        <Flow label="Deposit progress">
          <FlowStep state="done" title="Sent on Base">
            <span className="flow-note">
              One USDC transfer · <code>{shortHex(flow.transfer.txHash, 10, 6)}</code>
            </span>
          </FlowStep>
          <FlowStep state={flow.outcome ? 'done' : 'current'} title="Bridging with NEAR Intents">
            <span className="flow-note">{flow.outcome ? `1Click: ${flow.outcome}` : `1Click: ${status ?? 'waiting for the deposit'}…`}</span>
          </FlowStep>
          <FlowStep state={delivered ? 'done' : 'todo'} title="Delivered to the vault">
            <span className="flow-note">≈ {tokenAmount(arriving, asset)} for {shortHex(address)}</span>
          </FlowStep>
          <FlowStep state={activated ? 'done' : queued ? 'current' : 'todo'} title="Activated on the vault’s next cycle">
            <span className="flow-note">
              {queued
                ? `Queued: ${tokenAmount(r.pendingIn, asset)}. It starts earning when the keeper runs the next cycle.`
                : 'New deposits never share yield earned before they arrive.'}
            </span>
          </FlowStep>
        </Flow>
        {failed && (
          <p className="error" role="alert">
            1Click reported {flow.outcome}. A deposit that doesn’t complete is refunded to your Base address.
          </p>
        )}
        {returned && (
          <p className="error" role="alert">
            The vault couldn’t accept this deposit (its cap or minimum), so it returned the USDC to your NEAR Intents balance. Send it
            back to Base from Withdraw.
          </p>
        )}
        {(activated || failed || returned) && (
          <button type="button" className="btn ghost" onClick={() => setFlow(null)}>
            New deposit
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="card-sub">
        Send USDC from your Base wallet. NEAR Intents delivers it to the vault in one transfer; you never need a NEAR account.
      </p>
      {r.pendingIn > 0n && (
        <p className="note">
          <Spinner /> {tokenAmount(r.pendingIn, asset)} queued; it activates on the vault’s next cycle.
        </p>
      )}
      <label className="field">
        <span className="field-k">
          Amount from Base
          <button type="button" className="link" onClick={() => { setInput(plainAmount(position.walletBalance, asset)); setQuote(null); }}>
            Wallet {tokenAmount(position.walletBalance, asset)}
          </button>
        </span>
        <span className={`input-wrap ${invalid ? 'bad' : ''}`}>
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setQuote(null);
            }}
            aria-invalid={invalid}
          />
          <span className="unit">USDC</span>
        </span>
      </label>
      {quote ? (
        <div className="quote" role="status">
          <QuoteTable quote={quote} from="on Base" to="in the vault on NEAR" />
          <p className="fineprint">Preview only. Confirming asks for a fresh quote and one USDC transfer from your wallet.</p>
          <div className="key-actions">
            <button type="button" className="btn primary" onClick={confirm} disabled={busy !== null}>
              {busy === 'send' ? <Spinner /> : null}
              {busy === 'send' ? 'Confirm in your wallet…' : 'Confirm and send'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setQuote(null)} disabled={busy !== null}>
              Change amount
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn primary block" onClick={preview} disabled={busy !== null || amount === null || amount === 0n}>
          {busy === 'quote' ? <Spinner /> : null}
          Preview deposit
        </button>
      )}
      <ErrorNote error={error} />
    </>
  );
}

function RheaWithdraw({ address, vault, onChanged }: { address: Address; vault: VaultAccount; onChanged: () => Promise<void> }) {
  const { asset, position } = vault;
  const r = position.rhea!;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<'request' | 'quote' | 'exit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<{ hash: string; sharesBefore: bigint } | null>(null);
  const [exitQuote, setExitQuote] = useState<RheaQuote | null>(null);
  const [exit, setExit] = useState<{ transfer: RheaTransfer; outcome: string | null } | null>(null);

  const claim = parseAmount(input, asset.decimals);
  const invalid = input !== '' && claim === null;
  const full = r.coverage >= 10n ** 18n;
  const coveragePct = Number((r.coverage * 10_000n) / 10n ** 18n) / 100;

  const status = useSwapStatus(exit?.transfer.quote.depositAddress, (s) => {
    setExit((x) => (x ? { ...x, outcome: s } : x));
    void onChanged();
  });

  const act = async (kind: 'request' | 'quote' | 'exit', fn: () => Promise<void>) => {
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

  const sign = () =>
    act('request', async () => {
      if (claim === null || claim === 0n) return;
      const tx = await data.rheaWithdraw(address, claim);
      setRequest({ hash: tx.txHash, sharesBefore: position.shares });
      setInput('');
      await onChanged();
    });

  const previewExit = () => act('quote', async () => setExitQuote(await data.rheaQuote(address, r.intentsBalance, 'withdraw')));

  const sendExit = () =>
    act('exit', async () => {
      if (!exitQuote) return;
      setExit({ transfer: await data.rheaExit(address, exitQuote.amountIn), outcome: null });
      setExitQuote(null);
      await onChanged();
    });

  const queued = r.pendingOut !== null;
  const inIntents = r.intentsBalance > 0n;
  // A processed request lowers the claim; one the vault couldn't fund this cycle is dropped untouched.
  const dropped = request !== null && !queued && !inIntents && !exit && position.shares === request.sharesBefore;
  const exitDone = exit?.outcome === 'SUCCESS';
  const exitFailed = exit?.outcome != null && !exitDone;

  const s1: StepState = queued || inIntents || exit || (request && !dropped) ? 'done' : 'current';
  const s2: StepState = queued ? 'current' : inIntents || exit ? 'done' : 'todo';
  const s3: StepState = exit ? 'done' : inIntents ? 'current' : 'todo';
  const s4: StepState = exitDone ? 'done' : exit ? 'current' : 'todo';

  return (
    <div aria-live="polite">
      <p className="card-sub">
        Withdrawing takes two signatures, minutes apart. In between, your USDC sits in your own NEAR Intents balance, controlled by
        this wallet’s key. InferNear can’t move it.
      </p>
      <Flow label="Withdrawal progress">
        <FlowStep state={s1} title="Request a withdrawal" sig="Signature 1 of 2">
          {s1 === 'current' ? (
            <div className="flow-form">
              <label className="field">
                <span className="field-k">
                  Principal to withdraw
                  <button type="button" className="link" onClick={() => setInput(plainAmount(position.shares, asset))}>
                    All {tokenAmount(position.shares, asset)}
                  </button>
                </span>
                <span className={`input-wrap ${invalid ? 'bad' : ''}`}>
                  <input inputMode="decimal" autoComplete="off" placeholder="0.00" value={input} onChange={(e) => setInput(e.target.value)} aria-invalid={invalid} />
                  <span className="unit">USDC</span>
                </span>
              </label>
              {!full && (
                <p className="flow-note">The vault is at {coveragePct}% coverage, so a withdrawal pays its share pro-rata.</p>
              )}
              {dropped && <p className="flow-note warn">The vault couldn’t fund that request in its last cycle. Your principal is untouched; sign a new one, smaller or later.</p>}
              <button type="button" className="btn primary" onClick={sign} disabled={busy !== null || r.busy || claim === null || claim === 0n}>
                {busy === 'request' ? <Spinner /> : null}
                {busy === 'request' ? 'Sign in your wallet…' : 'Sign request'}
              </button>
              {r.busy && <p className="flow-note">The vault is mid-cycle. Requests open again in a moment.</p>}
              <p className="flow-note">A message signature, not a transaction. No gas; InferNear submits it.</p>
            </div>
          ) : (
            <span className="flow-note">
              Signed{request ? <> · <code>{shortHex(request.hash, 10, 6)}</code></> : null}
            </span>
          )}
        </FlowStep>

        <FlowStep state={s2} title="The vault processes it">
          <span className="flow-note">
            {queued
              ? `Queued: ${tokenAmount(r.pendingOut!, asset)}. Paid out on the vault’s next cycle.`
              : 'Withdrawals queue and are paid on the vault’s next cycle, from Rhea’s available liquidity.'}
          </span>
        </FlowStep>

        <FlowStep state={s3} title="USDC in your NEAR Intents balance" sig="Signature 2 of 2">
          {inIntents && !exit ? (
            <div className="flow-form">
              <p className="holding">
                <span className="holding-v">{tokenAmount(r.intentsBalance, asset)}</span>
                <span className="holding-k">Under your key · {shortHex(address)}</span>
              </p>
              {exitQuote ? (
                <div className="quote" role="status">
                  <QuoteTable quote={exitQuote} from="from NEAR Intents" to={`at ${shortHex(address)} on Base`} />
                  <p className="fineprint">Preview only. Confirming signs a transfer intent to a fresh 1Click quote.</p>
                  <div className="key-actions">
                    <button type="button" className="btn primary" onClick={sendExit} disabled={busy !== null}>
                      {busy === 'exit' ? <Spinner /> : null}
                      {busy === 'exit' ? 'Sign in your wallet…' : 'Sign and send to Base'}
                    </button>
                    <button type="button" className="btn ghost" onClick={() => setExitQuote(null)} disabled={busy !== null}>
                      Not now
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn primary" onClick={previewExit} disabled={busy !== null}>
                  {busy === 'quote' ? <Spinner /> : null}
                  Preview the transfer to Base
                </button>
              )}
              <p className="flow-note">No rush: it stays yours here until you sign.</p>
            </div>
          ) : (
            <span className="flow-note">
              {exit ? `Sent ${tokenAmount(exit.transfer.quote.amountIn, asset)} · ${shortHex(exit.transfer.txHash, 10, 6)}` : 'Arrives here first, under your own key.'}
            </span>
          )}
        </FlowStep>

        <FlowStep state={s4} title="Back in your Base wallet">
          <span className="flow-note">
            {exitDone
              ? `≈ ${tokenAmount(exit!.transfer.quote.amountOut, asset)} arrived at ${shortHex(address)}.`
              : exit
                ? `Bridging with NEAR Intents · 1Click: ${status ?? 'pending'}…`
                : 'NEAR Intents bridges it to your own address.'}
          </span>
        </FlowStep>
      </Flow>
      {exitFailed && (
        <p className="error" role="alert">
          1Click reported {exit!.outcome}. An incomplete transfer refunds to your NEAR Intents balance.
        </p>
      )}
      {(exitDone || exitFailed) && (
        <button type="button" className="btn ghost" onClick={() => { setExit(null); setRequest(null); }}>
          Done
        </button>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
