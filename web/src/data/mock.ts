// MOCK DATA. Simulates the vault, the connector and the relay in memory so the
// UI can be built before they are wired. Every screen shows a mock indicator
// while this module is in use. The mock keeps the real invariants: spending
// touches credits only, never principal, and never exceeds what is available.
import { caip10, config } from '../config.ts';
import { DataError } from './errors.ts';
import { expectedDebit, tokenCost } from './money.ts';
import { emptyPosition, evmAddress } from './session.ts';
import { STRATEGIES } from './catalogue.ts';
import { formatAmount } from './money.ts';
import { nearProofMessage, nearProofNonce } from './proof.ts';
import { LOSS_NOTES } from './types.ts';
import type {
  Address, Session, SessionInput, WalletProof, EvmWalletProof,
  Attestation,
  DashboardData,
  Model,
  Overview,
  Receipt,
  RunEvent,
  VaultAccount,
  RheaQuote,
  RheaDirection,
} from './types.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');

const base64url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const MOCK_ADDRESS: Address = '0x7a3fe91b0c25d4e8a6b13f07d2c9e58b4a1dc41e';

const MODELS: Model[] = [
  // NEAR AI's public model list, 2026-11-04: $0.08 / M input, $0.50 / M output.
  { id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3 Flash', inPriceNano: 80n, outPriceNano: 500n },
];

const MOCK_REPLY =
  'This is a mock reply. Once the dashboard is wired, the model’s answer appears here, ' +
  'decrypted in your browser with a key that never left it.';

export function createMockData(): DashboardData {
  const proofs = new Map<string, string>();
  const consume = (message: string) => {
    const user = proofs.get(message);
    if (!user) throw new DataError('wallet_proof', 'Sign a fresh single-use wallet proof.');
    proofs.delete(message);
    return user;
  };
  const chainId = config.vaultChainId || '8453'; // Explicit mock chain, never used by a live transaction.
  const base = { id: `eip155:${chainId}`, name: 'Base' };
  const tokens = [
    { address: '0x1111111111111111111111111111111111111111', symbol: 'USDC', decimals: 6 },
    { address: '0x2222222222222222222222222222222222222222', symbol: 'cbETH', decimals: 18 },
    { address: '0x3333333333333333333333333333333333333333', symbol: 'PT-deJAAA', decimals: 18 },
    { address: 'mock-usdc.near', symbol: 'USDC', decimals: 6 },
  ] as const;
  const principals = [1_000_000_000n, 250_000_000_000_000_000n, 100n * 10n ** 18n, 100_000_000n];
  const factors = [10n ** 18n, 1_143_299_420_807_401_681n, 997_201_215_082_272_248n, 10n ** 18n];
  const vaults: VaultAccount[] = tokens.map((asset, i) => ({
    id: i === 3 ? 'near:mainnet:mock-rhea.near' : `eip155:${chainId}:0x${String(i + 4).repeat(40)}`,
    kind: (['aave', 'rate', 'pendle', 'rhea'] as const)[i], name: ['Aave USDC vault', 'cbETH vault', 'Pendle PT-deJAAA vault', 'Rhea USDC vault'][i],
    chain: i === 3 ? { id: 'near:mainnet', name: 'NEAR' } : base,
    asset, yieldToken: asset, unitsLabel: ['USDC', 'ETH wei', 'USDC-scaled18', 'USDC'][i],
    lossNote: LOSS_NOTES[(['aave', 'rate', 'pendle', 'rhea'] as const)[i]],
    ...(i === 2 ? { buyUrl: config.pendleAppUrl } : {}),
    position: { principal: principals[i], shares: principals[i] * factors[i] / (10n ** 18n),
      yieldCredited: [4_213_870n, 1_000_000_000_000_000n, 2n * 10n ** 18n, 110_000n][i],
      walletBalance: [2_450_000_000n, 1_250_000_000_000_000_000n, 50n * 10n ** 18n, 2_450_000_000n][i], allowance: 0n,
      ...(i === 3 ? { rhea: { pendingIn: 0n, pendingOut: null, coverage: 10n ** 18n, busy: false, intentsBalance: 0n } } : {}) },
  }));
  const state = { credited: 4_020_000n, spent: 342_118n, keyEpoch: 2, debited: new Map<string, bigint>() };
  const rhea = vaults[3].position;
  const initialNearPosition = structuredClone(rhea);
  const swaps = new Map<string, () => void>();
  const select = (id?: string) => {
    const index = id === undefined ? 0 : vaults.findIndex(vault => vault.id === id && vault.kind !== 'rhea');
    if (index < 0) throw new DataError('vault', 'Choose an EVM vault; Rhea uses its bridge and signed withdrawal methods.');
    return index;
  };
  const positive = (assets: bigint) => { if (assets <= 0n) throw new DataError('amount', 'Enter an amount above zero.'); };
  const quote = (assets: bigint, direction: RheaDirection, dry = true): RheaQuote => {
    positive(assets);
    const fee = assets / 1000n + 20_000n;
    const out = assets > fee ? assets - fee : 0n;
    return { direction, dry, isMock: true, amountIn: assets, amountOut: out, minAmountOut: out * 99n / 100n,
      etaSeconds: 45, deadline: new Date(Date.now() + 600_000).toISOString(),
      ...(!dry ? { depositAddress: direction === 'deposit' ? `0x${hex(20)}` : `mock-${hex(8)}.near` } : {}) };
  };
  const overview = (address: Address): Overview => {
    // One synthetic keeper cycle on refresh settles a mock withdrawal request.
    if (rhea.rhea!.pendingOut !== null) {
      const claim = rhea.rhea!.pendingOut;
      rhea.shares -= claim; rhea.principal = rhea.shares * rhea.rhea!.coverage / (10n ** 18n);
      rhea.rhea!.intentsBalance += claim * rhea.rhea!.coverage / (10n ** 18n); rhea.rhea!.pendingOut = null;
    }
    rhea.walletBalance = vaults[0].position.walletBalance;
    return { user: caip10(address, chainId), vaults: structuredClone(vaults),
      vault: { ...vaults[0].position, walletUsdc: vaults[0].position.walletBalance },
      credits: { credited: state.credited, spent: state.spent, available: state.credited - state.spent, keyEpoch: state.keyEpoch } };
  };

  const purchases=new Map<string,bigint>();
  let purchased=0n;
  let session: Session | null = null;
  const nearAccounts = new Map<string, {position:typeof rhea;credited:bigint;spent:bigint;keyEpoch:number;debited:Map<string,bigint>}>();
  const nearAccount = (id:string) => {
    let account = nearAccounts.get(id);
    if(!account) { account={position:structuredClone(initialNearPosition),credited:4_020_000n,spent:342_118n,keyEpoch:2,debited:new Map()}; account.position.rhea!.usdcRegistered=true; nearAccounts.set(id,account); }
    return account;
  };
  const nearOverview = (owner:Extract<Session,{kind:'near'}>):Overview => {
    const record=nearAccount(owner.accountId), position=record.position;
    if(position.rhea!.pendingOut!==null) {
      const claim=position.rhea!.pendingOut; position.shares-=claim; position.principal=position.shares*position.rhea!.coverage/10n**18n;
      position.walletBalance+=claim*position.rhea!.coverage/10n**18n; position.rhea!.pendingOut=null;
    }
    const result:Overview={user:`near:mainnet:${owner.accountId}`,vaults:vaults.map(v=>({...structuredClone(v),usable:v.kind==='rhea',position:v.kind==='rhea'?structuredClone(position):emptyPosition()})),
      vault:{...emptyPosition(),walletUsdc:0n},credits:{credited:record.credited,spent:record.spent,available:record.credited-record.spent,keyEpoch:record.keyEpoch}};
    const queued=position.rhea!.pendingIn;
    if(queued>0n) {position.shares+=queued;position.principal+=queued;position.rhea!.pendingIn=0n;}
    return result;
  };
  async function walletProof(address:Address):Promise<EvmWalletProof>;
  async function walletProof(owner:Session):Promise<WalletProof>;
  async function walletProof(input:SessionInput):Promise<WalletProof> {
    if(typeof input!=='string' && input.kind==='near') {
      const nonce=hex(24), message=nearProofMessage(nonce,input.accountId);
      proofs.set(message,`near:mainnet:${input.accountId}`);
      return {near:{account_id:input.accountId,public_key:'ed25519:mock-public-key',signature:'mock-signature',message,
        nonce:btoa(String.fromCharCode(...await nearProofNonce(nonce))),recipient:'mock.invalid'}};
    }
    const address=evmAddress(input), origin=new URL(config.relayUrl || globalThis.location?.origin || 'https://mock.invalid');
    const message=[`${origin.host} wants you to sign in with your Ethereum account:`,address,'','Authorize one InferNear API key action.','',`URI: ${origin.origin}`,'Version: 1',
      `Chain ID: ${caip10(address).split(':')[1]}`,`Nonce: ${hex(8)}`,`Issued At: ${new Date().toISOString()}`,`Expiration Time: ${new Date(Date.now()+300_000).toISOString()}`].join('\n');
    proofs.set(message,caip10(address));return {message,signature:`0x${hex(65)}`};
  }

  const result:DashboardData = {
    isMock: true,
    isRunMock: true,
    async topUpAccount(input) {
      if(!config.topUpAddress || (typeof input!=='string' && input.kind!=='evm')) return null;
      return {minimum:1_000_000n,paid:purchases.get(evmAddress(input).toLowerCase())??0n,paidTotal:purchased,walletBalance:vaults[0].position.walletBalance,allowance:0n,token:tokens[0].address};
    },
    async topUp(input,assets) {
      const owner=evmAddress(input).toLowerCase();if(!config.topUpAddress)throw new DataError('topup_unavailable','Credit purchases are not configured.');
      if(assets<1_000_000n)throw new DataError('amount','The minimum mock purchase is 1 USDC.');
      if(assets>vaults[0].position.walletBalance)throw new DataError('balance','That is more USDC than the wallet holds.');
      vaults[0].position.walletBalance-=assets;purchased+=assets;purchases.set(owner,(purchases.get(owner)??0n)+assets);state.credited+=assets;return{txHash:`mock-topup-${hex(16)}`};
    },

    async walletOptions() { return [{id:'evm:mock',kind:'evm',name:'Mock EVM wallet',available:true},{id:'near:meteor-wallet',kind:'near',name:'Mock Meteor Wallet',available:true},{id:'near:my-near-wallet',kind:'near',name:'Mock MyNearWallet',available:true}]; },
    async connectWallet(id) {
      if(id==='evm:mock') return session={kind:'evm',address:MOCK_ADDRESS,user:caip10(MOCK_ADDRESS,chainId)};
      if(id==='near:meteor-wallet') return session={kind:'near',accountId:'demo.near',user:'near:mainnet:demo.near'};
      throw new DataError('wallet_missing','Unknown mock wallet.');
    },
    async restoreSession() { return session; },
    async disconnect() {session=null;},
    async catalogue(owner) {
      const own=owner?(await result.overview(owner)).vaults:[];
      // The NEAR vault comes first, as in the live catalogue.
      return [...vaults].sort((a,b)=>Number(b.kind==='rhea')-Number(a.kind==='rhea')).map(v=>({id:v.id,kind:v.kind,name:v.name,chainName:v.kind==='rhea'?'NEAR':'Base',assetSymbol:v.asset.symbol,...STRATEGIES[v.kind],lossNote:v.lossNote,
        wallets:v.kind==='rhea'?['evm','near']:['evm'],deposited:`${formatAmount(v.position.shares,v.asset.decimals,2)} mock principal`,cap:`10,000 mock units`,
        status:v.kind==='rhea' && config.rheaStatusNote?'paused':'open',statusNote:v.kind==='rhea' && config.rheaStatusNote?config.rheaStatusNote:'Mock catalogue — simulated chain state.',
        ...(own.find(p=>p.kind===v.kind)?.usable!==false && owner?{yourPrincipal:`${formatAmount(own.find(p=>p.kind===v.kind)!.position.principal,v.asset.decimals,6)} ${v.asset.symbol}`,yourYield:`${formatAmount(own.find(p=>p.kind===v.kind)!.position.yieldCredited,v.asset.decimals,6)} ${v.yieldToken.symbol}`}:{})}));
    },
    async rheaDepositNear(owner,assets) {
      if(owner.kind!=='near') throw new DataError('wallet_kind','Use a NEAR wallet.');
      if(assets<1_000_000n) throw new DataError('amount','The minimum Rhea deposit is 1 USDC.');
      const position=nearAccount(owner.accountId).position;
      if(assets>position.walletBalance) throw new DataError('balance','That is more USDC than the wallet holds.');
      position.walletBalance-=assets; position.rhea!.pendingIn+=assets; return {txHash:`mock-near-${hex(16)}`};
    },
    async rheaWithdrawNear(owner,assets) {
      if(owner.kind!=='near') throw new DataError('wallet_kind','Use a NEAR wallet.');
      positive(assets);const position=nearAccount(owner.accountId).position;
      if(assets>position.shares) throw new DataError('balance','That is more than your principal claim.');
      position.rhea!.pendingOut=assets;return {txHash:`mock-near-${hex(16)}`};
    },
    async connect() {
      await sleep(500);
      return MOCK_ADDRESS;
    },

    async overview(input) {
      if(typeof input!=='string' && input.kind==='near') return nearOverview(input);
      const address=evmAddress(input);
      await sleep(250);
      const queued = rhea.rhea!.pendingIn;
      const result = overview(address);
      if (queued > 0n) { rhea.rhea!.pendingIn = 0n; rhea.shares += queued; rhea.principal += queued; }
      return result;
    },

    async deposit(input, assets, vaultId) {
      evmAddress(input);
      positive(assets); const index = select(vaultId), position = vaults[index].position;
      if (assets > position.walletBalance) throw new DataError('balance', 'That is more than the wallet holds.');
      await sleep(900); position.walletBalance -= assets;
      position.shares += assets * factors[index] / (10n ** 18n);
      position.principal = position.shares * (10n ** 18n) / factors[index];
      return { txHash: `0x${hex(32)}` };
    },
    async redeem(input, shares, vaultId) {
      evmAddress(input);
      positive(shares); const index = select(vaultId), position = vaults[index].position;
      if (shares > position.shares) throw new DataError('balance', 'That is more than your principal.');
      await sleep(900); position.shares -= shares;
      position.walletBalance += shares * (10n ** 18n) / factors[index];
      position.principal = position.shares * (10n ** 18n) / factors[index];
      return { txHash: `0x${hex(32)}` };
    },
    async rheaQuote(input, assets, direction) { evmAddress(input); return quote(assets, direction); },
    async rheaDeposit(input, assets) {
      evmAddress(input);
      positive(assets);
      if (assets > vaults[0].position.walletBalance) throw new DataError('balance', 'That is more USDC than the wallet holds.');
      const funded = quote(assets, 'deposit', false);
      vaults[0].position.walletBalance -= assets;
      // Delivered by 1Click → queued in the vault; the next overview stands in for the vault's next cycle.
      swaps.set(funded.depositAddress!, () => { rhea.rhea!.pendingIn += funded.amountOut; });
      return { txHash: `0x${hex(32)}`, quote: funded };
    },
    async rheaWithdraw(input, claim) {
      evmAddress(input);
      positive(claim);
      if (claim > rhea.shares) throw new DataError('balance', 'That is more than your principal claim.');
      rhea.rhea!.pendingOut = claim;
      return { txHash: `mock-near-${hex(16)}` };
    },
    async rheaExit(input, assets) {
      evmAddress(input);
      positive(assets);
      if (assets > rhea.rhea!.intentsBalance) throw new DataError('balance', 'Wait for USDC to reach your Intents balance.');
      const funded = quote(assets, 'withdraw', false); rhea.rhea!.intentsBalance -= assets;
      swaps.set(funded.depositAddress!, () => { vaults[0].position.walletBalance += funded.amountOut; });
      return { txHash: `mock-near-${hex(16)}`, quote: funded };
    },
    async rheaStatus(depositAddress) {
      const complete = swaps.get(depositAddress);
      if (complete) { complete(); swaps.delete(depositAddress); }
      return { status: 'SUCCESS', terminal: true, isMock: true };
    },

    walletProof,

    async createKey(proof) {
      const user = consume('near' in proof?proof.near.message:proof.message);
      const account=user.startsWith('near:mainnet:')?nearAccount(user.slice(13)):state;
      await sleep(600);
      const exp = Math.floor(Date.now() / 1000) + 30 * 86_400;
      const payload = base64url(JSON.stringify({ user, epoch: account.keyEpoch, exp }));
      return {
        key: `inf_${payload}.${hex(32)}`,
        keyEpoch: account.keyEpoch,
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    },

    async revokeAll(proof) {
      const user=consume('near' in proof?proof.near.message:proof.message);
      const account=user.startsWith('near:mainnet:')?nearAccount(user.slice(13)):state;
      await sleep(1100);
      account.keyEpoch += 1;
      return { keyEpoch: account.keyEpoch, txHash: hex(32) };
    },

    async models() {
      return MODELS;
    },

    async run({ key, model, prompt, maxTokens }, onEvent: (event: RunEvent) => void) {
      let activeUser='';
      try { activeUser=JSON.parse(atob(key.slice(4).split('.')[0].replace(/-/g,'+').replace(/_/g,'/'))).user; } catch { /* Fixture-only legacy keys have no payload. */ }
      const activeState=activeUser.startsWith('near:mainnet:')?nearAccount(activeUser.slice(13)):state;
      if (!key.startsWith('inf_')) throw new DataError('key', 'Create an API key first.');
      const inputBound = BigInt(Math.ceil(new TextEncoder().encode(prompt).length * 2));
      const reservation = tokenCost(Number(inputBound), maxTokens, model.inPriceNano, model.outPriceNano);
      if (activeState.credited - activeState.spent < reservation)
        throw new DataError('credits', 'Not enough credits for this request (402).');

      await sleep(700);
      const attestation: Attestation = {
        model: model.id,
        nonce: hex(32),
        tcbStatus: 'UpToDate',
        gpuEvidence: 'verified',
        deploymentProvenance: 'verified',
        modelSigningKey: hex(32),
        verifiedAt: Date.now(),
      };
      onEvent({ kind: 'attested', attestation });

      await sleep(500);
      onEvent({ kind: 'encrypted', ciphertext: hex(32 + 24 + prompt.length + 16) });

      await sleep(600);
      for (const word of MOCK_REPLY.split(/(?<= )/)) {
        await sleep(35);
        onEvent({ kind: 'text', delta: word });
      }

      const receipt: Receipt = {
        inferenceId: crypto.randomUUID(),
        chatId: `chatcmpl-${hex(12)}`,
        model: model.id,
        promptTokens: 9 + Math.ceil(prompt.length / 4),
        completionTokens: Math.ceil(MOCK_REPLY.length / 4),
        inPriceNano: model.inPriceNano,
        outPriceNano: model.outPriceNano,
        source: 'signed_usage',
      };
      const charged = expectedDebit(receipt, reservation);
      activeState.spent += charged;
      activeState.debited.set(receipt.inferenceId, charged);

      return {
        text: MOCK_REPLY,
        completionId: receipt.chatId,
        attestation,
        reply: { signatureKind: 'provider_tee', signer: `0x${hex(20)}` },
        receipt,
        reservation,
        simulatedDebit: charged,
      };
    },

    async debitedAmount(inferenceId) {
      await sleep(400);
      return state.debited.get(inferenceId) ?? [...nearAccounts.values()].map(account=>account.debited.get(inferenceId)).find(value=>value!==undefined) ?? null;
    },

    async bridgeChains() {
      return [
        { id: '1', name: 'Ethereum' },
        { id: '42161', name: 'Arbitrum' },
        { id: '10', name: 'Optimism' },
        { id: '137', name: 'Polygon' },
      ];
    },

    async bridgeQuote(fromChain, amount, recipient) {
      if (amount <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      await sleep(800);
      const fee = amount / 1000n + 20_000n;
      return {
        fromChain,
        amountIn: amount,
        amountOut: amount > fee ? amount - fee : 0n,
        recipient,
        etaSeconds: 45,
        dry: true,
        isMock: true,
      };
    },
  };
  return result;
}
