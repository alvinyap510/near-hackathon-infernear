import { useEffect, useState, type FormEvent } from 'react';
import { data, PURCHASE_NOTICE, type Session, type TopUpAccount } from '../data/index.ts';
import { AssetBadge, ChainBadge, ErrorNote, Spinner, errorText, tokenAmount } from '../components/ui.tsx';
import { formatAmount, parseUsdc, shortHex } from '../data/money.ts';
const exact=(amount:bigint)=>`${formatAmount(amount,6,6)} USDC`;
const USDC={address:'',symbol:'USDC',decimals:6} as const;
export function TopUp({session,onChanged}:{session:Session;onChanged():Promise<void>}){
  const [account,setAccount]=useState<TopUpAccount|null>(null),[input,setInput]=useState(''),[confirm,setConfirm]=useState<bigint|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[hash,setHash]=useState('');
  useEffect(()=>{let stopped=false;void data.topUpAccount(session).then(v=>{if(!stopped)setAccount(v);}).catch(e=>{if(!stopped)setError(errorText(e));});return()=>{stopped=true;};},[session,hash]);
  if(!account)return error?<ErrorNote error={error}/>:null;
  const review=(e:FormEvent)=>{e.preventDefault();setError(null);const amount=parseUsdc(input);if(amount===null||amount<account.minimum)return setError(`Minimum purchase: ${exact(account.minimum)}.`);if(amount>account.walletBalance)return setError('That is more USDC than your wallet holds.');setConfirm(amount);};
  const buy=async()=>{if(confirm===null)return;setBusy(true);setError(null);try{const result=await data.topUp(session,confirm);setHash(result.txHash);setInput('');setConfirm(null);try{await onChanged();}catch{setError('Purchase confirmed; the balance refresh failed. Do not repeat the purchase.');}}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  return <section className="card vault-form rise" aria-labelledby="topup-h"><div className="card-row"><h2 id="topup-h" className="card-title">Add credits</h2><span className="ticket-badges"><ChainBadge name="Base"/><AssetBadge symbol="USDC"/></span></div>
    <p className="card-sub">Buy credits directly, without a strategy vault.</p><dl className="kv"><div><dt>Total bought by you</dt><dd>{tokenAmount(account.paid,USDC)}</dd></div><div><dt>Wallet</dt><dd>{tokenAmount(account.walletBalance,USDC)}</dd></div></dl>
    <form onSubmit={review}><label className="field"><span className="field-k">Amount · minimum {exact(account.minimum)}</span><span className="input-wrap"><input inputMode="decimal" value={input} disabled={busy} onChange={e=>{setInput(e.target.value);setConfirm(null);}} placeholder="0.00"/><span className="unit"><AssetBadge symbol="USDC"/></span></span></label>
      <p className="loss-note">{PURCHASE_NOTICE}</p><button className="btn primary" disabled={busy||!input}>Review purchase</button></form>
    {confirm!==null&&<div className="confirm"><p>{PURCHASE_NOTICE}</p><p>Pay {exact(confirm)} for yourself. Approval, if needed, is followed by a separate purchase transaction.</p><button className="btn primary" onClick={()=>void buy()} disabled={busy}>{busy?<Spinner/>:null}Confirm purchase</button><button className="btn ghost" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></div>}
    <p className="fineprint">Credits appear after Base finality (about 20 minutes), when the keeper posts the purchase to NEAR.</p><ErrorNote error={error}/>{hash&&<p className="success">Purchase submitted · <code>{shortHex(hash)}</code>. Waiting for finality and the keeper.</p>}</section>;
}
