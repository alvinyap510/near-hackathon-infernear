import type { LiveConfig } from '../config.ts';
import { DataError, readAmount } from './errors.ts';
import type { Address, BridgeQuote, Chain } from './types.ts';
const ORIGINS={eth:{id:'1',name:'Ethereum'},arb:{id:'42161',name:'Arbitrum'},op:{id:'10',name:'Optimism'},pol:{id:'137',name:'Polygon'}} as const;
type Token={assetId:string;contractAddress:Address;symbol:string;blockchain:string;decimals:number};
export function createBridgeData(settings:LiveConfig,fetcher:typeof fetch,now:()=>Date){
  const base=settings.oneClickUrl.replace(/\/$/,'');
  const tokens=async()=>{const response=await fetcher(`${base}/v0/tokens`),body=await response.json();if(!response.ok||!Array.isArray(body))throw new DataError('oneclick','Unable to read supported bridge assets.');return(body as Token[]).filter(t=>t.symbol==='USDC'&&t.decimals===6&&typeof t.assetId==='string'&&/^0x[0-9a-fA-F]{40}$/.test(t.contractAddress));};
  return{
    async bridgeChains():Promise<Chain[]>{const list=await tokens();return Object.entries(ORIGINS).filter(([key])=>list.some(t=>t.blockchain===key)).map(([,chain])=>({...chain}));},
    async bridgeQuote(fromChain:string,amount:bigint,recipient:Address):Promise<BridgeQuote>{
      if(amount<=0n)throw new DataError('amount','Enter an amount above zero.');
      const list=await tokens(),origin=Object.entries(ORIGINS).find(([,c])=>c.id===fromChain);
      const source=origin&&list.find(t=>t.blockchain===origin[0]),destination=list.find(t=>t.blockchain==='base'&&t.assetId===settings.baseUsdcAssetId);
      if(!source||!destination)throw new DataError('bridge_route','This USDC route is not listed by 1Click.');
      const request={dry:true,swapType:'EXACT_INPUT',slippageTolerance:settings.slippageBps,originAsset:source.assetId,destinationAsset:destination.assetId,
        depositType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN',refundType:'ORIGIN_CHAIN',amount:String(amount),refundTo:recipient.toLowerCase(),recipient:recipient.toLowerCase(),deadline:new Date(now().getTime()+600_000).toISOString()};
      const response=await fetcher(`${base}/v0/quote`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)}),body=await response.json();
      if(!response.ok)throw new DataError('oneclick',body.message??'1Click quote failed.');
      for(const key of Object.keys(request) as (keyof typeof request)[])if(body.quoteRequest?.[key]!==request[key])throw new DataError('quote','1Click returned a different route.');
      const q=body.quote,deadline=q?.deadline??body.quoteRequest.deadline;
      if(!(Date.parse(deadline)>now().getTime())||readAmount(q?.amountIn,'quote')!==amount)throw new DataError('quote','1Click returned an expired or mismatched quote.');
      return{fromChain,amountIn:amount,amountOut:readAmount(q?.amountOut,'quote'),minAmountOut:readAmount(q?.minAmountOut,'quote'),recipient,etaSeconds:q.timeEstimate,dry:true,isMock:false,deadline,originToken:source.contractAddress,
        sendDisabledReason:'Sending from this panel is not available in this release. This is a real dry quote; no funds have moved.'};
    },
  };
}
