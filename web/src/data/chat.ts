import { DataError, readAmount } from './errors.ts';
import { tokenCost } from './money.ts';
import type { Attestation, DashboardData, FreeCalls, Model, RunEvent, RunRequest, RunResult } from './types.ts';

// NEAR's image-provenance policy for the gateway, as in the private quickstart: "verified" must mean NEAR's own
// gateway images, not just genuine TEE hardware. The SDK's model image check is left out because it currently
// rejects NEAR's own model deploys; the model's TEE hardware attestation is still checked.
const build = (repository: string, workflow = '.github/workflows/build.yml') => ({ repository, workflow });
const GATEWAY_IMAGES = { 'nearaidev/cloud-api': build('nearai/cloud-api'), 'nearaidev/cvm-ingress': build('nearai/cvm-ingress', '.github/workflows/build-push.yml') };

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
      if(!request.prompt.trim()||!Number.isSafeInteger(request.maxTokens)||request.maxTokens<1)throw new DataError('request','Enter a prompt and a positive output limit.');
      if(request.mode==='private'){
        // Private mode, in this tab: NEAR AI's SDK verifies the gateway and the model's TEE, encrypts the prompt to the
        // model's quote-bound key, and checks the model's signature over the exact request and reply bytes. The SDK
        // is loaded only now. A new client per run means a fresh nonce and a fresh verification, never a cached one.
        const {InferenceClient,verifyDeploymentImageProvenance}=await import('@nearai/inference-sdk');
        const client=new InferenceClient({baseUrl:`${url}/v1`,apiKey:request.key,e2ee:true,
          gatewayVerification:{includeSpkiFingerprint:false,verifiers:{deployment:({appCompose})=>verifyDeploymentImageProvenance({appCompose,imagePolicies:GATEWAY_IMAGES})}}});
        const verified=await client.verify(request.model.id);
        type Evidence=(typeof verified.models)[number];
        const shown=(evidence:Evidence):Attestation=>({model:request.model.id,nonce:evidence.report.nonce,tcbStatus:evidence.tcbStatus,gpuEvidence:evidence.gpuEvidence,
          deploymentProvenance:verified.gateway.deploymentProvenance==='verified'?'verified':'not_checked',modelSigningKey:evidence.signingPublicKey??'',verifiedAt:verified.verifiedAt});
        const evidence=verified.models[0];
        if(!evidence?.signingPublicKey)throw new DataError('attestation','This model returned no TEE key to encrypt to, so nothing was sent.');
        onEvent({kind:'attested',attestation:shown(evidence)});
        const messages=[{role:'user' as const,content:request.prompt}];
        const plain=new TextEncoder().encode(JSON.stringify({model:request.model.id,messages,max_tokens:request.maxTokens})).length+1024;
        const reservation=tokenCost(plain,request.maxTokens,request.model.inPriceNano,request.model.outPriceNano);
        const {data:completion,response}=await client.chat.completions.create({model:request.model.id,messages,max_tokens:request.maxTokens}).withResponse();
        // Nothing is shown as a reply unless the signature over these exact bytes verifies.
        let reply;
        try{reply=await client.verifyResponse(completion.id);}
        catch{throw new DataError('unverified','A reply came back but its signature did not verify, so it is not shown. The call may still be charged.');}
        const used=reply.signatureKind==='provider_tee'&&reply.attestation.signingPublicKey?reply.attestation:evidence;
        const content=completion.choices?.[0]?.message?.content,text=typeof content==='string'?content:'',usage=completion.usage;
        const hasUsage=!!usage&&[usage.prompt_tokens,usage.completion_tokens].every(n=>Number.isSafeInteger(n)&&n>=0);
        if(text)onEvent({kind:'text',delta:text});
        const billing=response.headers.get('X-InferNear-Billing')==='free'?'free':'credits';
        const remaining=Number(response.headers.get('X-InferNear-Free-Remaining'));
        return{billing,...(billing==='free'?{freeRemaining:Number.isSafeInteger(remaining)&&remaining>=0?remaining:0}:{}),mode:'private',text,completionId:completion.id,reservation,
          attestation:shown(used),reply:{signatureKind:reply.signatureKind,signer:reply.signature.signer.signingAddress},
          receipt:{inferenceId:response.headers.get('Inference-Id')||await completionInferenceId(completion.id),chatId:completion.id,model:request.model.id,
            promptTokens:hasUsage?usage!.prompt_tokens:plain,completionTokens:hasUsage?usage!.completion_tokens:request.maxTokens,
            inPriceNano:request.model.inPriceNano,outPriceNano:request.model.outPriceNano,source:hasUsage?'signed_usage':'reservation'}};
      }
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
