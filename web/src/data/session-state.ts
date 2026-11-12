import type { IssuedKey, Session } from './types.ts';
export type SessionState={session:Session|null;issued:IssuedKey|null;revision:number};
export type SessionAction={type:'accept';session:Session|null}|{type:'issued';revision:number;key:IssuedKey|null};
export const initialSessionState:SessionState={session:null,issued:null,revision:0};
/** The revision also keys signing screens: cached proofs and reviewed purchases remount. */
export function reduceSession(state:SessionState,action:SessionAction):SessionState{
  if(action.type==='accept')return{session:action.session,issued:null,revision:state.revision+1};
  return action.revision===state.revision?{...state,issued:action.key}:state;
}
