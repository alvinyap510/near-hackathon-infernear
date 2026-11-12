// Offline fixtures only: wallet calls are recorded, never broadcast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { serializeNep413, type WalletSelector } from '@near-wallet-selector/core';
import { decodeFunctionData, encodeFunctionResult } from 'viem';
import { createLiveData } from './live.ts';
import { createWallets } from './wallets.ts';
import { createMockData } from './mock.ts';
import { aavePoolAbi, vaultAbi, usdcAbi } from './abi.ts';
import { DataError } from './errors.ts';
import type { LiveConfig } from '../config.ts';
import type { Session } from './types.ts';
const address=`0x${'a'.repeat(40)}` as const,token=`0x${'9'.repeat(40)}` as const;
const settings:LiveConfig={relayUrl:'https://relay.fixture',vaultChainId:8453,vaultAddress:`0x${'1'.repeat(40)}`,rateVaultAddress:`0x${'2'.repeat(40)}`,pendleVaultAddress:`0x${'3'.repeat(40)}`,
 baseRpcUrl:'https://base.fixture',nearRpcUrl:'https://near.fixture',connectorAccount:'connector.near',rheaVaultAccount:'vault.near',nearUsdcAccount:'usdc.near',intentsAccount:'intents.near',
 oneClickUrl:'https://oneclick.fixture',baseUsdcAssetId:'nep141:fixture',slippageBps:100,pendleAppUrl:'https://pendle.fixture',aavePoolAddress:`0x${'4'.repeat(40)}`,rheaLendAccount:'rhea.near',rheaCap:'1000000000'};
const near:Extract<Session,{kind:'near'}>={kind:'near',accountId:'alice.near',user:'near:mainnet:alice.near'};
const evm:Extract<Session,{kind:'evm'}>={kind:'evm',address,user:`eip155:8453:${address}`};
const code=(c:string)=>(e:unknown)=>e instanceof DataError&&e.code===c;
function fixture(){
 const calls:{url:string;body:any}[]=[],signed:any[]=[],messages:any[]=[],evmCalls:string[]=[],nearWalletIds:string[]=[];
 const memory=new Map<string,string>(),store={getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>{memory.set(k,v);},removeItem:(k:string)=>{memory.delete(k);}};
 const state={coverage:'1000000000000000000',registered:true,selected:'meteor-wallet' as string|null,accounts:[{accountId:'alice.near',active:true}],redirect:false,rejected:false};
 const wallet={async signIn(){state.selected='meteor-wallet';return state.redirect?undefined:state.accounts;},async signOut(){state.selected=null;state.accounts=[];},async getAccounts(){return state.accounts;},
  async signMessage(p:unknown){messages.push(p);return{accountId:'alice.near',publicKey:'ed25519:fixture',signature:Buffer.alloc(64).toString('base64')};},
  async signAndSendTransaction(p:unknown){if(state.rejected)throw{code:4001};signed.push(p);return{status:{SuccessValue:''},receipts_outcome:[],transaction:{hash:'fixture-near-transaction'}};}};
 const selector={wallet:async(id?:string)=>{nearWalletIds.push(id??state.selected??'');return wallet;},store:{getState:()=>({selectedWalletId:state.selected,accounts:state.accounts,modules:[{id:'meteor-wallet',metadata:{name:'Meteor Wallet',iconUrl:'meteor.svg',available:true}},{id:'my-near-wallet',metadata:{name:'MyNearWallet',iconUrl:'near.svg',available:true}}]})}} as unknown as WalletSelector;
 const provider={async request({method}:any){evmCalls.push(method);if(method==='eth_accounts'||method==='eth_requestAccounts')return[address];if(method==='eth_chainId')return'0x2105';if(method==='personal_sign')return`0x${'ab'.repeat(65)}`;if(method==='eth_sendTransaction')return`0x${'f'.repeat(64)}`;throw Error(method);}};
 const wallets=createWallets(settings,{selector:async()=>selector,storage:store,ethereum:provider as any});
 const json=(v:unknown)=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input),body=init?.body?JSON.parse(String(init.body)):{};calls.push({url,body});
  if(url===settings.nearRpcUrl){const v:Record<string,unknown>={account:{credited:'9007199254740999',spent:'1',available:'9007199254740998',key_epoch:2},position:{principal:'100000000',yield_credited:'3000000',pending_in:'2000000',pending_out:null},coverage:state.coverage,busy:false,ft_balance_of:'10000000',storage_balance_of:state.registered?{total:'1250000000000000000000'}:null,get_asset:{supply_apr:'0.04123456789'},mt_balance_of:'0'};return json({result:{result:[...new TextEncoder().encode(JSON.stringify(v[body.params.method_name]))]}});}
  if(url.startsWith(settings.baseRpcUrl)){
   let result:unknown='0x64';
   if(body.method==='eth_call'){
    const tx=body.params[0],pool=tx.to.toLowerCase()===settings.aavePoolAddress,abi=pool?aavePoolAbi:[settings.vaultAddress,settings.rateVaultAddress,settings.pendleVaultAddress].includes(tx.to.toLowerCase())?vaultAbi:usdcAbi;
    const d=decodeFunctionData({abi,data:tx.data});
    const v=pool?{configuration:0n,liquidityIndex:10n**27n,currentLiquidityRate:5n*10n**25n,variableBorrowIndex:0n,currentVariableBorrowRate:0n,currentStableBorrowRate:0n,lastUpdateTimestamp:1,id:0,aTokenAddress:token,stableDebtTokenAddress:token,variableDebtTokenAddress:token,interestRateStrategyAddress:token,accruedToTreasury:0n,unbacked:0n,isolationModeTotalDebt:0n}:d.functionName==='asset'||d.functionName==='yieldToken'?token:d.functionName==='depositCap'?1000n*10n**18n:d.functionName==='allowance'?0n:d.functionName==='yieldCredited'?42n:100_000_000n;
    result=encodeFunctionResult({abi,functionName:d.functionName,result:v} as any);
   }
   if(body.method==='eth_getTransactionReceipt')result={transactionHash:body.params[0],transactionIndex:'0x0',blockHash:`0x${'a'.repeat(64)}`,blockNumber:'0x64',from:address,to:settings.vaultAddress,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',effectiveGasPrice:'0x1',logs:[],logsBloom:`0x${'0'.repeat(512)}`,status:'0x1',type:'0x2',contractAddress:null};
   return json({jsonrpc:'2.0',id:body.id,result});
  }
  if(url.endsWith('/auth/nonce'))return json({nonce:'f'.repeat(48)});
  if(url.endsWith('/keys'))return json({key:'inf_fixture',key_epoch:2,expires_at:1900000000});throw Error('Unexpected fixture URL');
 };
 const data=createLiveData(settings,{fetch:fetcher,wallets,origin:'https://console.fixture:8443',now:()=>new Date('2026-11-12T12:00:00Z')});
 return{data,state,selector,store,provider,wallets,fetcher,calls,signed,messages,evmCalls,nearWalletIds};
}

test('NEAR overview uses native balances and registration, and marks Base vaults unusable without EVM calls',async()=>{
 const f=fixture();f.state.coverage='900000000000000000';const o=await f.data.overview(near);assert.equal(o.user,near.user);assert.equal(o.credits.available,9007199254740998n);assert.equal(o.vaults.length,4);assert(o.vaults.slice(0,3).every(v=>v.usable===false));
 assert.equal(o.vaults[3].position.walletBalance,10_000_000n);assert.equal(o.vaults[3].position.principal,90_000_000n);assert.equal(o.vaults[3].position.rhea?.usdcRegistered,true);
 assert(f.calls.every(c=>c.url===settings.nearRpcUrl));assert.equal(f.evmCalls.length,0);for(const c of f.calls)assert.equal(c.body.params.finality,'final');
 f.state.registered=false;assert.equal((await f.data.overview(near)).vaults[3].position.rhea?.usdcRegistered,false);
});
test('native NEAR deposit and withdrawal build exact calls with 1 yocto and 100 Tgas',async()=>{
 const f=fixture();assert.deepEqual(await f.data.rheaDepositNear(near,1_000_000n),{txHash:'fixture-near-transaction'});await f.data.rheaWithdrawNear(near,95_000_000n);
 for(const tx of f.signed){assert.equal(tx.signerId,'alice.near');assert.equal(tx.actions.length,1);assert.equal(tx.actions[0].functionCall.gas,100_000_000_000_000n);assert.equal(tx.actions[0].functionCall.deposit,1n);}
 const args=(tx:any)=>JSON.parse(new TextDecoder().decode(tx.actions[0].functionCall.args));
 assert.equal(f.signed[0].receiverId,'usdc.near');assert.equal(f.signed[0].actions[0].functionCall.methodName,'ft_transfer_call');assert.deepEqual(args(f.signed[0]),{receiver_id:'vault.near',amount:'1000000',msg:JSON.stringify({user:near.user})});
 assert.equal(f.signed[1].receiverId,'vault.near');assert.equal(f.signed[1].actions[0].functionCall.methodName,'withdraw');assert.deepEqual(args(f.signed[1]),{amount:'95000000'});assert.equal(f.evmCalls.length,0);
});
test('invalid amounts, wrong wallet kind and account changes fail before signing; wallet refusal maps explicitly',async()=>{
 const f=fixture();for(const a of [0n,-1n,999999n])await assert.rejects(f.data.rheaDepositNear(near,a),code('amount'));
 await assert.rejects(f.data.rheaDepositNear(near,10_000_001n),code('balance'));await assert.rejects(f.data.rheaWithdrawNear(near,0n),code('amount'));await assert.rejects(f.data.rheaWithdrawNear(near,100_000_001n),code('balance'));
 await assert.rejects(f.data.deposit(near,1n),code('wallet_kind'));await assert.rejects(f.data.redeem(near,1n),code('wallet_kind'));await assert.rejects(f.data.rheaDeposit(near,1n),code('wallet_kind'));assert.equal(f.signed.length,0);
 f.state.accounts=[{accountId:'other.near',active:true}];await assert.rejects(f.data.rheaDepositNear(near,1_000_000n),code('wallet_account'));f.state.accounts=[{accountId:'alice.near',active:true}];f.state.rejected=true;await assert.rejects(f.data.rheaWithdrawNear(near,1n),code('wallet_rejected'));
});
test('NEP-413 proof binds the exact message and SHA256 relay nonce to the dashboard host without a callback',async()=>{
 const f=fixture(),p=await f.data.walletProof(near);assert('near'in p);const signed=f.messages[0];assert.equal(signed.recipient,'console.fixture:8443');assert.equal(signed.callbackUrl,undefined);
 assert.equal(signed.message,JSON.stringify({statement:'Authorize one InferNear API key action.',account_id:'alice.near',nonce:'f'.repeat(48),expires_at:Date.parse('2026-11-12T12:05:00Z')/1000}));assert.equal(Buffer.from(signed.nonce).toString('hex'),createHash('sha256').update('f'.repeat(48)).digest('hex'));
 const string=(v:string)=>{const bytes=Buffer.from(v),n=Buffer.alloc(4);n.writeUInt32LE(bytes.length);return Buffer.concat([n,bytes]);};const tag=Buffer.alloc(4);tag.writeUInt32LE(2147484061);assert.deepEqual(serializeNep413(signed),Buffer.concat([tag,string(signed.message),Buffer.from(signed.nonce),string(signed.recipient),Buffer.from([0])]));
 assert.equal(p.near.nonce,Buffer.from(signed.nonce).toString('base64'));assert.equal(p.near.account_id,'alice.near');await f.data.createKey(p);assert.deepEqual(f.calls.at(-1)?.body,p);
});
test('public catalogue uses on-chain variable rates, no wallet, no invented yields and no unavailable Rhea total',async()=>{
 const f=fixture(),v=await f.data.catalogue(),of=(l:typeof v,k:string)=>l.find(x=>x.kind===k)!;assert.equal(v.length,4);assert.equal(v[0].kind,'rhea');assert(v.every(x=>x.yourPrincipal===undefined));assert.equal(f.signed.length+f.messages.length+f.evmCalls.length,0);
 assert.equal(of(v,'aave').rateNow,'5.00% · Aave supply rate now, variable');assert.equal(of(v,'rate').rateNow,undefined);assert.equal(of(v,'pendle').rateNow,undefined);assert.equal(of(v,'rhea').rateNow,'4.12% · Rhea supply rate now, variable');assert.equal(of(v,'rhea').deposited,undefined);assert.equal(of(v,'rhea').cap,'1,000.00 USDC');assert.deepEqual(of(v,'rhea').wallets,['evm','near']);
 const paused=createLiveData({...settings,rheaStatusNote:'Redeploying'},{fetch:f.fetcher,wallets:f.wallets});assert.equal(of(await paused.catalogue(),'rhea').status,'paused');assert.equal(of(await paused.catalogue(),'rhea').statusNote,'Redeploying');
 f.state.coverage='900000000000000000';const own=await f.data.catalogue(near);assert.equal(of(own,'aave').yourPrincipal,undefined);assert.equal(of(own,'rhea').yourPrincipal,'90.000000 USDC');
});
test('EIP-6963 provider selection stays pinned for all later signing and deposit calls',async()=>{
 const f=fixture(),target=new EventTarget();let otherCalls=0;target.addEventListener('eip6963:requestProvider',()=>target.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{rdns:'wallet.fixture',name:'Chosen wallet'},provider:f.provider}})));
 const wallets=createWallets(settings,{target,selector:async()=>f.selector,ethereum:{request:async()=>{otherCalls++;throw Error('wrong provider');}} as any});
 const options=await wallets.walletOptions();assert(options.some(o=>o.id==='evm:wallet.fixture'));assert(!options.some(o=>o.id==='evm:injected'));const chosen=await wallets.connectWallet('evm:wallet.fixture');assert.deepEqual(chosen,evm);
 const data=createLiveData(settings,{wallets,fetch:f.fetcher});await data.walletProof(chosen);await data.deposit(chosen,1n);assert(f.evmCalls.includes('personal_sign'));assert(f.evmCalls.includes('eth_sendTransaction'));assert.equal(otherCalls,0);
});
test('injected fallback, redirect-style NEAR restore and disconnect use no modal',async()=>{
 const f=fixture();assert((await f.wallets.walletOptions()).some(o=>o.id==='evm:injected'));f.state.redirect=true;f.state.selected=null;await assert.rejects(f.wallets.connectWallet('near:my-near-wallet'),code('wallet_redirect'));
 const reloaded=createWallets(settings,{selector:async()=>f.selector,storage:f.store});assert.deepEqual(await reloaded.restoreSession(),near);assert.equal(f.nearWalletIds.at(-1),'my-near-wallet','the redirect choice overrides a previous selected wallet');await reloaded.disconnect();assert.equal(await reloaded.restoreSession(),null);
 f.state.accounts=[{accountId:'alice.near',active:true}];f.state.selected='meteor-wallet';const switched=createWallets(settings,{selector:async()=>f.selector,storage:f.store,ethereum:f.provider as any});await switched.connectWallet('evm:injected');await switched.disconnect();const again=createWallets(settings,{selector:async()=>f.selector,storage:f.store});assert.equal(await again.restoreSession(),null,'disconnect must not revive an older NEAR login');
});
test('labelled mock supports NEAR credits and native operations independently of the EVM account',async()=>{
 const data=createMockData(),s=await data.connectWallet('near:meteor-wallet');if(s.kind!=='near')throw Error('wrong kind');const before=await data.overview(s),base=await data.overview(address);
 await data.rheaDepositNear(s,1_000_000n);assert.equal((await data.overview(s)).vaults[3].position.rhea?.pendingIn,1_000_000n);const active=await data.overview(s);assert.equal(active.vaults[3].position.shares,before.vaults[3].position.shares+1_000_000n);
 await data.rheaWithdrawNear(s,500_000n);assert.equal((await data.overview(s)).vaults[3].position.shares,active.vaults[3].position.shares-500_000n);await data.revokeAll(await data.walletProof(s));assert.equal((await data.overview(address)).credits.keyEpoch,base.credits.keyEpoch);assert.equal((await data.overview(s)).credits.keyEpoch,before.credits.keyEpoch+1);
 const issued=await data.createKey(await data.walletProof(s)),beforeRun=await data.overview(s);const run=await data.run({key:issued.key,model:(await data.models())[0],prompt:'fixture',maxTokens:2},()=>{});const afterRun=await data.overview(s);assert(afterRun.credits.spent>beforeRun.credits.spent);assert.equal(afterRun.vaults[3].position.principal,beforeRun.vaults[3].position.principal);assert.equal((await data.overview(address)).credits.spent,base.credits.spent);assert.equal(await data.debitedAmount(run.receipt.inferenceId),run.simulatedDebit);
 assert((await data.catalogue()).every(v=>v.statusNote?.includes('Mock')));assert.equal((await data.catalogue(s)).find(v=>v.kind==='aave')!.yourPrincipal,undefined);assert.equal((await data.catalogue(s))[0].kind,'rhea');await data.disconnect();assert.equal(await data.restoreSession(),null);
});


test('Flex1-1: native Rhea pause and deficit reject before signing; withdrawals stay available',async()=>{
  const f=fixture();
  const paused=createLiveData({...settings,rheaStatusNote:'Redeploying'},{fetch:f.fetcher,wallets:f.wallets});
  await assert.rejects(paused.rheaDepositNear(near,1_000_000n),code('paused'));
  assert.equal(f.signed.length,0);assert.equal(f.calls.length,0);
  f.state.coverage='900000000000000000';
  await assert.rejects(f.data.rheaDepositNear(near,1_000_000n),code('deficit'));assert.equal(f.signed.length,0);
  await paused.rheaWithdrawNear(near,1_000_000n);assert.equal(f.signed.length,1,'neither gate may block principal withdrawals');
});


test('CR1-2: a disconnect during native Rhea views cancels both transaction builders',async()=>{
 for(const method of ['rheaDepositNear','rheaWithdrawNear'] as const){
  const f=fixture();const pending=f.data[method](near,1_000_000n),rejected=assert.rejects(pending,code('wallet_session_changed'));
  await f.data.disconnect();await rejected;assert.equal(f.signed.length,0);
 }
});
