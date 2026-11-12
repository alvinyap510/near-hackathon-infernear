import { useEffect, useState } from 'react';
import { Check, CopyButton, ErrorNote, Spinner, errorText } from '../components/ui.tsx';
import { apiBaseUrl } from '../config.ts';
import { data, DataError, type Attestation, type Model, type RunResult } from '../data/index.ts';
import { formatPerMillion, formatUsd, shortHex, expectedDebit } from '../data/money.ts';
import { quickstartJs, quickstartPython, quickstartPrivateJs, quickstartPrivatePython, SDK_PIN } from '../quickstart.ts';
const MAX_TOKENS=64;
export function TryApi({apiKey,onChanged,onKeys,onCredits}:{apiKey:string|null;onChanged():Promise<void>;onKeys():void;onCredits():void}){
  const [models,setModels]=useState<Model[]>([]),[model,setModel]=useState<Model|null>(null),[mode,setMode]=useState<'standard'|'private'>('standard'),[lang,setLang]=useState<'js'|'py'>('js');
  const [key,setKey]=useState(apiKey??''),[prompt,setPrompt]=useState('Reply with the word ok.'),[running,setRunning]=useState(false),[error,setError]=useState<string|null>(null),[needsCredits,setNeedsCredits]=useState(false);
  const [text,setText]=useState(''),[attestation,setAttestation]=useState<Attestation|null>(null),[result,setResult]=useState<RunResult|null>(null);
  useEffect(()=>{void data.models().then(list=>{setModels(list);setModel(list[0]??null);}).catch(e=>setError(errorText(e)));},[]);
  const privateCodeOnly=mode==='private'&&!data.isMock;
  const render=mode==='standard'?(lang==='js'?quickstartJs:quickstartPython):(lang==='js'?quickstartPrivateJs:quickstartPrivatePython);
  const code=render({baseUrl:apiBaseUrl(),model:model?.id??'<model>',maxTokens:MAX_TOKENS});
  const run=async()=>{
    if(!model||!key)return;setRunning(true);setError(null);setNeedsCredits(false);setResult(null);setAttestation(null);setText('');
    try{const r=await data.run({key,model,prompt,maxTokens:MAX_TOKENS,mode},event=>{if(event.kind==='text')setText(t=>t+event.delta);if(mode==='private'&&event.kind==='attested')setAttestation(event.attestation);});setResult({...r,mode});if(mode==='private'&&r.attestation)setAttestation(r.attestation);try{await onChanged();}catch{/* Completed inference remains visible if a separate balance refresh fails. */}}
    catch(e){setError(errorText(e));setNeedsCredits(e instanceof DataError&&(e.code==='insufficient_credit'||e.code==='credits'||e.code==='http_402'));}finally{setRunning(false);}
  };
  return <div className="screen"><header className="page-head rise"><div><p className="eyebrow">Try the API</p><h1 className="title">Make a call with your credits</h1></div><p className="page-note">{data.isMock?'Mock source: calls and verification are simulated.':'Standard mode calls the live relay. Private mode is available from your code.'}</p></header>
    <div className="seg-control" role="tablist" aria-label="Chat mode">{(['standard','private'] as const).map(m=><button key={m} type="button" role="tab" aria-selected={mode===m} className={mode===m?'on':''} disabled={running} onClick={()=>{setMode(m);setResult(null);setAttestation(null);setText('');setError(null);}}>{m==='standard'?'Standard':'Private'}</button>)}</div>
    <p className="loss-note">{mode==='standard'?'In standard mode the relay can read your prompt and reply in transit. The model runs in NEAR AI’s TEE; this panel does not verify a response signature.':'Private mode encrypts to the model key with NEAR AI’s SDK. Browser completion verification is not validated in this release; run the quickstart from your code.'}</p>
    <div className="try-grid"><section className="codecard rise"><div className="codecard-head"><div className="lang-tabs">{(['js','py'] as const).map(l=><button key={l} type="button" onClick={()=>setLang(l)} aria-selected={lang===l}>{l==='js'?'JavaScript':'Python'}</button>)}</div><CopyButton text={code} tone="seal"/></div><pre className="code" tabIndex={0}><code>{code}</code></pre><p className="codecard-foot">{mode==='standard'?'Official OpenAI package · custom base URL and your key':`Private SDK ${SDK_PIN.repo}@${SDK_PIN.commit.slice(0,7)} · E2EE v3 · response verification`}</p></section>
    <div className="console"><section className="card run rise"><div className="card-row"><h2 className="card-title">{privateCodeOnly?'Run private mode from your code':'Run it here'}</h2>{data.isRunMock&&<span className="sim-tag">Simulation</span>}</div>
      <label className="field"><span className="field-k">Model</span><span className="input-wrap"><select value={model?.id??''} disabled={running} onChange={e=>setModel(models.find(m=>m.id===e.target.value)??null)}>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></span></label>{model&&<p className="fineprint">Input {formatPerMillion(model.inPriceNano)} · output {formatPerMillion(model.outPriceNano)} · max {MAX_TOKENS} output tokens</p>}
      {privateCodeOnly?<p className="card-sub">No browser inference is sent in this mode. Copy the SDK quickstart; no simulated reply or verification will be substituted.</p>:<><label className="field"><span className="field-k">Your API key · kept only in this tab</span><span className="input-wrap"><input type="password" autoComplete="off" value={key} disabled={running} onChange={e=>setKey(e.target.value)} placeholder="inf_…"/></span></label><label className="field"><span className="field-k">Prompt</span><textarea rows={3} value={prompt} disabled={running} onChange={e=>setPrompt(e.target.value)}/></label><button type="button" className="btn primary block" disabled={running||!model||!prompt.trim()||!key} onClick={()=>void run()}>{running?<Spinner/>:null}{running?'Waiting for the reply…':data.isRunMock?'Run simulation':'Run standard call'}</button>{!key&&<button type="button" className="btn outline" onClick={onKeys}>Create an API key</button>}</>}
      <ErrorNote error={error}/>{needsCredits&&<div className="needs-key"><p>No available credits (402). Deposit into a vault or add credits.</p><button className="btn primary" onClick={onCredits}>Deposit or add credits</button></div>}
      {result&&!text&&<p className="fineprint">This completion produced no visible answer. It may still be charged; usage and the inference debit are shown below.</p>}
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
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const value=data.isRunMock?result.simulatedDebit??null:await data.debitedAmount(receipt.inferenceId);if(stopped)return;setDebited(value);setDebitError(null);if(value===null&&!data.isRunMock)timer=setTimeout(poll,3000);}catch(e){if(!stopped){setDebitError(errorText(e));timer=setTimeout(poll,5000);}}};
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  }, [receipt.inferenceId, result.simulatedDebit]);

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
        {signed ? (result.mode==='standard'?'reported by the upstream, not signature-verified':'from the model-signed usage') : 'not model-signed'}. This estimate uses the listed-price snapshot; the on-chain debit is authoritative. Expected debit is min(usage × price, reservation),
        or the full reservation when usage is absent.
      </p>
    </section>
  );
}
