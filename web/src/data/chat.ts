import { DataError, readAmount } from './errors.ts';
import { tokenCost } from './money.ts';
import type { Model, RunEvent, RunRequest, RunResult } from './types.ts';

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
      const value=await responseBody(response);
      if(typeof value.id!=='string'||typeof value.choices?.[0]?.message?.content!=='string')throw new DataError('completion','The relay returned no text completion.');
      const text=value.choices[0].message.content,usage=value.usage;
      const hasUsage=usage&&[usage.prompt_tokens,usage.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0);
      const inferenceId=response.headers.get('Inference-Id')||await completionInferenceId(value.id);
      onEvent({kind:'text',delta:text});
      return{mode:'standard',text,completionId:value.id,reservation,receipt:{inferenceId,chatId:value.id,model:request.model.id,
        promptTokens:hasUsage?usage.prompt_tokens:new TextEncoder().encode(body).length+1024,completionTokens:hasUsage?usage.completion_tokens:request.maxTokens,
        inPriceNano:request.model.inPriceNano,outPriceNano:request.model.outPriceNano,source:hasUsage?'signed_usage':'reservation'}};
    },
  };
}
