import { useCallback, useEffect, useRef, useState } from 'react';
import { MockRibbon, Header, type Tab, TABS } from './components/Shell.tsx';
import { WalletDialog } from './components/WalletChooser.tsx';
import { VaultCatalogue } from './components/VaultCatalogue.tsx';
import { ConnectPrompt } from './components/ConnectPrompt.tsx';
import { data, type Session, type WalletOption, type CatalogueVault, type IssuedKey, type Overview } from './data/index.ts';
import { Account } from './screens/Account.tsx';
import { Bridge } from './screens/Bridge.tsx';
import { Keys } from './screens/Keys.tsx';
import { TryApi } from './screens/TryApi.tsx';
import { ErrorNote, Spinner, errorText } from './components/ui.tsx';
const tabFromHash=():Tab=>{const id=window.location.hash.slice(1);return TABS.some(t=>t.id===id)?id as Tab:'vaults';};
export function App(){
  const [session,setSession]=useState<Session|null>(null),current=useRef<Session|null>(null),version=useRef(0);
  const [overview,setOverview]=useState<Overview|null>(null),[readError,setReadError]=useState<string|null>(null);
  const [issued,setIssued]=useState<IssuedKey|null>(null),[tab,setTab]=useState<Tab>(tabFromHash),[selectedId,setSelectedId]=useState<string>();
  const [vaults,setVaults]=useState<CatalogueVault[]>([]),[catalogueError,setCatalogueError]=useState<string|null>(null),[loading,setLoading]=useState(true);
  const [dialog,setDialog]=useState(false),[options,setOptions]=useState<WalletOption[]>([]),[walletError,setWalletError]=useState<string|null>(null),[busyId,setBusyId]=useState<string|null>(null);
  const accept=useCallback((next:Session|null)=>{
    const previous=current.current;version.current++;current.current=next;setSession(next);
    // A slow anonymous wallet restore must not erase an already loaded public catalogue.
    if(previous===null&&next===null)return;
    setVaults([]);setLoading(true);setOverview(null);setReadError(null);setIssued(null);
  },[]);
  const go=useCallback((next:Tab)=>{window.location.hash=next;window.scrollTo({top:0});},[]);
  useEffect(()=>{const onHash=()=>{if(window.location.hash!=='#main')setTab(tabFromHash());};window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash);},[]);
  useEffect(()=>{let stopped=false;const started=version.current;void data.restoreSession().then(s=>{if(!stopped&&version.current===started)accept(s);}).catch(e=>{if(!stopped)setWalletError(errorText(e));});return()=>{stopped=true;};},[accept]);
  const refresh=useCallback(async()=>{
    const owner=current.current;
    const [account,list]=await Promise.allSettled([owner?data.overview(owner):Promise.resolve(null),data.catalogue(owner??undefined)]);
    if(current.current?.user!==owner?.user)return;
    if(list.status==='fulfilled'){setVaults(list.value);setCatalogueError(null);}else setCatalogueError(errorText(list.reason));
    if(account.status==='rejected'){setReadError(errorText(account.reason));throw account.reason;}
    setOverview(account.value);setReadError(null);
  },[]);
  useEffect(()=>{let stopped=false;setLoading(true);void data.catalogue(session??undefined).then(v=>{if(!stopped){setVaults(v);setCatalogueError(null);}}).catch(e=>{if(!stopped)setCatalogueError(errorText(e));}).finally(()=>{if(!stopped)setLoading(false);});return()=>{stopped=true;};},[session]);
  useEffect(()=>{let stopped=false;if(session)void data.overview(session).then(v=>{if(!stopped){setOverview(v);setReadError(null);}}).catch(e=>{if(!stopped)setReadError(errorText(e));});return()=>{stopped=true;};},[session,tab]);
  const openWallet=()=>{setDialog(true);setWalletError(null);void data.walletOptions().then(setOptions).catch(e=>setWalletError(errorText(e)));};
  const connect=async(id:string)=>{setBusyId(id);setWalletError(null);try{accept(await data.connectWallet(id));setDialog(false);}catch(e){setWalletError(errorText(e));}finally{setBusyId(null);}};
  const disconnect=async()=>{try{await data.disconnect();accept(null);}catch(e){setWalletError(errorText(e));setDialog(true);}};
  const choose=(id:string)=>{setSelectedId(id);go('account');};
  let content;
  if(tab==='vaults')content=<VaultCatalogue vaults={vaults} loading={loading} error={catalogueError} connectedKind={session?.kind??null} onChoose={choose} onConnect={openWallet}/>;
  else if(tab==='try')content=<TryApi key={session?.user??'public'} apiKey={issued?.key??null} onChanged={refresh} onKeys={()=>go('keys')} onCredits={()=>go('account')}/>;
  else if(!session)content=<ConnectPrompt title={tab==='account'?'Your account':tab==='keys'?'Your API keys':'Bring USDC to Base'} onConnect={openWallet}/>;
  else if(tab==='bridge')content=session.kind==='evm'?<Bridge session={session} onDeposit={()=>go('account')}/>:<ConnectPrompt title="This route needs an EVM wallet" onConnect={openWallet}/>;
  else if(!overview)content=readError?<ErrorNote error={readError}/>:<p className="loading"><Spinner/> Reading your vaults and credits…</p>;
  else if(tab==='keys')content=<Keys session={session} overview={overview} issued={issued} onIssued={key=>{if(current.current?.user===session.user)setIssued(key);}} onChanged={refresh} onTry={()=>go('try')}/>;
  else content=<Account session={session} overview={overview} selectedId={selectedId} onSelect={setSelectedId} onChanged={refresh} onBridge={()=>go('bridge')} onConnect={openWallet}/>;
  return <>{data.isMock&&<MockRibbon/>}<Header address={session?(session.kind==='evm'?session.address:session.accountId):null} chainName={session?.kind==='near'?'NEAR':'Base'} tab={tab} onTab={go} onConnect={openWallet} onDisconnect={()=>void disconnect()}/>
    <main id="main" className="page">{content}</main><WalletDialog open={dialog} onClose={()=>{if(!busyId)setDialog(false);}} options={options} busyId={busyId} error={walletError} onSelect={id=>void connect(id)}/>
    <footer className="footer"><span>InferNear · built at NEAR HACKATHON</span><span>Inference credits from yield or direct purchase · principal stays yours</span></footer></>;
}
