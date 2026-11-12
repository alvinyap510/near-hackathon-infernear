import type { Address, PurchaseState } from './types.ts';
import { DataError } from './errors.ts';
export type PurchaseStorage = Pick<Storage,'getItem'|'setItem'|'removeItem'>;
/** Public transaction metadata only. Persist before asking the wallet to submit pay. */
export function createPurchaseJournal(chainId:number,contract:Address|undefined,storage?:PurchaseStorage){
  const memory=new Map<string,string>(), emergency=new Map<string,string>();
  const backend=storage??(typeof window==='undefined'?{
    getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>{memory.set(key,value);},removeItem:(key:string)=>{memory.delete(key);},
  }:window.localStorage);
  const key=(payer:Address)=>`infernear.purchase:${chainId}:${contract?.toLowerCase()}:${payer.toLowerCase()}`;
  return{
    read(payer:Address):PurchaseState|null{
      try{const raw=emergency.get(key(payer))??backend.getItem(key(payer));if(!raw)return null;const state=JSON.parse(raw);
        if(!state||typeof state.amount!=='string'||!/^\d+$/.test(state.amount)||!['submitting','pending','confirmed','reverted'].includes(state.status)||(state.hash!==undefined&&!/^0x[0-9a-fA-F]{64}$/.test(state.hash))||(state.status==='confirmed'&&!state.hash))throw new Error('invalid purchase metadata');
        return state;}
      catch{throw new DataError('purchase_storage','Purchase history is unreadable. Check wallet activity before purchasing again.');}
    },
    write(payer:Address,state:PurchaseState){
      const serialized=JSON.stringify(state);
      try{backend.setItem(key(payer),serialized);emergency.delete(key(payer));}
      catch{
        // A returned hash must survive even if browser storage fills after broadcast.
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
    setAsideUnsent(payer:Address){
      const old=this.read(payer);
      if(!old)return;
      if(old.hash||old.status!=='submitting')throw new DataError('purchase_pending','This purchase has a transaction. Check its receipt instead.');
      try{backend.removeItem(key(payer));emergency.delete(key(payer));}catch{throw new DataError('purchase_storage','Cannot clear the purchase record.');}
    },
  };
}
