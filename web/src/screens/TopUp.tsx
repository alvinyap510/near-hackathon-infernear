import { useEffect, useState, type FormEvent } from 'react';
import { data, PURCHASE_NOTICE, type Session, type TopUpAccount, type PurchaseState } from '../data/index.ts';
import { AssetBadge, ChainBadge, CopyButton, ErrorNote, Spinner, errorText, tokenAmount } from '../components/ui.tsx';
import { formatAmount, parseUsdc } from '../data/money.ts';
const exact=(amount:bigint)=>`${formatAmount(amount,6,6)} USDC`;
const USDC={address:'',symbol:'USDC',decimals:6} as const;
export function TopUp({session,onChanged}:{session:Session;onChanged():Promise<void>}){
  const [account,setAccount]=useState<TopUpAccount|null>(null),[input,setInput]=useState('');
  const [confirm,setConfirm]=useState<{session:Session;amount:bigint}|null>(null),[busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null),[purchase,setPurchase]=useState<PurchaseState|null>(null);
  useEffect(()=>{
    let stopped=false;setConfirm(null);setInput('');setAccount(null);setPurchase(null);setError(null);
    void Promise.all([data.topUpAccount(session),data.topUpPurchase(session)]).then(([account,state])=>{if(!stopped){setAccount(account);setPurchase(state);}}).catch(e=>{if(!stopped)setError(errorText(e));});
    return()=>{stopped=true;};
  },[session]);
  if(!account)return error?<ErrorNote error={error}/>:null;
  const pending=purchase!==null&&purchase.status!=='confirmed'&&purchase.status!=='reverted';
  const reviewed=confirm?.session===session?confirm.amount:null;
  const review=async(e:FormEvent)=>{
    e.preventDefault();setError(null);setConfirm(null);const amount=parseUsdc(input);
    if(amount===null||amount<account.minimum)return setError(`Minimum purchase: ${exact(account.minimum)}.`);
    if(amount>account.walletBalance)return setError('That is more USDC than your wallet holds.');
    setBusy(true);
    try{const latest=await data.topUpPurchase(session);
      if(latest&&(latest.hash!==purchase?.hash||latest.status!==purchase?.status)){setPurchase(latest);return;}
      await data.reviewTopUp(session,purchase?.hash);setPurchase(null);setConfirm({session,amount});}catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const reconcile=async()=>{
    setBusy(true);setError(null);
    try{setPurchase(await data.topUpPurchase(session));setAccount(await data.topUpAccount(session));}catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const setAside=async()=>{
    setBusy(true);setError(null);
    try{await data.setAsideUnsentTopUp(session);setPurchase(await data.topUpPurchase(session));}catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const buy=async()=>{
    if(reviewed===null)return;const amount=reviewed;
    setConfirm(null);setInput('');setBusy(true);setError(null);
    try{await data.topUp(session,amount);setPurchase(await data.topUpPurchase(session));setAccount(await data.topUpAccount(session));
      try{await onChanged();}catch{setError('Purchase confirmed; balance refresh failed. Do not repeat the purchase.');}
    }catch(e){setError(errorText(e));try{setPurchase(await data.topUpPurchase(session));}catch{/* Keep the original failure visible; another submission stays blocked in the data layer. */}}
    finally{setBusy(false);}
  };
  return <section className="card vault-form rise" aria-labelledby="topup-h">
    <div className="card-row"><h2 id="topup-h" className="card-title">Add credits</h2><span className="ticket-badges"><ChainBadge name="Base"/><AssetBadge symbol="USDC"/></span></div>
    <p className="card-sub">Buy credits directly, without a strategy vault.</p>
    <dl className="kv"><div><dt>Total bought for you</dt><dd>{tokenAmount(account.paid,USDC)}</dd></div><div><dt>Wallet</dt><dd>{tokenAmount(account.walletBalance,USDC)}</dd></div></dl>
    <form onSubmit={e=>void review(e)}><label className="field"><span className="field-k">Amount · minimum {exact(account.minimum)}</span><span className="input-wrap"><input inputMode="decimal" value={input} disabled={busy||pending} onChange={e=>{setInput(e.target.value);setConfirm(null);}} placeholder="0.00"/><span className="unit"><AssetBadge symbol="USDC"/></span></span></label>
      <p className="loss-note">{PURCHASE_NOTICE}</p><button className="btn primary" disabled={busy||pending||!input}>Review purchase</button></form>
    {reviewed!==null&&!pending&&<div className="confirm"><p>{PURCHASE_NOTICE}</p><p>Pay {exact(reviewed)} for yourself. Approval, if needed, is followed by a separate purchase transaction.</p><button className="btn primary" onClick={()=>void buy()} disabled={busy}>{busy?<Spinner/>:null}Confirm purchase</button><button className="btn ghost" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></div>}
    {purchase&&<div className="confirm"><p>{purchase.status==='confirmed'?'Previous purchase confirmed. A fresh review is required for another purchase.':purchase.status==='reverted'?'The previous purchase did not complete. Review a fresh purchase to try again.':purchase.hash?'Purchase pending or uncertain. Check its receipt; do not submit another purchase.':purchase.status==='submitting'?'The wallet did not return a transaction. Check wallet activity and reject any request still waiting there. Compare Total bought for you with the contract’s paid total on Base. Only if no purchase was sent, start again.':'Purchase storage failed after broadcast. Check wallet activity before any manual recovery.'}</p>
      <p className="fineprint">Previous request: {exact(BigInt(purchase.amount))}</p>
      {purchase.hash&&<div className="endpoint-url"><code>{purchase.hash}</code><CopyButton text={purchase.hash}/></div>}<button type="button" className="btn outline" disabled={busy} onClick={()=>void reconcile()}>Check purchase status</button>
      {pending&&!purchase.hash&&purchase.status==='submitting'&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void setAside()}>No purchase was sent: start again</button>}</div>}
    <p className="fineprint">Credits appear after Base finality (about 20 minutes), when the keeper posts the purchase to NEAR.</p><ErrorNote error={error}/>
  </section>;
}
