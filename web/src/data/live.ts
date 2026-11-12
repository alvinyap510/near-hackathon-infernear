import {
  BaseError, UserRejectedRequestError, createPublicClient, createWalletClient,
  custom, defineChain, getAddress, http, type EIP1193Provider, type Hash,
} from 'viem';
import { caip10, type LiveConfig } from '../config.ts';
import { vaultAbi, usdcAbi, aavePoolAbi, topUpAbi } from './abi.ts';
import { DataError, readAmount as amount } from './errors.ts';
import { createPurchaseJournal, type PurchaseStorage } from './purchases.ts';
import { createChatData } from './chat.ts';
import { createBridgeData } from './bridge.ts';
import { createRheaData, type NearView } from './rhea.ts';
import { createWallets, defaultWallets, type Wallets } from './wallets.ts';
import { nearSessionData } from './near-session.ts';
import { evmAddress, emptyPosition } from './session.ts';
import { STRATEGIES, decimalPercent } from './catalogue.ts';
import { formatAmount } from './money.ts';
import { walletProofMessage } from './proof.ts';
import { LOSS_NOTES, type Address, type DashboardData, type VaultAccount, type Session, type SessionInput, type Overview, type WalletProof, type EvmWalletProof, type CatalogueVault } from './types.ts';

type Dependencies = {
  wallets?: Wallets;
  purchaseStorage?: PurchaseStorage;
  waitForReceipt?: (hash: Hash) => Promise<{ status: 'success' | 'reverted' }>;
  ethereum?: Pick<EIP1193Provider, 'request'>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  // The dashboard's own origin; defaults to the page's.
  origin?: string;
};

export function dataError(error: unknown): DataError {
  if (error instanceof DataError) return error;
  if(error instanceof BaseError){const cause=error.walk(value=>value instanceof DataError);if(cause instanceof DataError)return cause;}
  if ((error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError) instanceof UserRejectedRequestError) ||
      (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001))
    return new DataError('wallet_rejected', 'The request was declined in your wallet.');
  return new DataError('rpc', error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'The request failed.');
}

export function createLiveData(settings: LiveConfig, dependencies: Dependencies = {}): DashboardData {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  const wallets = dependencies.wallets ?? (dependencies.ethereum ? createWallets(settings, { ethereum: dependencies.ethereum }) : defaultWallets);
  const now = dependencies.now ?? (() => new Date());
  const chain = defineChain({
    id: settings.vaultChainId,
    name: 'Vault chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [settings.baseRpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(settings.baseRpcUrl, { fetchFn: fetcher }) });
  const chat = createChatData(settings.relayUrl, fetcher);
  const bridge = createBridgeData(settings, fetcher, now);

  const guarded = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { throw dataError(error); }
  };
  const wallet = (check:()=>void) => {
    const provider = wallets.evmProvider();
    if (!provider) throw new DataError('wallet_missing', 'Install or enable an injected Ethereum wallet.');
    return createWalletClient({ chain, transport: custom({request:args=>{check();return provider.request(args);}}) });
  };
  const readyWallet = async (address: Address, check=wallets.operation()) => {
    check();
    const client = wallet(check);
    const [selected] = await client.getAddresses();check();
    if (selected?.toLowerCase() !== address.toLowerCase())
      throw new DataError('wallet_account', 'Switch back to the connected wallet account before signing or sending.');
    const chainId=await client.getChainId();check();
    if(chainId!==chain.id){await client.switchChain({id:chain.id});check();}
    return client;
  };
  const confirmed = async (hash: Hash) => {
    const receipt = await (dependencies.waitForReceipt?.(hash) ?? publicClient.waitForTransactionReceipt({ hash }));
    if (receipt.status !== 'success') throw new DataError('transaction_reverted', 'The transaction reverted on-chain.');
    return { txHash: hash };
  };
  const token = (address = settings.vaultAddress) => publicClient.readContract({ address, abi: vaultAbi, functionName: 'asset' });

  const relay = async <T>(path: string, proof?: unknown): Promise<T> => {
    const response = await fetcher(`${settings.relayUrl.replace(/\/$/, '')}${path}`, proof ? {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(proof),
    } : undefined);
    const body = await response.json();
    if (!response.ok) throw new DataError(body.error?.code ?? `http_${response.status}`, body.error?.message ?? `Relay request failed (${response.status}).`);
    return body as T;
  };
  const nearView: NearView = async <T>(methodName: string, args: Record<string, unknown>, contract = settings.connectorAccount): Promise<T> => {
    const bytes = new TextEncoder().encode(JSON.stringify(args));
    const response = await fetcher(settings.nearRpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: methodName, method: 'query', params: {
        request_type: 'call_function', finality: 'final', account_id: contract,
        method_name: methodName, args_base64: btoa(String.fromCharCode(...bytes)),
      } }),
    });
    const body = await response.json();
    if (!response.ok || body.error || body.result?.error)
      throw new DataError('near_rpc', body.error?.message ?? body.result?.error ?? `NEAR view failed (${response.status}).`);
    if (!Array.isArray(body.result?.result)) throw new DataError('near_rpc', 'NEAR returned no view result.');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
  };

  const evmVaults = [
    { kind: 'aave', address: settings.vaultAddress, name: 'Aave USDC vault', symbol: 'USDC', decimals: 6, units: 'USDC' },
    { kind: 'rate', address: settings.rateVaultAddress, name: 'cbETH vault', symbol: 'cbETH', decimals: 18, units: 'ETH wei' },
    { kind: 'pendle', address: settings.pendleVaultAddress, name: 'Pendle PT-deJAAA vault', symbol: 'PT-deJAAA', decimals: 18, units: 'USDC-scaled18' },
  ] as const;
  const selectVault = (id?: string) => {
    const selected = id === undefined ? evmVaults[0] : evmVaults.find(vault => caip10(vault.address, chain.id) === id);
    if (!selected) throw new DataError('vault', 'Choose an EVM vault; Rhea uses its bridge and signed withdrawal methods.');
    return selected;
  };
  const rheaOperation=()=>{
    const check=wallets.operation();
    return createRheaData(settings,{fetch:fetcher,now,nearView,check,
      ready:async address=>{await readyWallet(address,check);},
      sign:async(address,message)=>{const client=await readyWallet(address,check);check();const signed=await client.signMessage({account:getAddress(address),message});check();return signed;},
      transfer:async(address,to,assets)=>{const usdc=await token(),client=await readyWallet(address,check);check();return confirmed(await client.writeContract({address:usdc,abi:usdcAbi,functionName:'transfer',args:[to,assets],account:address}));},
      relay:async<T>(path:string,body?:unknown):Promise<T>=>{check();return relay<T>(path,body);},
    });
  };
  const rheaReads=createRheaData(settings,{fetch:fetcher,now,nearView,check:()=>{},ready:async()=>{},sign:async()=>{throw new Error('read only');},transfer:async()=>{throw new Error('read only');},relay});

  const near = nearSessionData(settings, { wallets, view: nearView, relay, now,
    origin: () => dependencies.origin ?? globalThis.location?.origin ?? settings.relayUrl });
  const nearOverview = async (session: Extract<Session, {kind:'near'}>): Promise<Overview> => {
    const user = `near:mainnet:${session.accountId}`;
    const [credits, position, coverage, busy, balance, storage] = await Promise.all([
      nearView<{credited:string;spent:string;available:string;key_epoch:number}>('account',{user}),
      nearView<{principal:string;yield_credited:string;pending_in:string;pending_out:string|null}>('position',{user},settings.rheaVaultAccount),
      nearView<string>('coverage',{},settings.rheaVaultAccount), nearView<boolean>('busy',{},settings.rheaVaultAccount),
      nearView<string>('ft_balance_of',{account_id:session.accountId},settings.nearUsdcAccount),
      nearView<{total:string}|null>('storage_balance_of',{account_id:session.accountId},settings.nearUsdcAccount),
    ]);
    if (!Number.isSafeInteger(credits.key_epoch) || credits.key_epoch < 0 || typeof busy !== 'boolean') throw new DataError('near_rpc','Invalid NEAR account state.');
    const vaults: VaultAccount[] = evmVaults.map(v => ({id:caip10(v.address,chain.id),kind:v.kind,name:v.name,
      chain:{id:`eip155:${chain.id}`,name:'Base'},asset:{address:'',symbol:v.symbol,decimals:v.decimals},
      yieldToken:{address:'',symbol:v.symbol,decimals:v.decimals},unitsLabel:v.units,lossNote:LOSS_NOTES[v.kind],usable:false,position:emptyPosition()}));
    const token = {address:settings.nearUsdcAccount,symbol:'USDC',decimals:6} as const;
    vaults.push({id:`near:mainnet:${settings.rheaVaultAccount}`,kind:'rhea',name:'Rhea USDC vault',chain:{id:'near:mainnet',name:'NEAR'},asset:token,yieldToken:token,
      unitsLabel:'USDC',lossNote:LOSS_NOTES.rhea,usable:true,position:{principal:amount(position.principal)*amount(coverage)/10n**18n,shares:amount(position.principal),
        yieldCredited:amount(position.yield_credited),walletBalance:amount(balance),allowance:0n,
        rhea:{pendingIn:amount(position.pending_in),pendingOut:position.pending_out===null?null:amount(position.pending_out),coverage:amount(coverage),busy,intentsBalance:0n,
          usdcRegistered:storage!==null && typeof storage.total==='string'}}});
    return {user,vaults,vault:{...emptyPosition(),walletUsdc:0n},credits:{credited:amount(credits.credited),spent:amount(credits.spent),available:amount(credits.available),keyEpoch:credits.key_epoch}};
  };
  async function walletProof(address: Address): Promise<EvmWalletProof>;
  async function walletProof(session: Session): Promise<WalletProof>;
  async function walletProof(input: SessionInput): Promise<WalletProof> {
    return guarded(async () => {
      if (typeof input !== 'string' && input.kind === 'near') return near.walletProof(input);
      const check=wallets.operation();
      const address = evmAddress(input), client = await readyWallet(address,check);
      const {nonce} = await relay<{nonce:string}>('/auth/nonce');
      const message = walletProofMessage(address,nonce,dependencies.origin ?? globalThis.location?.origin ?? settings.relayUrl,chain.id,now());
      check();const signature=await client.signMessage({account:getAddress(address),message});check();return {message,signature};
    });
  }

  const purchases=createPurchaseJournal(chain.id,settings.topUpAddress,dependencies.purchaseStorage);
  const purchasing=new Set<string>();
  const reconcilePurchase=async(input:SessionInput)=>{
    const address=evmAddress(input),state=purchases.read(address);
    if(!state?.hash || state.status==='confirmed'||state.status==='reverted')return state;
    let receipt;
    try{receipt=await publicClient.getTransactionReceipt({hash:state.hash});}
    catch{return state;} // Missing/unavailable receipt never means another pay is safe.
    state.status=receipt.status==='success'?'confirmed':'reverted';purchases.write(address,state);
    return state;
  };

  const result: DashboardData = {
    isMock: false,
    isRunMock: false,
    subscribeWallet: listener=>wallets.subscribe(listener),
    topUpPurchase: input=>guarded(()=>reconcilePurchase(input)),
    reviewTopUp: (input,hash)=>guarded(async()=>{purchases.review(evmAddress(input),hash);}),
    setAsideUnsentTopUp: input=>guarded(async()=>{
      const address=evmAddress(input);
      // Not while this page is still waiting on the wallet for that very request.
      if(purchasing.has(address.toLowerCase()))throw new DataError('purchase_pending','A purchase is still waiting in your wallet.');
      purchases.setAsideUnsent(address);
    }),
    topUpAccount: input => guarded(async () => {
      if (!settings.topUpAddress || (typeof input!=='string' && input.kind!=='evm')) return null;
      const address=evmAddress(input), blockNumber=await publicClient.getBlockNumber({cacheTime:0});
      const read={address:settings.topUpAddress,abi:topUpAbi,blockNumber} as const;
      const [minimum,paid,paidTotal,usdc]=await Promise.all([publicClient.readContract({...read,functionName:'minimum'}),publicClient.readContract({...read,functionName:'paid',args:[address]}),publicClient.readContract({...read,functionName:'paidTotal'}),publicClient.readContract({...read,functionName:'usdc'})]);
      const [walletBalance,allowance]=await Promise.all([publicClient.readContract({address:usdc,abi:usdcAbi,functionName:'balanceOf',args:[address],blockNumber}),publicClient.readContract({address:usdc,abi:usdcAbi,functionName:'allowance',args:[address,settings.topUpAddress],blockNumber})]);
      return{minimum,paid,paidTotal,walletBalance,allowance,token:usdc};
    }),
    topUp: (input,assets) => guarded(async () => {
      const check=wallets.operation(),address=evmAddress(input),owner=address.toLowerCase();
      if(purchasing.has(owner))throw new DataError('purchase_pending','A purchase is already in progress.');
      purchasing.add(owner);
      try{
        const previous=await reconcilePurchase(input);check();
        if(previous){
          if(previous.status==='confirmed'&&previous.amount===String(assets))return{txHash:previous.hash!};
          if(previous.status==='reverted')throw new DataError('transaction_reverted','The previous purchase reverted. Review a fresh purchase.');
          throw new DataError('purchase_pending','Reconcile the previous purchase and review a new one; it will not be submitted again.');
        }
        if(assets<=0n)throw new DataError('amount','Enter an amount above zero.');
        const account=await result.topUpAccount(input);check();
        if(!account||!settings.topUpAddress)throw new DataError('topup_unavailable','Credit purchases are not configured.');
        if(assets<account.minimum)throw new DataError('amount','That is below the credit purchase minimum.');
        if(assets>account.walletBalance)throw new DataError('balance','That is more USDC than your wallet holds.');
        let client=await readyWallet(address,check);
        if(account.allowance<assets){check();await confirmed(await client.writeContract({address:account.token,abi:usdcAbi,functionName:'approve',args:[settings.topUpAddress,assets],account:address}));}
        client=await readyWallet(address,check);check();
        if(purchases.read(address))throw new DataError('purchase_pending','Another purchase was recorded while approval was pending. Reconcile it first.');
        purchases.write(address,{amount:String(assets),status:'submitting'});
        let hash:Hash;
        try{hash=await client.writeContract({address:settings.topUpAddress,abi:topUpAbi,functionName:'pay',args:[assets,address],account:address});}
        catch(error){
          if(['wallet_rejected','wallet_session_changed'].includes(dataError(error).code)){purchases.write(address,{amount:String(assets),status:'reverted'});}
          // Other wallet/RPC failures may have broadcast without returning a hash.
          throw error;
        }
        purchases.write(address,{amount:String(assets),hash,status:'pending'});
        try{const result=await confirmed(hash);purchases.write(address,{amount:String(assets),hash,status:'confirmed'});return result;}
        catch(error){
          if(dataError(error).code==='transaction_reverted'){purchases.write(address,{amount:String(assets),hash,status:'reverted'});throw error;}
          throw new DataError('purchase_pending',`Purchase ${hash} may have mined. Check its receipt; do not submit it again.`);
        }
      }finally{purchasing.delete(owner);}
    }),
    walletOptions: () => wallets.walletOptions(),
    connectWallet: id => guarded(async () => { const owner=await wallets.connectWallet(id); if(owner.kind==='evm') await readyWallet(owner.address); return owner; }),
    restoreSession: () => wallets.restoreSession(),
    disconnect: () => wallets.disconnect(),
    rheaDepositNear: (session, assets) => guarded(() => near.rheaDepositNear(session, assets)),
    rheaWithdrawNear: (session, assets) => guarded(() => near.rheaWithdrawNear(session, assets)),
    catalogue: session => guarded(async () => {
      const positions = session ? (session.kind === 'near' ? await nearOverview(session) : await result.overview(session)).vaults : [];
      const blockNumber = await publicClient.getBlockNumber({cacheTime:0});
      const list = await Promise.all(evmVaults.map(async (v):Promise<CatalogueVault> => {
        const [principal,cap] = await Promise.all(['totalSupply','depositCap'].map(functionName => publicClient.readContract({address:v.address,abi:vaultAbi,functionName:functionName as 'totalSupply'|'depositCap',blockNumber})));
        const own = positions.find(p=>p.kind===v.kind), unit = v.kind==='rate'?'ETH principal':v.kind==='pendle'?'USDC principal':'USDC', digits = v.kind==='rate'?4:2;
        const item:CatalogueVault = {id:caip10(v.address,chain.id),kind:v.kind,name:v.name,chainName:'Base',assetSymbol:v.symbol,...STRATEGIES[v.kind],lossNote:LOSS_NOTES[v.kind],wallets:['evm'],
          deposited:`${formatAmount(principal,v.decimals,digits)} ${unit}`,cap:`${formatAmount(cap,v.decimals,digits)} ${unit}`,status:principal>=cap?'paused':'open',
          ...(principal>=cap?{statusNote:'Deposit cap reached.'}:{}),
          ...(own?.usable!==false && own?{yourPrincipal:`${formatAmount(own.position.principal,v.decimals,6)} ${v.symbol}`,yourYield:`${formatAmount(own.position.yieldCredited,v.decimals,6)} ${v.symbol}`}:{})};
        if(v.kind==='aave' && settings.aavePoolAddress) {
          const asset = await publicClient.readContract({address:v.address,abi:vaultAbi,functionName:'asset',blockNumber});
          const reserve = await publicClient.readContract({address:settings.aavePoolAddress,abi:aavePoolAbi,functionName:'getReserveData',args:[asset],blockNumber});
          const ray=reserve.currentLiquidityRate;
          item.rateNow=`${ray*10000n/10n**27n/100n}.${String(ray*10000n/10n**27n%100n).padStart(2,'0')}% · Aave supply rate now, variable`;
        }
        return item;
      }));
      const own=positions.find(v=>v.kind==='rhea');
      const item:CatalogueVault={id:`near:mainnet:${settings.rheaVaultAccount}`,kind:'rhea',name:'Rhea USDC vault',chainName:'NEAR',assetSymbol:'USDC',...STRATEGIES.rhea,lossNote:LOSS_NOTES.rhea,wallets:['evm','near'],status:settings.rheaStatusNote?'paused':'open',
        ...(settings.rheaStatusNote?{statusNote:settings.rheaStatusNote}:{}),...(settings.rheaCap?{cap:`${formatAmount(amount(settings.rheaCap,'config'),6,2)} USDC`}:{}),
        ...(own?{yourPrincipal:`${formatAmount(own.position.principal,6,6)} USDC`,yourYield:`${formatAmount(own.position.yieldCredited,6,6)} USDC`}:{})};
      if(settings.rheaLendAccount) {
        const asset=await nearView<{supply_apr:string}>('get_asset',{token_id:settings.nearUsdcAccount},settings.rheaLendAccount);
        item.rateNow=`${decimalPercent(asset.supply_apr)} · Rhea supply rate now, variable`;
      }
      return [item,...list]; // the NEAR vault comes first
    }),
    connect: () => guarded(async () => {
      const session=await wallets.connectWallet('evm:injected');
      if(session.kind!=='evm') throw new DataError('wallet_kind','Use an EVM wallet.');
      await readyWallet(session.address);
      return session.address;
    }),
    overview: (input) => guarded(async () => {
      if(typeof input !== 'string' && input.kind==='near') return nearOverview(input);
      const address=evmAddress(input);
      // Use one Base block so the redemption preview refers to the shares displayed.
      const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
      const user = caip10(address, chain.id);
      const [vaults, credits, rheaPosition, coverage, busy, intentsBalance] = await Promise.all([
        Promise.all(evmVaults.map(async (vault): Promise<VaultAccount> => {
          const read = { address: vault.address, abi: vaultAbi, blockNumber } as const;
          const [shares, yieldCredited, asset, yieldToken] = await Promise.all([
            publicClient.readContract({ ...read, functionName: 'balanceOf', args: [address] }),
            publicClient.readContract({ ...read, functionName: 'yieldCredited', args: [address] }),
            publicClient.readContract({ ...read, functionName: 'asset' }),
            publicClient.readContract({ ...read, functionName: 'yieldToken' }),
          ]);
          const [principal, walletBalance, allowance] = await Promise.all([
            publicClient.readContract({ ...read, functionName: 'convertToAssets', args: [shares] }),
            publicClient.readContract({ address: asset, abi: usdcAbi, blockNumber, functionName: 'balanceOf', args: [address] }),
            publicClient.readContract({ address: asset, abi: usdcAbi, blockNumber, functionName: 'allowance', args: [address, vault.address] }),
          ]);
          return { id: caip10(vault.address, chain.id), kind: vault.kind, name: vault.name,
            chain: { id: `eip155:${chain.id}`, name: 'Base' }, asset: { address: asset, symbol: vault.symbol, decimals: vault.decimals },
            yieldToken: { address: yieldToken, symbol: vault.symbol, decimals: vault.decimals }, unitsLabel: vault.units,
            lossNote: LOSS_NOTES[vault.kind],
            ...(vault.kind === 'pendle' ? { buyUrl: settings.pendleAppUrl } : {}),
            position: { principal, shares, yieldCredited, walletBalance, allowance } };
        })),
        nearView<{ credited: string; spent: string; available: string; key_epoch: number }>('account', { user }),
        nearView<{ principal: string; yield_credited: string; pending_in: string; pending_out: string | null }>('position', { user }, settings.rheaVaultAccount),
        nearView<string>('coverage', {}, settings.rheaVaultAccount),
        nearView<boolean>('busy', {}, settings.rheaVaultAccount),
        nearView<string>('mt_balance_of', { account_id: address.toLowerCase(), token_id: `nep141:${settings.nearUsdcAccount}` }, settings.intentsAccount),
      ]);
      if (!Number.isSafeInteger(credits.key_epoch) || credits.key_epoch < 0 || typeof busy !== 'boolean')
        throw new DataError('near_rpc', 'NEAR returned invalid account state.');
      const rheaToken = { address: settings.nearUsdcAccount, symbol: 'USDC', decimals: 6 } as const;
      vaults.push({ id: `near:mainnet:${settings.rheaVaultAccount}`, kind: 'rhea', name: 'Rhea USDC vault', chain: { id: 'near:mainnet', name: 'NEAR' },
        asset: rheaToken, yieldToken: rheaToken, unitsLabel: 'USDC', lossNote: LOSS_NOTES.rhea,
        position: { principal: amount(rheaPosition.principal) * amount(coverage) / (10n ** 18n), shares: amount(rheaPosition.principal),
          yieldCredited: amount(rheaPosition.yield_credited), walletBalance: vaults[0].position.walletBalance, allowance: 0n,
          rhea: { pendingIn: amount(rheaPosition.pending_in), pendingOut: rheaPosition.pending_out === null ? null : amount(rheaPosition.pending_out),
            coverage: amount(coverage), busy, intentsBalance: amount(intentsBalance) } } });
      return { user, vaults, vault: { ...vaults[0].position, walletUsdc: vaults[0].position.walletBalance }, credits: {
        credited: amount(credits.credited), spent: amount(credits.spent), available: amount(credits.available), keyEpoch: credits.key_epoch,
      } };
    }),
    deposit: (input, assets, vaultId) => guarded(async () => {
      const check=wallets.operation(),address=evmAddress(input);
      if (assets <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      let client = await readyWallet(address,check);
      const selected = selectVault(vaultId);
      const usdc = await token(selected.address);
      const allowance = await publicClient.readContract({ address: usdc, abi: usdcAbi, functionName: 'allowance', args: [address, selected.address] });
      client=await readyWallet(address,check);check();
      if (allowance < assets) await confirmed(await client.writeContract({
        address: usdc, abi: usdcAbi, functionName: 'approve', args: [selected.address, assets], account: address,
      }));
      client=await readyWallet(address,check);check();
      return confirmed(await client.writeContract({
        address: selected.address, abi: vaultAbi, functionName: 'deposit', args: [assets, address], account: address,
      }));
    }),
    redeem: (input, shares, vaultId) => guarded(async () => {
      const check=wallets.operation(),address=evmAddress(input);
      if (shares <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      let client = await readyWallet(address,check);
      const selected = selectVault(vaultId);
      check();
      return confirmed(await client.writeContract({
        address: selected.address, abi: vaultAbi, functionName: 'redeem', args: [shares, address, address], account: address,
      }));
    }),
    rheaQuote: (input, assets, direction) => guarded(() => rheaReads.rheaQuote(evmAddress(input),assets,direction)),
    rheaDeposit: (input,assets) => guarded(() => rheaOperation().rheaDeposit(evmAddress(input),assets)),
    rheaWithdraw: (input,assets) => guarded(() => rheaOperation().rheaWithdraw(evmAddress(input),assets)),
    rheaExit: (input,assets) => guarded(() => rheaOperation().rheaExit(evmAddress(input),assets)),
    rheaStatus: (...args) => guarded(() => rheaReads.rheaStatus(...args)),
    walletProof,
    createKey: (proof) => guarded(async () => {
      const result = await relay<{ key: string; key_epoch: number; expires_at: number }>('/keys', proof);
      return { key: result.key, keyEpoch: result.key_epoch, expiresAt: new Date(result.expires_at * 1000).toISOString() };
    }),
    revokeAll: (proof) => guarded(async () => {
      const result = await relay<{ key_epoch: number; tx_hash: string }>('/keys/revoke', proof);
      return { keyEpoch: result.key_epoch, txHash: result.tx_hash };
    }),
    debitedAmount: (id) => guarded(async () => {
      const result = await nearView<string | null>('debited_amount', { inference_id: id });
      return result === null ? null : amount(result);
    }),
    models: chat.models,
    run: (request,onEvent) => guarded(() => chat.run(request,onEvent)),
    bridgeChains: bridge.bridgeChains,
    bridgeQuote: bridge.bridgeQuote,
  };
  return result;
}
