import { useEffect, useState, type FormEvent } from 'react';
import { data, PURCHASE_NOTICE, type Session, type TopUpAccount, type PurchaseState } from '../data/index.ts';
import { AssetBadge, ChainBadge, CopyButton, ErrorNote, Spinner, errorText } from '../components/ui.tsx';
import { formatAmount, formatUsd, parseUsdc, shortHex } from '../data/money.ts';
const exact=(amount:bigint)=>`${formatAmount(amount,6,6)} USDC`;
export function TopUp({session,credited,onChanged}:{session:Session;credited:bigint;onChanged():Promise<void>}){
  const [account,setAccount]=useState<TopUpAccount|null>(null),[input,setInput]=useState('');
  const [confirm,setConfirm]=useState<{session:Session;amount:bigint}|null>(null),[busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null),[purchase,setPurchase]=useState<PurchaseState|null>(null);
  // `bought` is the credited total when the last purchase here confirmed; the page watches for its credits until `until`.
  const [bought,setBought]=useState<bigint|null>(null),[until,setUntil]=useState(()=>Date.now()+120_000),[poll,setPoll]=useState(0);
  // Credits are behind when less is credited than was bought, or when nothing has arrived since a purchase made here.
  const behind=account!==null&&(credited<account.paid||(bought!==null&&credited<=bought));
  // While they are behind, re-read the balances every 5 seconds (for at most 2 minutes), so the credits show up on their own.
  useEffect(()=>{
    if(!behind||Date.now()>until)return;
    const timer=setTimeout(()=>{void onChanged().catch(()=>{}).finally(()=>setPoll(n=>n+1));},5000);
    return()=>clearTimeout(timer);
  },[behind,until,poll,credited]);
  useEffect(()=>{
    let stopped=false;setConfirm(null);setInput('');setAccount(null);setPurchase(null);setError(null);setBought(null);setUntil(Date.now()+120_000);
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
    try{await data.topUp(session,amount);setBought(credited);setUntil(Date.now()+120_000);setPurchase(await data.topUpPurchase(session));setAccount(await data.topUpAccount(session));
      try{await onChanged();}catch{setError('Purchase confirmed; balance refresh failed. Do not repeat the purchase.');}
    }catch(e){setError(errorText(e));try{setPurchase(await data.topUpPurchase(session));}catch{/* Keep the original failure visible; another submission stays blocked in the data layer. */}}
    finally{setBusy(false);}
  };
  // Presentation only: whether the review step replaces the Review row, and the label and tone of a recorded purchase.
  const reviewing=reviewed!==null&&!pending;
  const wallet=session.kind==='evm'?shortHex(session.address):null;
  const recorded=purchase===null?null:purchase.status==='confirmed'?{tone:'done',label:'Purchase confirmed'}:purchase.status==='reverted'?{tone:'failed',label:'Purchase did not complete'}:purchase.hash?{tone:'wait',label:'Purchase pending'}:purchase.status==='submitting'?{tone:'wait',label:'No transaction returned'}:{tone:'alert',label:'Purchase record not saved'};
  return <section className="card topup rise" aria-labelledby="topup-h">
    <div className="topup-head"><div><h2 id="topup-h" className="card-title">Add credits</h2><p className="card-sub">Buy credits directly, without a strategy vault.</p></div><span className="ticket-badges"><ChainBadge name="Base"/><AssetBadge symbol="USDC"/></span></div>
    <div className="topup-body">
      <div className="topup-rail">
        <dl className="topup-stats">
          <div><dt>USDC on Base · connected wallet</dt><dd>{formatAmount(account.walletBalance,6,2)}<span className="topup-unit">USDC</span></dd></div>
          <div><dt>Total bought for you</dt><dd>{formatAmount(account.paid,6,2)}<span className="topup-unit">USDC</span></dd></div>
        </dl>
        <p className="topup-eta">{behind&&Date.now()<=until?<><Spinner/>Posting your purchase to NEAR. Your credits update here on their own.</>:'Credits appear within seconds of the purchase confirming on Base, when the keeper posts it to NEAR.'}</p>
      </div>
      <div className="topup-main">
        {purchase&&recorded&&<div className={`topup-status ${recorded.tone}`}>
          <p className="topup-step">{recorded.label}</p>
          <p className="topup-status-msg">{purchase.status==='confirmed'?'Previous purchase confirmed. A fresh review is required for another purchase.':purchase.status==='reverted'?'The previous purchase did not complete. Review a fresh purchase to try again.':purchase.hash?'Purchase pending or uncertain. Check its receipt; do not submit another purchase.':purchase.status==='submitting'?'The wallet did not return a transaction. Check wallet activity and reject any request still waiting there. Compare Total bought for you with the contract’s paid total on Base. Only if no purchase was sent, start again.':'Purchase storage failed after broadcast. Check wallet activity before any manual recovery.'}</p>
          <p className="topup-status-amount">Previous request: {exact(BigInt(purchase.amount))}</p>
          {purchase.hash&&<div className="endpoint-url"><code>{purchase.hash}</code><CopyButton text={purchase.hash}/></div>}
          <div className="topup-actions"><button type="button" className="btn outline" disabled={busy} onClick={()=>void reconcile()}>Check purchase status</button>
            {pending&&!purchase.hash&&purchase.status==='submitting'&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>void setAside()}>No purchase was sent: start again</button>}</div>
        </div>}
        <form onSubmit={e=>void review(e)}><label className="field"><span className="field-k">Amount<span className="topup-min">Minimum {exact(account.minimum)}</span></span><span className="input-wrap"><input inputMode="decimal" value={input} disabled={busy||pending} onChange={e=>{setInput(e.target.value);setConfirm(null);}} placeholder="0.00"/><span className="unit"><AssetBadge symbol="USDC"/></span></span></label>
          {!reviewing&&<><p className="loss-note topup-notice">{PURCHASE_NOTICE}</p>
            <div className="topup-actions"><button className="btn primary" disabled={busy||pending||!input}>Review purchase</button>{!input&&!pending&&!busy&&<span className="topup-hint">Enter an amount to review</span>}</div></>}</form>
        <ErrorNote error={error}/>
        {reviewed!==null&&!pending&&<div className="topup-review" role="group" aria-labelledby="topup-review-h">
          <p id="topup-review-h" className="topup-step">Review purchase</p>
          <p className="topup-pay">{formatAmount(reviewed,6,6).slice(0,-4)}<span className="fine">{formatAmount(reviewed,6,6).slice(-4)}</span><span className="topup-unit">USDC</span></p>
          <p className="topup-pay-note">Pay {exact(reviewed)} for yourself. Approval, if needed, is followed by a separate purchase transaction.</p>
          <dl className="topup-summary">
            <div><dt>From</dt><dd>{wallet?<code>{wallet}</code>:'Connected wallet'}, on Base</dd></div>
            <div><dt>You get</dt><dd>{formatUsd(reviewed)} of credits on NEAR, at 1 USDC = $1</dd></div>
            <div><dt>Credits arrive</dt><dd>Within seconds of the purchase confirming on Base</dd></div>
          </dl>
          <p className="loss-note topup-notice">{PURCHASE_NOTICE}</p>
          <div className="topup-actions"><button className="btn primary" onClick={()=>void buy()} disabled={busy}>{busy?<Spinner/>:<span className="btn-dot" aria-hidden="true"/>}Confirm purchase</button><button className="btn ghost" disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></div>
        </div>}
      </div>
    </div>
  </section>;
}
