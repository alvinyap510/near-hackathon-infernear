import { DataError, readAmount } from './errors.ts';
import { tokenCost } from './money.ts';
import type { DashboardData, FreeCalls, Model, RunEvent, RunRequest, RunResult } from './types.ts';

/** UUIDv5(completion id, DNS namespace), the relay's headerless-id convention. */
export async function completionInferenceId(id: string): Promise<string> {
  const namespace=Uint8Array.from('6ba7b8109dad11d180b400c04fd430c8'.match(/../g)!,v=>parseInt(v,16));
  const name=new TextEncoder().encode(id),bytes=new Uint8Array(namespace.length+name.length);bytes.set(namespace);bytes.set(name,namespace.length);
  const value=new Uint8Array(await crypto.subtle.digest('SHA-1',bytes)).slice(0,16);value[6]=(value[6]&15)|80;value[8]=(value[8]&63)|128;
  const hex=[...value].map(v=>v.toString(16).padStart(2,'0')).join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function createChatData(relayUrl:string,fetcher:typeof fetch){
  const url=relayUrl.replace(/\/$/,'');
  const responseBody=async(response:Response)=>{const body=await response.json();if(!response.ok)throw new DataError(body.error?.code??`http_${response.status}`,body.error?.message??`Relay request failed (${response.status}).`);return body;};
  return{
    async freeCalls(key:string):Promise<FreeCalls>{
      const body=await responseBody(await fetcher(`${url}/v1/free-calls`,{headers:{authorization:`Bearer ${key}`}}));
      if(!body||![body.per_user,body.used,body.remaining].every(n=>Number.isSafeInteger(n)&&n>=0))throw new DataError('free_calls','The relay returned an invalid free-call count.');
      return{per_user:body.per_user,used:body.used,remaining:body.remaining};
    },
    async models():Promise<Model[]>{
      const body=await responseBody(await fetcher(`${url}/v1/models`));
      if(!Array.isArray(body.data))throw new DataError('models','The relay returned no model list.');
      return body.data.map((model:any)=>{
        if(typeof model.id!=='string'||!model.id)throw new DataError('models','Model id missing.');
        const price=(p:any)=>{if(p?.currency!=='USD'||p.scale!==9)throw new DataError('models','Unsupported model price units.');return typeof p.amount==='number'&&Number.isSafeInteger(p.amount)&&p.amount>=0?BigInt(p.amount):readAmount(p.amount,'models');};
        return{id:model.id,name:model.id,inPriceNano:price(model.inputCostPerToken),outPriceNano:price(model.outputCostPerToken)};
      });
    },
    async run(request:RunRequest,onEvent:(event:RunEvent)=>void):Promise<RunResult>{
      if(request.mode==='private')throw new DataError('private_unavailable','Private mode is available through the code quickstart; no simulated result is substituted.');
      if(!request.prompt.trim()||!Number.isSafeInteger(request.maxTokens)||request.maxTokens<1)throw new DataError('request','Enter a prompt and a positive output limit.');
      const body=JSON.stringify({model:request.model.id,messages:[{role:'user',content:request.prompt}],max_tokens:request.maxTokens});
      const reservation=tokenCost(new TextEncoder().encode(body).length+1024,request.maxTokens,request.model.inPriceNano,request.model.outPriceNano);
      const response=await fetcher(`${url}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${request.key}`},body});
      const headerId=response.headers.get('Inference-Id');
      let value:any;
      try{value=await responseBody(response);}catch(error){
        // A 2xx with an inference id can already be charged even if its JSON is unusable.
        if(!response.ok||!headerId)throw error;
        value={};
      }
      const completionId=typeof value?.id==='string'?value.id:'';
      if(!completionId&&!headerId)throw new DataError('completion','The relay returned no completion id. Check credits before retrying.');
      const content=value?.choices?.[0]?.message?.content;
      const text=typeof content==='string'?content:'',usage=value?.usage;
      const hasUsage=usage&&[usage.prompt_tokens,usage.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0);
      const inferenceId=headerId||await completionInferenceId(completionId);
      if(text)onEvent({kind:'text',delta:text});
      const billing=response.headers.get('X-InferNear-Billing')==='free'?'free':'credits';
      // Never advertise extra free calls from malformed headers; the quota read is authoritative.
      const remaining=Number(response.headers.get('X-InferNear-Free-Remaining'));
      return{billing,...(billing==='free'?{freeRemaining:Number.isSafeInteger(remaining)&&remaining>=0?remaining:0}:{}),mode:'standard',text,completionId,reservation,receipt:{inferenceId,chatId:completionId,model:request.model.id,
        promptTokens:hasUsage?usage.prompt_tokens:new TextEncoder().encode(body).length+1024,completionTokens:hasUsage?usage.completion_tokens:request.maxTokens,
        inPriceNano:request.model.inPriceNano,outPriceNano:request.model.outPriceNano,source:hasUsage?'signed_usage':'reservation'}};
    },
  };
}

/** Effect cleanup clears a previous wallet/key's count and ignores its unfinished read. */
export function observeFreeCalls(key:string,read:(key:string)=>Promise<FreeCalls>,show:(count:FreeCalls|null)=>void){
  let stopped=false;show(null);
  if(key)void read(key).then(count=>{if(!stopped)show(count);}).catch(()=>{if(!stopped)show(null);});
  return()=>{stopped=true;show(null);};
}

/** Free sponsorship never enters the connector; only credit results need debit polling. */
export function observeRunDebit(result:RunResult,source:Pick<DashboardData,'isRunMock'|'debitedAmount'>,show:(debit:bigint|null)=>void,fail:(error:unknown)=>void){
  if(result.billing==='free')return()=>{};
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{try{
    const value=source.isRunMock?result.simulatedDebit??null:await source.debitedAmount(result.receipt.inferenceId);
    if(stopped)return;show(value);if(value===null&&!source.isRunMock)timer=setTimeout(poll,3000);
  }catch(error){if(!stopped){fail(error);timer=setTimeout(poll,5000);}}};
  void poll();return()=>{stopped=true;clearTimeout(timer);};
}
