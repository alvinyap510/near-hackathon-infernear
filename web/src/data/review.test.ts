// Review regressions: synthetic wallets and RPC only, never a real transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData,encodeFunctionResult } from 'viem';
import { createLiveData } from './live.ts';
import { createPurchaseJournal } from './purchases.ts';
import { createWallets } from './wallets.ts';
import { topUpAbi,usdcAbi,vaultAbi } from './abi.ts';
import { DataError } from './errors.ts';
import { initialSessionState,reduceSession } from './session-state.ts';
import type { LiveConfig } from '../config.ts';
import type { Session } from './types.ts';
const owner=`0x${'a'.repeat(40)}` as const,topup=`0x${'9'.repeat(40)}` as const,usdc=`0x${'8'.repeat(40)}` as const,vault=`0x${'7'.repeat(40)}` as const;
const settings={topUpAddress:topup,vaultChainId:8453,vaultAddress:vault,rateVaultAddress:vault,pendleVaultAddress:vault,baseRpcUrl:'https://base.fixture',nearRpcUrl:'https://near.fixture',relayUrl:'https://relay.fixture',connectorAccount:'connector.near',rheaVaultAccount:'vault.near',nearUsdcAccount:'usdc.near',oneClickUrl:'https://oneclick.fixture',baseUsdcAssetId:'base-usdc',slippageBps:100} as LiveConfig;
const session:Session={kind:'evm',address:owner,user:`eip155:8453:${owner}`};
const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
const code=(c:string)=>(e:unknown)=>e instanceof DataError&&e.code===c;
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};};
function fixture(){
 const calls:{to:string;name:string;args:readonly unknown[]|undefined}[]=[],reads:string[]=[];
 const state={account:owner as string,receiptMissing:false,payFailure:'' as ''|'reject'|'rpc',wait:undefined as undefined|((hash:`0x${string}`)=>Promise<{status:'success'|'reverted'}>),coverage:'1000000000000000000',beforeRequest:undefined as undefined|((method:string)=>Promise<void>),beforeFetch:undefined as undefined|((url:string,body:any)=>Promise<void>)};
 const events=new Map<string,(value?:unknown)=>void>();
 const provider={on(event:string,listener:(value?:unknown)=>void){events.set(event,listener);},async request({method,params}:any){
  await state.beforeRequest?.(method);
  if(method==='eth_accounts'||method==='eth_requestAccounts')return[state.account];if(method==='eth_chainId')return'0x2105';
  if(method==='personal_sign')return`0x${'ab'.repeat(65)}`;
  if(method==='eth_sendTransaction'){
   const tx=params[0],abi=tx.to===topup?topUpAbi:tx.to===vault?vaultAbi:usdcAbi,decoded=decodeFunctionData({abi,data:tx.data});
   calls.push({to:tx.to,name:decoded.functionName,args:decoded.args});
   if(decoded.functionName==='pay'&&state.payFailure)throw state.payFailure==='reject'?{code:4001}:Error('RPC lost wallet response');
   return`0x${calls.length.toString(16).padStart(64,'0')}`;
  }
  throw Error(method);
 }};
 const memory=new Map<string,string>(),storage={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}};
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input),body=init?.body?JSON.parse(String(init.body)):{};reads.push(url);await state.beforeFetch?.(url,body);
  if(url.startsWith(settings.baseRpcUrl)){let result:unknown='0x64';
   if(body.method==='eth_getTransactionReceipt')result=state.receiptMissing?null:{transactionHash:body.params[0],transactionIndex:'0x0',blockHash:`0x${'b'.repeat(64)}`,blockNumber:'0x64',from:owner,to:topup,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',effectiveGasPrice:'0x1',logs:[],logsBloom:`0x${'0'.repeat(512)}`,status:'0x1',type:'0x2',contractAddress:null};
   if(body.method==='eth_call'){
    const tx=body.params[0],abi=tx.to===topup?topUpAbi:tx.to===vault?vaultAbi:usdcAbi,decoded=decodeFunctionData({abi,data:tx.data});
    const value=decoded.functionName==='usdc'||decoded.functionName==='asset'?usdc:decoded.functionName==='minimum'?1_000_000n:decoded.functionName==='allowance'?0n:100_000_000n;
    result=encodeFunctionResult({abi,functionName:decoded.functionName,result:value} as any);
   }return json({jsonrpc:'2.0',id:body.id,result});
  }
  if(url===settings.nearRpcUrl){const value=body.params.method_name==='coverage'?state.coverage:1;return json({result:{result:[...new TextEncoder().encode(JSON.stringify(value))]}});}
  if(url.includes('/v0/quote'))return json({quoteRequest:body,quote:{amountIn:body.amount,amountOut:'4900000',minAmountOut:'4800000',depositAddress:owner,timeEstimate:20}});
  if(url.endsWith('/rhea/withdraw')||url.endsWith('/intents/execute'))return json({tx_hash:'fixture-relay-hash'});
  throw Error(url);
 };
 const wallets=createWallets(settings,{ethereum:provider as any}),make=()=>createLiveData(settings,{wallets,fetch:fetcher,purchaseStorage:storage,waitForReceipt:hash=>state.wait?state.wait(hash):Promise.resolve({status:'success'})});
 return{state,calls,reads,provider,wallets,events,fetcher,make,data:make()};
}

test('CR1-1/Flex2-1: a lost receipt preserves the hash across remounts and retries never broadcast another pay',async()=>{
 const f=fixture();f.state.receiptMissing=true;f.state.wait=async()=>{if(f.calls.at(-1)?.name==='pay')throw Error('receipt RPC offline');return{status:'success'};};
 await assert.rejects(f.data.topUp(session,1_000_000n),code('purchase_pending'));
 const pending=await f.data.topUpPurchase(session);assert.equal(pending?.status,'pending');assert.equal(pending?.hash,`0x${'2'.padStart(64,'0')}`);
 const reloaded=f.make();await assert.rejects(reloaded.topUp(session,1_000_000n),code('purchase_pending'));await assert.rejects(reloaded.reviewTopUp(session),code('purchase_pending'));assert.equal(f.calls.filter(c=>c.name==='pay').length,1);
 f.state.receiptMissing=false;assert.equal((await reloaded.topUpPurchase(session))?.status,'confirmed');
 await assert.rejects(reloaded.reviewTopUp(session),code('purchase_pending'),'a stale review cannot silently acknowledge an unseen receipt');
 assert.equal((await reloaded.topUp(session,1_000_000n)).txHash,pending!.hash);assert.equal(f.calls.filter(c=>c.name==='pay').length,1);
 await reloaded.reviewTopUp(session,pending!.hash);f.state.wait=async()=>({status:'success'});await reloaded.topUp(session,1_000_000n);assert.equal(f.calls.filter(c=>c.name==='pay').length,2,'only an explicit new review permits a new purchase');
});
test('CR1 test gap: rejection and a reverted pay after successful approval require a fresh review',async()=>{
 const rejected=fixture();rejected.state.payFailure='reject';await assert.rejects(rejected.data.topUp(session,1_000_000n),code('wallet_rejected'));assert.equal((await rejected.data.topUpPurchase(session))?.status,'reverted');
 assert.deepEqual(rejected.calls.map(c=>c.name),['approve','pay']);await rejected.data.reviewTopUp(session);
 const reverted=fixture();reverted.state.wait=async()=>({status:reverted.calls.at(-1)?.name==='pay'?'reverted':'success'});await assert.rejects(reverted.data.topUp(session,1_000_000n),code('transaction_reverted'));assert.equal((await reverted.data.topUpPurchase(session))?.status,'reverted');
 await assert.rejects(reverted.data.topUp(session,1_000_000n),code('transaction_reverted'));assert.equal(reverted.calls.filter(c=>c.name==='pay').length,1);
});
test('CR1-1: a wallet submission error with no hash is uncertain, never permission to retry',async()=>{
 const f=fixture();f.state.payFailure='rpc';await assert.rejects(f.data.topUp(session,1_000_000n));assert.equal((await f.data.topUpPurchase(session))?.status,'submitting');
 await assert.rejects(f.data.topUp(session,1_000_000n),code('purchase_pending'));assert.equal(f.calls.filter(c=>c.name==='pay').length,1);
});
test('a hashless record can be set aside only by the explicit action; a record with a hash never can',async()=>{
 const f=fixture();f.state.payFailure='rpc';await assert.rejects(f.data.topUp(session,1_000_000n));assert.equal((await f.data.topUpPurchase(session))?.status,'submitting');
 await assert.rejects(f.data.reviewTopUp(session),code('purchase_pending'),'a review alone never clears it');
 await f.data.setAsideUnsentTopUp(session);assert.equal(await f.data.topUpPurchase(session),null);
 f.state.payFailure='';await f.data.reviewTopUp(session);await f.data.topUp(session,1_000_000n);assert.equal(f.calls.filter(c=>c.name==='pay').length,2);
 const g=fixture();g.state.receiptMissing=true;g.state.wait=async()=>{if(g.calls.at(-1)?.name==='pay')throw Error('receipt RPC offline');return{status:'success'};};
 await assert.rejects(g.data.topUp(session,1_000_000n),code('purchase_pending'));assert((await g.data.topUpPurchase(session))?.hash);
 await assert.rejects(g.data.setAsideUnsentTopUp(session),code('purchase_pending'));assert.equal((await g.data.topUpPurchase(session))?.status,'pending');assert.equal(g.calls.filter(c=>c.name==='pay').length,1);
});
test('CR1-2/Flex2-5: disconnect, account change, or disconnect/reconnect during approval prevents pay',async()=>{
 for(const action of ['disconnect','account','reconnect'] as const){
  const f=fixture(),approved=gate(),resume=gate();await f.data.connectWallet('evm:injected');
  f.state.wait=async()=>{approved.release();await resume.promise;return{status:'success'};};
  const purchase=f.data.topUp(session,1_000_000n),rejected=assert.rejects(purchase,e=>e instanceof DataError&&['wallet_session_changed','wallet_account'].includes(e.code));await approved.promise;
  if(action==='account'){f.state.account=`0x${'c'.repeat(40)}`;f.events.get('accountsChanged')?.([f.state.account]);}
  else{await f.data.disconnect();assert.equal(f.wallets.evmProvider(),undefined);if(action==='reconnect')await f.data.connectWallet('evm:injected');}
  resume.release();await rejected;assert.deepEqual(f.calls.map(c=>c.name),['approve']);
 }
});
test('CR1-2: a provider change for the same account during approval invalidates the old flow',async()=>{
 const f=fixture(),target=new EventTarget(),approved=gate(),resume=gate();
 const second={request:f.provider.request.bind(f.provider)};
 target.addEventListener('eip6963:requestProvider',()=>{for(const [rdns,provider] of [['first',f.provider],['second',second]] as const)target.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{rdns,name:rdns},provider}}));});
 const wallets=createWallets(settings,{target,ethereum:f.provider as any});
 const data=createLiveData(settings,{wallets,fetch:f.fetcher,waitForReceipt:async()=>{approved.release();await resume.promise;return{status:'success'};}});
 await data.connectWallet('evm:first');
 const pending=data.topUp(session,1_000_000n),rejected=assert.rejects(pending,code('wallet_session_changed'));await approved.promise;
 await data.connectWallet('evm:second');resume.release();await rejected;assert.deepEqual(f.calls.map(c=>c.name),['approve']);
});
test('CR1-2: vault approval cannot continue to deposit after disconnect',async()=>{
 const f=fixture(),approved=gate(),resume=gate();f.state.wait=async()=>{approved.release();await resume.promise;return{status:'success'};};
 const pending=f.data.deposit(session,1_000_000n),rejected=assert.rejects(pending,code('wallet_session_changed'));await approved.promise;await f.data.disconnect();resume.release();await rejected;assert.deepEqual(f.calls.map(c=>c.name),['approve']);
});
test('CR1-2: Rhea funding is cancelled if the session changes while a funded quote is in flight',async()=>{
 const f=fixture(),quoted=gate(),resume=gate();f.state.beforeFetch=async url=>{if(url.endsWith('/v0/quote')){quoted.release();await resume.promise;}};
 const pending=f.data.rheaDeposit(session,5_000_000n),rejected=assert.rejects(pending,code('wallet_session_changed'));await quoted.promise;await f.data.disconnect();resume.release();await rejected;assert.equal(f.calls.length,0);
});
test('Flex1-1: EVM Rhea pause and deficit refuse funding before any wallet write or quote',async()=>{
 const f=fixture(),paused=createLiveData({...settings,rheaStatusNote:'Redeploying'},{wallets:f.wallets,fetch:async()=>{throw Error('pause must precede reads');}});
 await assert.rejects(paused.rheaDeposit(session,5_000_000n),code('paused'));f.state.coverage='900000000000000000';await assert.rejects(f.data.rheaDeposit(session,5_000_000n),code('deficit'));assert.equal(f.calls.length,0);assert(!f.reads.some(u=>u.includes('/v0/quote')));
});
test('Flex1-2/Flex2-5: session revision clears issued keys, invalidates proof/review screens, and rejects stale async issuance',()=>{
 const key={key:'inf_test',keyEpoch:0,expiresAt:'2099-01-01'};
 let state=reduceSession(initialSessionState,{type:'accept',session});const alice=state.revision;
 state=reduceSession(state,{type:'issued',revision:alice,key});assert.equal(state.issued,key);
 state=reduceSession(state,{type:'accept',session:null});assert.equal(state.issued,null);assert.notEqual(state.revision,alice);
 state=reduceSession(state,{type:'accept',session:{...session}});assert.equal(state.issued,null);assert.notEqual(state.revision,alice,'same account reconnect must still remount cached signing screens');
 assert.equal(reduceSession(state,{type:'issued',revision:alice,key}).issued,null);
});


test('CR1-2: disconnect while redeem checks the account prevents the wallet write',async()=>{
 const f=fixture(),reading=gate(),resume=gate();f.state.beforeRequest=async method=>{if(method==='eth_accounts'){reading.release();await resume.promise;}};
 const pending=f.data.redeem(session,1n),rejected=assert.rejects(pending,code('wallet_session_changed'));await reading.promise;await f.data.disconnect();resume.release();await rejected;assert.equal(f.calls.length,0);
});
test('CR1-2: disconnect while a Rhea signature is pending prevents withdrawal/intent submission',async()=>{
 for(const method of ['rheaWithdraw','rheaExit'] as const){
  const f=fixture(),signing=gate(),resume=gate();f.state.beforeRequest=async name=>{if(name==='personal_sign'){signing.release();await resume.promise;}};
  const pending=f.data[method](session,1_000_000n),rejected=assert.rejects(pending,code('wallet_session_changed'));await signing.promise;await f.data.disconnect();resume.release();await rejected;
  assert(!f.reads.some(u=>u.endsWith('/rhea/withdraw')||u.endsWith('/intents/execute')));assert.equal(f.calls.length,0);
 }
});


test('CR1-1: disconnect during purchase confirmation does not discard its broadcast hash',async()=>{
 const f=fixture(),broadcast=gate(),resume=gate();await f.data.connectWallet('evm:injected');
 f.state.wait=async()=>{if(f.calls.at(-1)?.name==='pay'){broadcast.release();await resume.promise;throw Error('receipt disconnected');}return{status:'success'};};
 const pending=f.data.topUp(session,1_000_000n),rejected=assert.rejects(pending,code('purchase_pending'));await broadcast.promise;await f.data.disconnect();resume.release();await rejected;
 const state=await f.data.topUpPurchase(session);assert(state?.hash);assert.equal(state.status,'confirmed');
 await f.data.connectWallet('evm:injected');assert.equal((await f.data.topUp(session,1_000_000n)).txHash,state.hash);assert.equal(f.calls.filter(c=>c.name==='pay').length,1);
});
test('CR1-1: a storage failure after broadcast retains the hash in memory and blocks a new submission',()=>{
 const hash=`0x${'d'.repeat(64)}` as const;let value:string|null=null,fail=false;
 const journal=createPurchaseJournal(8453,topup,{getItem:()=>value,setItem:(_k,v)=>{if(fail)throw Error('quota');value=v;},removeItem:()=>{value=null;}});
 journal.write(owner,{amount:'1000000',status:'submitting'});fail=true;
 assert.throws(()=>journal.write(owner,{amount:'1000000',hash,status:'pending'}),code('purchase_storage'));assert.equal(journal.read(owner)?.hash,hash);assert.throws(()=>journal.review(owner),code('purchase_pending'));
});


test('CR1-2: a delayed anonymous restoration cannot replace a newly selected session',async()=>{
 const f=fixture(),loading=gate(),resume=gate();
 const wallets=createWallets(settings,{ethereum:f.provider as any,selector:async()=>{loading.release();await resume.promise;return{store:{getState:()=>({selectedWalletId:null,accounts:[]})}} as any;}});
 const restoring=wallets.restoreSession(),rejected=assert.rejects(restoring,code('wallet_session_changed'));await loading.promise;
 const selected=await wallets.connectWallet('evm:injected');resume.release();await rejected;assert.equal(selected.user,session.user);assert.equal(wallets.evmProvider(),f.provider);
});


test('CR1-2: cancellation inside viem preparation is checked again at the wallet RPC boundary',async()=>{
 const f=fixture();let chainReads=0;
 f.state.beforeRequest=async method=>{if(method==='eth_chainId'&&++chainReads===4)await f.data.disconnect();};
 await assert.rejects(f.data.topUp(session,1_000_000n),code('wallet_session_changed'));
 assert.equal(chainReads,4);assert.deepEqual(f.calls.map(c=>c.name),['approve']);assert.equal((await f.data.topUpPurchase(session))?.status,'reverted');
});
