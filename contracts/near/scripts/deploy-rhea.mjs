// NOT RUN by automated tests. This script sends mainnet transactions when invoked.
import { readFile } from 'node:fs/promises';
import { Account, JsonRpcProvider, KeyPair, actions, nearToYocto } from 'near-api-js';

const required = key => { const value=process.env[key];if(!value)throw new Error('missing configuration');return value; };
const view = async (provider,contractId,method,args={}) => provider.callFunction({contractId,method,args,blockQuery:{finality:'final'}});
const stage = (event,details={}) => console.log(JSON.stringify({event,...details}));
async function deploy() {
  // Explicit architecture day-1 gate: a terminal true result must deliver exactly w.
  if(required('NEAR_RHEA_WITHDRAW_VERIFIED')!=='true')throw new Error('mainnet withdrawal semantics unverified');
  const provider=new JsonRpcProvider({url:required('NEAR_RPC_URL')});
  const sponsor=new Account(required('NEAR_DEPLOYER_ACCOUNT'),provider,required('NEAR_DEPLOYER_PRIVATE_KEY'));
  const id=required('NEAR_RHEA_VAULT_ACCOUNT');
  const key=required('NEAR_RHEA_VAULT_PRIVATE_KEY');
  const publicKey=KeyPair.fromString(key).getPublicKey();
  const usdc=required('NEAR_USDC_ACCOUNT'),rhea=required('NEAR_RHEA_ACCOUNT'),intents=required('NEAR_INTENTS_ACCOUNT');
  const treasury=required('TREASURY_NEAR_ACCOUNT');
  const cushion=BigInt(required('NEAR_RHEA_CUSHION'));
  const wasm=await readFile(required('NEAR_RHEA_WASM'));
  if(BigInt(await view(provider,usdc,'ft_balance_of',{account_id:sponsor.accountId}))<cushion)throw new Error('cushion funding unavailable');
  stage('create_account',{account:id});
  await sponsor.createAccount(id,publicKey,nearToYocto(required('NEAR_RHEA_INITIAL_NEAR')));
  const vault=new Account(id,provider,key);
  // Register and donate before publishing code. Deploy+new are one atomic action
  // batch: no public uninitialized contract can be front-run to replace its config.
  const register=async (contractId,account_id)=>{
    if(await view(provider,contractId,'storage_balance_of',{account_id}))return;
    const bounds=await view(provider,contractId,'storage_balance_bounds');
    await sponsor.callFunction({contractId,methodName:'storage_deposit',args:{account_id,registration_only:true},deposit:BigInt(bounds.min)});
  };
  stage('register_storage');
  await register(usdc,id);await register(rhea,id);await register(usdc,treasury);
  if(cushion>0n)await sponsor.callFunction({contractId:usdc,methodName:'ft_transfer',args:{receiver_id:id,amount:String(cushion)},deposit:1n});
  const observed=BigInt(await view(provider,usdc,'ft_balance_of',{account_id:id}));
  if(observed!==cushion)throw new Error('cushion balance mismatch before initialization');
  stage('deploy_and_initialize');
  await vault.signAndSendTransaction({receiverId:id,actions:[
    actions.deployContract(wasm),
    actions.functionCall('new',{usdc,rhea,intents,treasury,cushion:String(cushion),min_deposit:required('NEAR_RHEA_MIN_DEPOSIT'),cap:required('NEAR_RHEA_CAP')},30_000_000_000_000n,0n)
  ]});
  if(await view(provider,id,'idle')!==String(cushion))throw new Error('initial idle mismatch');
  const keys=await provider.viewAccessKeyList({accountId:id});
  const full=keys.keys.filter(k=>k.access_key.permission==='FullAccess');
  // Remove the signing key last so all other full-access keys can be deleted.
  full.sort((a,b)=>Number(a.public_key.toString()===publicKey.toString())-Number(b.public_key.toString()===publicKey.toString()));
  for(const entry of full){await vault.deleteKey(entry.public_key);stage('full_access_key_deleted');}
  const remaining=await provider.viewAccessKeyList({accountId:id});
  if(remaining.keys.some(k=>k.access_key.permission==='FullAccess'))throw new Error('full-access keys remain');
  stage('keyless_vault_ready',{account:id});
}
void deploy().catch(()=>{stage('deployment_failed',{reason:'inspect_last_stage_and_recover_manually_with_the_bootstrap_key'});process.exitCode=1;});
