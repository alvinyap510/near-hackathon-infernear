// W-029: offline relay/wallet fixtures only; no inference or chain writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatData, observeFreeCalls, observeRunDebit } from './chat.ts';
import { createLiveData } from './live.ts';
import { createMockData } from './mock.ts';
import { DataError } from './errors.ts';
import { initialSessionState, reduceSession } from './session-state.ts';
import type { FreeCalls, RunResult } from './types.ts';
import type { LiveConfig } from '../config.ts';
const model={id:'fixture/model',name:'Fixture model',inPriceNano:80n,outPriceNano:500n};
const request={key:'inf_fixture',model,prompt:'hello',maxTokens:4096};
const reply={id:'chatcmpl-fixture',choices:[{message:{content:'ok'}}],usage:{prompt_tokens:3,completion_tokens:1}};
const json=(value:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers});
const code=(name:string)=>(error:unknown)=>error instanceof DataError&&error.code===name;
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const settings={relayUrl:'https://relay.fixture/',baseRpcUrl:'https://base.fixture',oneClickUrl:'https://oneclick.fixture',nearRpcUrl:'https://near.fixture',vaultChainId:8453} as LiveConfig;

test('freeCalls sends a bearer-authenticated GET and parses relay counts including feature-off zeros',async()=>{
 for(const count of [{per_user:5,used:2,remaining:3},{per_user:0,used:0,remaining:0}]){
  const data=createLiveData(settings,{fetch:async(url,init)=>{
   assert.equal(String(url),'https://relay.fixture/v1/free-calls');assert.equal(init?.method??'GET','GET');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer inf_fixture');assert.equal(init?.body,undefined);return json(count);
  }});
  assert.deepEqual(await data.freeCalls('inf_fixture'),count);
 }
});
test('freeCalls preserves relay errors and guards network and JSON failures like other relay reads',async()=>{
 const denied=createLiveData(settings,{fetch:async()=>json({error:{code:'invalid_api_key',message:'Invalid API key'}},401)});
 await assert.rejects(denied.freeCalls('inf_bad'),code('invalid_api_key'));
 for(const fetcher of [async()=>{throw Error('offline');},async()=>new Response('not JSON')])await assert.rejects(createLiveData(settings,{fetch:fetcher}).freeCalls('inf_fixture'),code('rpc'));
});
test('freeCalls rejects malformed counts instead of displaying an invented allowance',async()=>{
 for(const count of [null,{}, {per_user:5,used:0,remaining:'5'},{per_user:5,used:-1,remaining:6},{per_user:5,used:0,remaining:1.5}]){
  await assert.rejects(createChatData(settings.relayUrl,async()=>json(count)).freeCalls('inf_fixture'),code('free_calls'));
 }
});
test('chat parses free and credits billing headers; an older or unrecognized header defaults to credits',async()=>{
 for(const billing of ['free','credits',undefined,'unexpected']){
  const headers:Record<string,string>={'Inference-Id':'inference-fixture'};if(billing)headers['X-InferNear-Billing']=billing;
  headers['X-InferNear-Free-Remaining']='4';
  const chat=createChatData(settings.relayUrl,async(_url,init)=>{assert.equal(JSON.parse(String(init?.body)).max_tokens,4096);return json(reply,200,headers);});
  const result=await chat.run(request,()=>{});
  assert.equal(result.billing,billing==='free'?'free':'credits');assert.equal(result.freeRemaining,billing==='free'?4:undefined);
  assert.equal(result.receipt.inferenceId,'inference-fixture');assert.equal(result.completionId,reply.id);assert.equal(result.receipt.promptTokens,3);assert.equal(result.text,'ok');
 }
});
test('a free completion preserves its ids and absent usage, without advertising invalid remaining-header values',async()=>{
 for(const remaining of ['bad','-1','1.5']){
  const chat=createChatData(settings.relayUrl,async()=>json({id:'no-usage',choices:[{message:{content:null}}]},200,{'X-InferNear-Billing':'free','X-InferNear-Free-Remaining':remaining}));
  const result=await chat.run(request,()=>{});assert.equal(result.billing,'free');assert.equal(result.freeRemaining,0);assert.equal(result.receipt.source,'reservation');assert.equal(result.completionId,'no-usage');
 }
});
async function runResult(billing:'free'|'credits'):Promise<RunResult>{return createChatData(settings.relayUrl,async()=>json(reply,200,{'X-InferNear-Billing':billing,'X-InferNear-Free-Remaining':'4'})).run(request,()=>{});}
test('a free result never reads debitedAmount or starts a pending/estimated debit',async()=>{
 const result=await runResult('free');let reads=0,shown=0;
 const stop=observeRunDebit(result,{isRunMock:false,async debitedAmount(){reads++;return null;}},()=>{shown++;},()=>assert.fail('no debit error expected'));
 await flush();stop();assert.equal(reads,0);assert.equal(shown,0);
});
test('a credits result still polls the connector until its debit confirms and cleanup stops it',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const result=await runResult('credits'),seen:(bigint|null)[]=[];let reads=0;
 const stop=observeRunDebit(result,{isRunMock:false,async debitedAmount(id){assert.equal(id,result.receipt.inferenceId);return ++reads===1?null:2n;}},value=>seen.push(value),()=>assert.fail('no debit error expected'));
 await flush();assert.deepEqual(seen,[null]);t.mock.timers.tick(3000);await flush();assert.deepEqual(seen,[null,2n]);stop();t.mock.timers.tick(10_000);await flush();assert.equal(reads,2);
});
test('a failed quota read hides the count and does not prevent an otherwise successful run',async()=>{
 const chat=createChatData(settings.relayUrl,async url=>String(url).endsWith('/free-calls')?json({error:{code:'unavailable',message:'Try later'}},503):json(reply));
 let count:FreeCalls|null={per_user:5,used:0,remaining:5};const stop=observeFreeCalls(request.key,chat.freeCalls,value=>{count=value;});await flush();assert.equal(count,null);
 assert.equal((await chat.run(request,()=>{})).billing,'credits');stop();
});
test('changing a key or session clears quota immediately and ignores the previous wallet read',async()=>{
 let resolve!:(count:FreeCalls)=>void;const delayed=new Promise<FreeCalls>(done=>{resolve=done;});let shown:FreeCalls|null=null;
 const stop=observeFreeCalls('inf_alice',async()=>({per_user:5,used:1,remaining:4}),value=>{shown=value;});await flush();assert.equal((shown as FreeCalls|null)?.remaining,4);
 stop();assert.equal(shown,null);const stopLate=observeFreeCalls('inf_alice',()=>delayed,value=>{shown=value;});
 const before=reduceSession(initialSessionState,{type:'accept',session:{kind:'near',accountId:'alice.near',user:'near:mainnet:alice.near'}});
 const after=reduceSession(before,{type:'accept',session:null});assert.notEqual(after.revision,before.revision,'TryApi is remounted by this revision, running observer cleanup');
 stopLate();assert.equal(shown,null);const stopNew=observeFreeCalls('inf_bob',async()=>({per_user:5,used:0,remaining:5}),value=>{shown=value;});
 resolve({per_user:5,used:5,remaining:0});await flush();assert.equal((shown as FreeCalls|null)?.remaining,5);stopNew();assert.equal(shown,null);
});
test('mock wallets get five free runs before credits or 402; keys share their wallet quota and no free result reaches the ledger',async()=>{
 const data=createMockData(),owner='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
 const key=await data.createKey(await data.walletProof(owner)),before=await data.overview(owner);
 assert.deepEqual(await data.freeCalls(key.key),{per_user:5,used:0,remaining:5});
 const expensive={...model,inPriceNano:10n**15n,outPriceNano:10n**15n};
 const runs=Array.from({length:5},()=>data.run({...request,key:key.key,model:expensive},()=>{}));
 assert.deepEqual(await data.freeCalls(key.key),{per_user:5,used:5,remaining:0});
 await assert.rejects(data.run({...request,key:key.key,model:expensive},()=>{}),code('credits'));
 const results=await Promise.all(runs),after=await data.overview(owner);assert.equal(after.credits.spent,before.credits.spent);
 for(const result of results){assert.equal(result.billing,'free');assert.equal(result.simulatedDebit,undefined);assert.equal(await data.debitedAmount(result.receipt.inferenceId),null);}
 const rotated=await data.createKey(await data.walletProof(owner));assert.equal((await data.freeCalls(rotated.key)).remaining,0);
 const near={kind:'near',accountId:'bob.near',user:'near:mainnet:bob.near'} as const,other=await data.createKey(await data.walletProof(near));assert.equal((await data.freeCalls(other.key)).remaining,5);
 const paid=await data.run({...request,key:key.key},()=>{});assert.equal(paid.billing,'credits');assert.equal(paid.freeRemaining,undefined);assert.equal(await data.debitedAmount(paid.receipt.inferenceId),paid.simulatedDebit);assert((await data.overview(owner)).credits.spent>before.credits.spent);
});
