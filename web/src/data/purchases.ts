import type { Address, PurchaseState } from './types.ts';
import { DataError } from './errors.ts';
export type PurchaseStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type PurchaseLock = (name:string)=>Promise<()=>void>;
const held=new Set<string>();
const busy=()=>new DataError('purchase_pending','A purchase operation is active in another window.');
const acquire:PurchaseLock=async name=>{
  if(typeof navigator!=='undefined'&&navigator.locks)return new Promise((resolve,reject)=>{
    void navigator.locks.request(name,{ifAvailable:true},lock=>{
      if(!lock){reject(busy());return;}
      return new Promise<void>(release=>resolve(release));
    }).catch(reject);
  });
  if(held.has(name))throw busy();held.add(name);return()=>{held.delete(name);};
};
/** Public transaction metadata only. Persist before asking the wallet to submit pay. */
export function createPurchaseJournal(chainId:number,contract:Address|undefined,storage?:PurchaseStorage,lock:PurchaseLock=acquire){
  const memory=new Map<string,string>(), emergency=new Map<string,string>();
  const backend=storage??(typeof window==='undefined'?{
    getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);},
  }:window.localStorage);
  const key=(payer:Address)=>`infernear.purchase:${chainId}:${contract?.toLowerCase()}:${payer.toLowerCase()}`;
  return{
    async lock(payer:Address){const release=await lock(key(payer));let released=false;return()=>{if(!released){released=true;release();}};},
    async mutate<T>(payer:Address,run:()=>T|Promise<T>):Promise<T>{const release=await this.lock(payer);try{return await run();}finally{release();}},
    // Caller holds the shared lock; an awaited result may only replace its original record.
    replace(payer:Address,expected:PurchaseState,next:PurchaseState){
      const current=this.read(payer);if(JSON.stringify(current)!==JSON.stringify(expected))return current;
      this.write(payer,next);return next;
    },
    async settle(payer:Address,expected:PurchaseState,status:PurchaseState['status']){
      try{return await this.mutate(payer,()=>this.replace(payer,expected,{...expected,status}));}
      catch(error){if(error instanceof DataError&&error.code==='purchase_pending')return this.read(payer);throw error;}
    },
    read(payer:Address):PurchaseState|null{
      try{const raw=emergency.get(key(payer))??backend.getItem(key(payer));if(!raw)return null;const state=JSON.parse(raw);
        if(!state||typeof state.amount!=='string'||!/^\d+$/.test(state.amount)||!['submitting','pending','confirmed','reverted'].includes(state.status)||(state.paid!==undefined&&(typeof state.paid!=='string'||!/^\d+$/.test(state.paid)))||(state.hash!==undefined&&!/^0x[0-9a-fA-F]{64}$/.test(state.hash))||(state.status==='confirmed'&&!state.hash))throw new Error('invalid purchase metadata');
        return state;}
      catch{throw new DataError('purchase_storage','Purchase history is unreadable. Check wallet activity before purchasing again.');}
    },
    write(payer:Address,state:PurchaseState){
      const serialized=JSON.stringify(state);
      try{backend.setItem(key(payer),serialized);emergency.delete(key(payer));}
      catch{
        if(state.hash){
          try{backend.removeItem(key(payer));backend.setItem(key(payer),serialized);emergency.delete(key(payer));return;}
          catch{try{backend.setItem(key(payer),JSON.stringify({...state,hash:undefined,status:'pending'}));}catch{/* Storage unavailable: retain the hash in this page. */}}
        }
        if(state.hash||state.status==='reverted')emergency.set(key(payer),serialized);
        throw new DataError('purchase_storage',`Cannot save purchase status${state.hash?` for ${state.hash}`:''}. No new purchase will be requested.`);
      }
    },
    review(payer:Address,settledHash?:`0x${string}`){
      const old=this.read(payer);
      if(old && old.status!=='confirmed' && old.status!=='reverted')throw new DataError('purchase_pending','Reconcile the previous purchase before reviewing another.');
      if(old?.hash && old.hash!==settledHash)throw new DataError('purchase_pending','Show and acknowledge the reconciled transaction before another purchase.');
      try{backend.removeItem(key(payer));emergency.delete(key(payer));}catch{throw new DataError('purchase_storage','Cannot clear the reconciled purchase.');}
    },
    /** The one way out of a submission the wallet never returned a hash for: the user states that nothing was sent. A record with a hash can never be set aside. */
    setAsideUnsent(payer:Address,paid:bigint){
      const old=this.read(payer);
      if(!old)return;
      if(old.hash||old.status!=='submitting')throw new DataError('purchase_pending','This purchase has a transaction. Check its receipt instead.');
      if(old.paid===undefined||paid>BigInt(old.paid))throw new DataError('purchase_pending','Total bought has risen or the previous total is unknown. Check the purchase on Base.');
      try{backend.removeItem(key(payer));emergency.delete(key(payer));}catch{throw new DataError('purchase_storage','Cannot clear the purchase record.');}
    },
  };
}
