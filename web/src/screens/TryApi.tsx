import { useEffect, useState } from 'react';
import { Check, CopyButton, ErrorNote, Spinner, errorText } from '../components/ui.tsx';
import { observeFreeCalls, observeRunDebit } from '../data/chat.ts';
import { apiBaseUrl } from '../config.ts';
import { data, DataError, type Attestation, type Model, type RunResult, type FreeCalls } from '../data/index.ts';
import { formatPerMillion, formatUsd, shortHex, expectedDebit } from '../data/money.ts';
import { quickstartJs, quickstartPython, quickstartPrivateJs, quickstartPrivatePython, SDK_PIN } from '../quickstart.ts';
// The relay's own default reply cap (RELAY_MAX_TOKENS). A smaller cap cut reasoning models off before any visible answer.
const MAX_TOKENS=4096;
export function TryApi({apiKey,onChanged,onKeys,onCredits}:{apiKey:string|null;onChanged():Promise<void>;onKeys():void;onCredits():void}){
  const [models,setModels]=useState<Model[]>([]),[model,setModel]=useState<Model|null>(null),[mode,setMode]=useState<'standard'|'private'>('standard'),[lang,setLang]=useState<'js'|'py'>('js');
  const [key,setKey]=useState(apiKey??''),[prompt,setPrompt]=useState('Reply with the word ok.'),[running,setRunning]=useState(false),[error,setError]=useState<string|null>(null),[needsCredits,setNeedsCredits]=useState(false);
  const [quota,setQuota]=useState<{key:string;count:FreeCalls|null}|null>(null),[quotaRefresh,setQuotaRefresh]=useState(0);
  const freeCalls=quota?.key===key?quota.count:null;
  useEffect(()=>observeFreeCalls(key,data.freeCalls,count=>setQuota({key,count})),[key,quotaRefresh]);
  const [text,setText]=useState(''),[attestation,setAttestation]=useState<Attestation|null>(null),[result,setResult]=useState<RunResult|null>(null);
  useEffect(()=>{void data.models().then(list=>{setModels(list);setModel(list[0]??null);}).catch(e=>setError(errorText(e)));},[]);
  const render=mode==='standard'?(lang==='js'?quickstartJs:quickstartPython):(lang==='js'?quickstartPrivateJs:quickstartPrivatePython);
  const code=render({baseUrl:apiBaseUrl(),model:model?.id??'<model>',maxTokens:MAX_TOKENS});
  const run=async()=>{
    if(!model||!key)return;setRunning(true);setError(null);setNeedsCredits(false);setResult(null);setAttestation(null);setText('');
    try{const r=await data.run({key,model,prompt,maxTokens:MAX_TOKENS,mode},event=>{if(event.kind==='text')setText(t=>t+event.delta);if(mode==='private'&&event.kind==='attested')setAttestation(event.attestation);});setResult({...r,mode});if(mode==='private'&&r.attestation)setAttestation(r.attestation);try{await onChanged();}catch{/* Completed inference remains visible if a separate balance refresh fails. */}}
    catch(e){setError(errorText(e));setNeedsCredits(e instanceof DataError&&(e.code==='insufficient_credit'||e.code==='credits'||e.code==='http_402'));}finally{setRunning(false);setQuotaRefresh(value=>value+1);}
  };
  return <div className="screen"><header className="page-head rise"><div><p className="eyebrow">Try the API</p><h1 className="title">Make a call</h1></div><p className="page-note">{data.isMock?'Mock source: calls and verification are simulated.':'Both modes call the live relay from this tab.'}</p></header>
    <div className="seg-control" role="tablist" aria-label="Chat mode">{(['standard','private'] as const).map(m=><button key={m} type="button" role="tab" aria-selected={mode===m} className={mode===m?'on':''} disabled={running} onClick={()=>{setMode(m);setResult(null);setAttestation(null);setText('');setError(null);}}>{m==='standard'?'Standard':'Private'}</button>)}</div>
    <p className="loss-note">{mode==='standard'?'In standard mode the relay can read your prompt and reply in transit. The model runs in NEAR AI’s TEE; this panel does not verify a response signature.':'Private mode runs NEAR AI’s SDK in this tab: it verifies the model’s TEE, encrypts your prompt to the model’s key before it leaves, and checks the signature on the reply. The relay sees only ciphertext. A run takes 20 to 30 seconds.'}</p>
    <div className="try-grid"><section className="codecard rise"><div className="codecard-head"><div className="lang-tabs">{(['js','py'] as const).map(l=><button key={l} type="button" onClick={()=>setLang(l)} aria-selected={lang===l}>{l==='js'?'JavaScript':'Python'}</button>)}</div><CopyButton text={code} tone="seal"/></div><pre className="code" tabIndex={0}><code>{code}</code></pre><p className="codecard-foot">{mode==='standard'?'Official OpenAI package · custom base URL and your key':`Private SDK ${SDK_PIN.repo}@${SDK_PIN.commit.slice(0,7)} · E2EE v3 · response verification`}</p></section>
    <div className="console"><section className="card run rise"><div className="card-row"><h2 className="card-title">Run it here</h2>{data.isRunMock&&<span className="sim-tag">Simulation</span>}</div>
      <label className="field"><span className="field-k">Model</span><span className="input-wrap"><select value={model?.id??''} disabled={running} onChange={e=>setModel(models.find(m=>m.id===e.target.value)??null)}>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></span></label>{model&&<p className="fineprint">Input {formatPerMillion(model.inPriceNano)} · output {formatPerMillion(model.outPriceNano)} · max {MAX_TOKENS} output tokens</p>}
      <><label className="field"><span className="field-k">Your API key · kept only in this tab</span><span className="input-wrap"><input type="password" autoComplete="off" value={key} disabled={running} onChange={e=>setKey(e.target.value)} placeholder="inf_…"/></span></label><label className="field"><span className="field-k">Prompt</span><textarea rows={3} value={prompt} disabled={running} onChange={e=>setPrompt(e.target.value)}/></label><button type="button" className="btn primary block" disabled={running||!model||!prompt.trim()||!key} onClick={()=>void run()}>{running?<Spinner/>:null}{running?(mode==='private'&&!attestation?'Verifying the model’s TEE…':'Waiting for the reply…'):data.isRunMock?'Run simulation':mode==='private'?'Run private call':'Run standard call'}</button>{freeCalls&&freeCalls.remaining>0&&<p className="fineprint">{freeCalls.remaining} free {freeCalls.remaining===1?'call':'calls'} left</p>}{!key&&<button type="button" className="btn outline" onClick={onKeys}>Create an API key</button>}</>
      <ErrorNote error={error}/>{needsCredits&&<div className="needs-key"><p>{freeCalls?.remaining===0?'No free calls left or available credits (402).':'No available credits (402).'} Deposit into a vault or add credits.</p><button className="btn primary" onClick={onCredits}>Deposit or add credits</button></div>}
      {result&&!text&&<p className="fineprint">This completion produced no visible answer. {result.billing==='free'?'Reported usage is shown below.':'It may still be charged; usage and the inference debit are shown below.'}</p>}
      {text&&<div className="exchange"><div className="reply"><span className="wire-k">Reply</span><p className="reply-v">{text}</p></div></div>}{result&&<p className="fineprint">Inference-Id: <code>{result.receipt.inferenceId}</code><br/>Completion: <code>{result.completionId||'Not provided'}</code></p>}</section>
      {attestation&&<Verified attestation={attestation} result={result}/>} {result&&<BillCheck result={result}/>}</div></div></div>;
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
      note: 'generated in this tab for this run',
      ok: true,
    },
    {
      k: 'Gateway images',
      v: attestation.deploymentProvenance === 'verified' ? 'NEAR’s builds, per provenance policy' : 'not checked',
      note: 'the model image check is not run',
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
      v: result?.reply ? `${result.reply.signatureKind === 'provider_tee' ? 'Signed by the model TEE' : 'Signed by NEAR’s gateway'} · ${shortHex(result.reply.signer)}` : 'waiting for the reply',
      ok: !!result?.reply,
    },
  ];
  return (
    <section className="verified rise" aria-labelledby="ver-h">
      <div className="verified-head">
        <div className="title-group">
          <h2 id="ver-h" className="card-title">
            Verified
          </h2>
          {data.isRunMock && <span className="sim-tag">Simulation</span>}
        </div>
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
        {data.isRunMock ? 'Simulated verification results; no TEE or signature was checked.' :
          <>From <code>client.verify(model)</code> and <code>client.verifyResponse(id)</code>, checked in this browser.</>}
      </p>
    </section>
  );
}

function BillCheck({ result }: { result: RunResult }) {
  const { receipt } = result;
  const [debited, setDebited] = useState<bigint | null | undefined>(undefined);
  const [debitError,setDebitError]=useState<string|null>(null);

  useEffect(() => {
    setDebited(undefined);
    setDebitError(null);
    return observeRunDebit(result,data,value=>{setDebited(value);setDebitError(null);},error=>setDebitError(errorText(error)));
  }, [result]);

  if(result.billing==='free')return <section className="card bill rise" aria-labelledby="bill-h">
    <div className="card-row"><h2 id="bill-h" className="card-title">Reported usage</h2><span className="badge">Free trial</span></div>
    <table className="bill-table"><tbody>{receipt.source==='signed_usage'?<>
      <tr><th scope="row">Prompt tokens</th><td>{receipt.promptTokens}</td></tr>
      <tr><th scope="row">Completion tokens</th><td>{receipt.completionTokens}</td></tr>
    </>:<tr><th scope="row">Token usage</th><td>Not provided by the upstream</td></tr>}
      <tr className="total"><td colSpan={2}>Free trial call: paid by InferNear, not charged to your credits.</td></tr>
    </tbody></table>
    <p className="fineprint">{data.isRunMock?'Simulated free call; no NEAR debit.':result.mode==='private'&&result.reply?`Usage is read from the reply ${result.reply.signatureKind==='provider_tee'?'the model signed':'NEAR’s gateway signed'}. No NEAR debit.`:'Usage is reported by the upstream, not signature-verified. No NEAR debit.'}</p>
  </section>;

  const expected = expectedDebit(receipt, result.reservation);
  const signed = receipt.source === 'signed_usage';
  const verdict =
    debited === undefined
      ? 'reading'
      : debited === null
        ? 'missing'
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
            ? (data.isRunMock ? 'Reading mock debit…' : 'Reading NEAR…')
            : verdict === 'missing'
              ? 'Debit not on NEAR yet'
              : verdict === 'match'
                  ? (signed ? 'Matches capped usage' : 'Matches reserved maximum')
                  : verdict === 'under'
                    ? 'Below the expected debit'
                    : 'Different from the listed-price estimate'}
        </span>
      </div>
      <ErrorNote error={debitError}/>
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
                <th scope="row">Capped usage × price</th>
                <td colSpan={2}>{formatUsd(expected, 6)}</td>
              </tr>
            </>
          ) : (
            <tr>
              <th scope="row">Token counts</th>
              <td colSpan={2}><span>charged at the reserved maximum: no usage returned</span> · {formatUsd(expected, 6)}</td>
            </tr>
          )}
          <tr className="total">
            <th scope="row">
              {data.isRunMock ? 'Simulated debit' : 'Debited on NEAR'} <span className="muted">debited_amount(id)</span>
            </th>
            <td colSpan={2}>{debited === undefined ? '…' : debited === null ? 'none yet' : formatUsd(debited, 6)}</td>
          </tr>
        </tbody>
      </table>
      <p className="fineprint">
        Inference <code>{shortHex(receipt.inferenceId, 8, 4)}</code> · token counts are{' '}
        {signed ? (result.mode==='standard'?'reported by the upstream, not signature-verified':result.reply?.signatureKind==='gateway'?'from the gateway-signed usage':'from the model-signed usage') : 'not model-signed'}. This estimate uses the listed-price snapshot; the on-chain debit is authoritative. Expected debit is min(usage × price, reservation),
        or the full reservation when usage is absent.
      </p>
    </section>
  );
}
