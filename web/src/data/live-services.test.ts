// Offline service fixtures; no paid inference, bridge funding or chain transaction is executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatData, completionInferenceId } from './chat.ts';
import { createBridgeData } from './bridge.ts';
import { createMockData } from './mock.ts';
import { config, type LiveConfig } from '../config.ts';
import { DataError } from './errors.ts';
import { PURCHASE_NOTICE } from './types.ts';
import { quickstartJs, quickstartPython, quickstartPrivateJs } from '../quickstart.ts';
const owner='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const model={id:'canonical/fixture',name:'Canonical fixture',inPriceNano:80n,outPriceNano:500n};
const json=(body:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const code=(value:string)=>(e:unknown)=>e instanceof DataError&&e.code===value;

test('live model list preserves canonical ids and integer nano-USD prices',async()=>{
 const chat=createChatData('https://relay.fixture',async input=>{assert.equal(String(input),'https://relay.fixture/v1/models');return json({data:[{id:model.id,inputCostPerToken:{amount:'80',currency:'USD',scale:9},outputCostPerToken:{amount:500,currency:'USD',scale:9}}]});});
 assert.deepEqual(await chat.models(),[{...model,name:model.id}]);
 const bad=createChatData('https://relay.fixture',async()=>json({data:[{id:'bad',inputCostPerToken:{amount:1,currency:'USD',scale:6},outputCostPerToken:{}}]}));await assert.rejects(bad.models(),code('models'));
});
test('standard chat sends plain OpenAI JSON and reports actual reply/id/usage without fabricated verification',async()=>{
 let sent:any;
 const chat=createChatData('https://relay.fixture/',async(input,init)=>{sent={url:String(input),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body))};return json({id:'chat-id',choices:[{message:{content:'Real fixture reply'}}],usage:{prompt_tokens:10,completion_tokens:2}},200,{'Inference-Id':'actual-inference-id'});});
 const events:unknown[]=[];const result=await chat.run({key:'inf_fixture',model,prompt:'hello 世界',maxTokens:16},e=>events.push(e));
 assert.equal(sent.headers.get('authorization'),'Bearer inf_fixture');assert.equal(sent.headers.get('x-encryption-version'),null);assert.equal(sent.url,'https://relay.fixture/v1/chat/completions');
 assert.deepEqual(sent.body,{model:model.id,messages:[{role:'user',content:'hello 世界'}],max_tokens:16});
 assert.equal(result.receipt.inferenceId,'actual-inference-id');assert.equal(result.receipt.promptTokens,10);assert.equal(result.receipt.completionTokens,2);assert.equal(result.text,'Real fixture reply');
 assert.equal(result.mode,'standard');assert.equal(result.attestation,undefined);assert.equal(result.reply,undefined);assert.equal(result.simulatedDebit,undefined);assert.deepEqual(events,[{kind:'text',delta:result.text}]);
});
test('headerless completion id uses the relay UUIDv5 convention; missing usage is explicitly reservation-priced',async()=>{
 assert.equal(await completionInferenceId('example.com'),'cfbff0d1-9375-5685-968c-48ce8b15ae17');
 const chat=createChatData('https://relay.fixture',async()=>json({id:'example.com',choices:[{message:{content:'done'}}]}));
 const result=await chat.run({key:'inf_fixture',model,prompt:'fixture',maxTokens:8},()=>{});assert.equal(result.receipt.inferenceId,'cfbff0d1-9375-5685-968c-48ce8b15ae17');assert.equal(result.receipt.source,'reservation');assert(result.receipt.promptTokens>=1024);
});
test('402 is propagated as insufficient credit, and live private mode never substitutes a simulation',async()=>{
 let requests=0;const chat=createChatData('https://relay.fixture',async()=>{requests++;return json({error:{code:'insufficient_credit',message:'Insufficient available credits'}},402);});
 const events:unknown[]=[];await assert.rejects(chat.run({key:'inf_fixture',model,prompt:'hi',maxTokens:1},e=>events.push(e)),code('insufficient_credit'));assert.deepEqual(events,[]);
 await assert.rejects(chat.run({key:'inf_fixture',model,prompt:'hi',maxTokens:1,mode:'private'},()=>{}),code('private_unavailable'));assert.equal(requests,1);
});

test('1Click catalogue selects only listed USDC EVM origins and binds a real dry quote to the user Base address',async()=>{
 const calls:any[]=[],tokens=[{assetId:'eth-usdc-from-api',symbol:'USDC',blockchain:'eth',decimals:6,contractAddress:owner},{assetId:'arb-dai',symbol:'DAI',blockchain:'arb',decimals:6,contractAddress:owner},{assetId:'op-usdc-from-api',symbol:'USDC',blockchain:'op',decimals:6,contractAddress:owner},{assetId:'base-usdc-from-api',symbol:'USDC',blockchain:'base',decimals:6,contractAddress:owner},{assetId:'sol-usdc',symbol:'USDC',blockchain:'sol',decimals:6,contractAddress:owner}];
 const bridge=createBridgeData({oneClickUrl:'https://oneclick.fixture',baseUsdcAssetId:'base-usdc-from-api',slippageBps:100} as LiveConfig,async(input,init)=>{calls.push({url:String(input),init});if(String(input).endsWith('/tokens'))return json(tokens);const body=JSON.parse(String(init?.body));return json({quoteRequest:body,quote:{amountIn:body.amount,amountOut:'4900000',minAmountOut:'4800000',timeEstimate:30}});},()=>new Date('2026-11-12T12:00:00Z'));
 assert.deepEqual(await bridge.bridgeChains(),[{id:'1',name:'Ethereum'},{id:'10',name:'Optimism'}]);const quote=await bridge.bridgeQuote('1',5_000_000n,owner);
 const request=JSON.parse(calls.at(-1).init.body);assert.equal(request.originAsset,'eth-usdc-from-api');assert.equal(request.destinationAsset,'base-usdc-from-api');assert.equal(request.recipient,owner);assert.equal(request.refundTo,owner);assert.equal(request.dry,true);assert.equal(quote.originToken,owner);assert.equal(quote.isMock,false);assert.equal(quote.dry,true);assert(quote.sendDisabledReason);assert.equal('depositAddress'in quote,false);
 await assert.rejects(bridge.bridgeQuote('42161',1_000_000n,owner),code('bridge_route'));
});
test('dry bridge rejects mismatched recipient, input amount and expired quotes before exposing a funding path',async()=>{
 for(const failure of ['recipient','amount','expiry']){
  const bridge=createBridgeData({oneClickUrl:'https://oneclick.fixture',baseUsdcAssetId:'base',slippageBps:100} as LiveConfig,async(input,init)=>{
   if(String(input).endsWith('/tokens'))return json([{assetId:'origin',symbol:'USDC',blockchain:'eth',decimals:6,contractAddress:owner},{assetId:'base',symbol:'USDC',blockchain:'base',decimals:6,contractAddress:owner}]);
   const body=JSON.parse(String(init?.body));return json({quoteRequest:{...body,...(failure==='recipient'?{recipient:'0x'+'b'.repeat(40)}:{})},quote:{amountIn:failure==='amount'?'1':body.amount,amountOut:'900000',minAmountOut:'800000',timeEstimate:5,...(failure==='expiry'?{deadline:'2020-01-01T00:00:00Z'}:{})}});
  },()=>new Date('2026-11-12T12:00:00Z'));
  await assert.rejects(bridge.bridgeQuote('1',1_000_000n,owner),code('quote'));
 }
});
test('mock credit purchases change credits and wallet USDC, never vault principal; notice and standard quickstart stay explicit',async()=>{
 const saved=config.topUpAddress;try{config.topUpAddress=owner;const data=createMockData(),before=await data.overview(owner);await data.topUp(owner,1_000_000n);const after=await data.overview(owner);assert.equal(after.credits.credited,before.credits.credited+1_000_000n);assert.equal(after.vaults[0].position.principal,before.vaults[0].position.principal);assert.equal(after.vaults[0].position.walletBalance,before.vaults[0].position.walletBalance-1_000_000n);assert.equal((await data.topUpAccount(owner))?.paid,1_000_000n);}finally{config.topUpAddress=saved;}
 assert.equal(PURCHASE_NOTICE,'This is a purchase, not a deposit. The USDC goes to InferNear and cannot be redeemed.');const params={baseUrl:'https://relay.fixture/v1',model:model.id,maxTokens:64};assert(quickstartJs(params).includes("import OpenAI from 'openai'"));assert(quickstartPython(params).includes('from openai import OpenAI'));assert(quickstartPrivateJs(params).includes('verifyResponse'));
});
