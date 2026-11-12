// Offline fixtures: no wallet, transaction, relay or chain network is contacted.
import assert from 'node:assert/strict';
import { walletProofMessage } from './proof.ts';
import { test } from 'node:test';
import { base58 } from '@scure/base';
import { decodeFunctionData, encodeFunctionResult, getAddress, hexToString, hexToBytes, type EIP1193Provider, type Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { caip10, config, liveConfig, type LiveConfig } from '../config.ts';
import { vaultAbi, usdcAbi } from './abi.ts';
import { createLiveData } from './live.ts';
import { DataError } from './errors.ts';
import type { Address } from './types.ts';

const ADDRESS = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as Address;
const VAULT = '0x2222222222222222222222222222222222222222' as Address;
const USDC = '0x3333333333333333333333333333333333333333' as Address;
const CBETH = '0x6666666666666666666666666666666666666666' as Address;
const PT = '0x8888888888888888888888888888888888888888' as Address;
const SIGNATURE = `0x${'ab'.repeat(64)}1b` as Hex;
const settings: LiveConfig = {
  relayUrl: 'https://relay.example:9443', vaultChainId: 8453, vaultAddress: VAULT,
  baseRpcUrl: 'https://base.example', nearRpcUrl: 'https://near.example', connectorAccount: 'connector.near',
  rateVaultAddress: '0x4444444444444444444444444444444444444444', pendleVaultAddress: '0x5555555555555555555555555555555555555555',
  rheaVaultAccount: 'vault.near', nearUsdcAccount: 'usdc.near', intentsAccount: 'intents.near',
  oneClickUrl: 'https://oneclick.example', baseUsdcAssetId: 'nep141:base-usdc.omft.near', slippageBps: 100,
  pendleAppUrl: 'https://pendle.example/pt-dejaaa',
};
const huge = 9_007_199_254_740_993n;

type RpcCall = { method: string; params?: unknown[] };
function fixture() {
  const requests: { url: string; body: Record<string, unknown>; headers?: HeadersInit }[] = [];
  const walletCalls: RpcCall[] = [];
  const transactions: { to: Address; data: Hex }[] = [];
  const receiptsRead: string[] = [];
  const state = {
    chainId: 1, selected: ADDRESS, rejected: false, allowance: 0n,
    shares: huge, assets: huge - 3n, wallet: huge * 2n, spent: huge, credited: huge + 99n,
    nonceNear: 8, coverage: '900000000000000000', busy: false, pendingIn: '2000000', pendingOut: '1000000' as string | null,
    quoteMismatch: false, missingFunding: false, wrongAmount: false, quoteStatus: 201, expiredQuote: false, minOut: '4900000',
    swapStatus: 'PROCESSING',
    reverted: false, failNear: false, malformedAmount: false, failNetwork: false,
    relayStatus: 200, relayCode: 'invalid_api_key', nonce: 0, debit: '9007199254740993' as string | null,
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const fetcher: typeof fetch = async (input, init) => {
    if (state.failNetwork) throw new TypeError('Fixture network unavailable');
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url, body, headers: init?.headers });
    if (url.startsWith(settings.baseRpcUrl)) {
      let result: unknown;
      if (body.method === 'eth_blockNumber') result = '0x64';
      else if (body.method === 'eth_getTransactionReceipt') {
        receiptsRead.push(body.params[0]);
        result = {
          transactionHash: body.params[0], transactionIndex: '0x0', blockHash: `0x${'44'.repeat(32)}`,
          blockNumber: '0x64', from: ADDRESS, to: transactions.at(-1)?.to ?? VAULT,
          cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [],
          logsBloom: `0x${'00'.repeat(256)}`, status: state.reverted ? '0x0' : '0x1', type: '0x2', contractAddress: null,
        };
      } else if (body.method === 'eth_call') {
        const call = body.params[0];
        const isVault = [VAULT, settings.rateVaultAddress, settings.pendleVaultAddress].includes(call.to.toLowerCase());
        const abi = isVault ? vaultAbi : usdcAbi;
        const decoded = decodeFunctionData({ abi, data: call.data });
        const asset = call.to.toLowerCase() === settings.rateVaultAddress ? CBETH : call.to.toLowerCase() === settings.pendleVaultAddress ? PT : USDC;
        const value = decoded.functionName === 'asset' || decoded.functionName === 'yieldToken' ? asset
          : decoded.functionName === 'convertToAssets' ? state.assets
          : decoded.functionName === 'yieldCredited' ? 42n
          : decoded.functionName === 'allowance' ? state.allowance
          : isVault ? state.shares : state.wallet;
        result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: value } as Parameters<typeof encodeFunctionResult>[0]);
      } else throw new Error(`Unexpected Base RPC ${body.method}`);
      return json({ jsonrpc: '2.0', id: body.id, result });
    }
    if (url === settings.nearRpcUrl) {
      if (state.failNear) return json({ error: { message: 'Fixture connector unavailable' } });
      const values: Record<string, unknown> = {
        account: { credited: state.malformedAmount ? Number(state.credited) : String(state.credited), spent: String(state.spent), available: '99', key_epoch: 7 },
        position: { principal: '100000000', yield_credited: '333333', pending_in: state.pendingIn, pending_out: state.pendingOut },
        coverage: state.coverage, busy: state.busy, nonce: state.nonceNear, mt_balance_of: '5000000', debited_amount: state.debit,
      };
      const result = values[body.params.method_name];
      return json({ jsonrpc: '2.0', id: body.id, result: { result: [...new TextEncoder().encode(JSON.stringify(result))] } });
    }
    if (url.startsWith(settings.oneClickUrl)) {
      if (state.quoteStatus !== 201) return json({ message: 'Fixture route unavailable' }, state.quoteStatus);
      if (url.includes('/v0/status?')) return json({ status: state.swapStatus });
      return json({ quoteRequest: { ...body, ...(state.quoteMismatch ? { recipient: 'attacker.near' } : {}) }, quote: {
        amountIn: state.wrongAmount ? '1' : body.amount, amountOut: String(BigInt(body.amount as string) - 1000n), minAmountOut: state.minOut, timeEstimate: 35,
        ...(state.expiredQuote ? { deadline: '2020-01-01T00:00:00Z' } : {}),
        ...(!body.dry && !state.missingFunding ? { depositAddress: body.depositType === 'INTENTS' ? 'quote.near' : '0x7777777777777777777777777777777777777777' } : {}),
      } }, 201);
    }
    if (state.relayStatus !== 200) return json({ error: { code: state.relayCode, message: 'Fixture relay rejection' } }, state.relayStatus);
    if (url.endsWith('/rhea/withdraw') || url.endsWith('/intents/execute')) return json({ tx_hash: 'fixture-relay-near-tx' });
    if (url.endsWith('/auth/nonce')) return json({ nonce: `fixtureNonce${++state.nonce}` });
    if (url.endsWith('/keys/revoke')) return json({ key_epoch: 8, tx_hash: 'fixture-near-tx' });
    if (url.endsWith('/keys')) return json({ key: 'inf_fixture.signature', key_epoch: 7, expires_at: 1_800_000_000 });
    throw new Error(`Unexpected fixture URL ${url}`);
  };
  const provider = { request: async ({ method, params }: RpcCall) => {
    walletCalls.push({ method, params });
    if (state.rejected) throw { code: 4001, message: 'User rejected fixture request' };
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [state.selected];
    if (method === 'eth_chainId') return `0x${state.chainId.toString(16)}`;
    if (method === 'wallet_switchEthereumChain') {
      state.chainId = Number((params?.[0] as { chainId: string }).chainId);
      return null;
    }
    if (method === 'personal_sign') return SIGNATURE;
    if (method === 'eth_sendTransaction') {
      const tx = params?.[0] as { to: Address; data: Hex };
      transactions.push(tx);
      return `0x${String(transactions.length).padStart(64, '0')}`;
    }
    throw new Error(`Unexpected wallet method ${method}`);
  } } as unknown as Pick<EIP1193Provider, 'request'>;
  const data = createLiveData(settings, { ethereum: provider, fetch: fetcher, now: () => new Date('2026-11-04T12:00:00Z') });
  return { state, data, requests, walletCalls, transactions, receiptsRead, fetcher };
}

const rejectsCode = (code: string) => (error: unknown) => error instanceof DataError && error.code === code;

test('live selection requires every public endpoint and CAIP-10 lower-cases addresses', () => {
  const values = { ...settings, vaultChainId: String(settings.vaultChainId), slippageBps: String(settings.slippageBps) };
  assert.equal(liveConfig(values)?.vaultChainId, 8453);
  for (const key of Object.keys(values) as (keyof typeof values)[]) assert.equal(liveConfig({ ...values, [key]: '' }), null);
  assert.equal(caip10(ADDRESS, 8453), `eip155:8453:${ADDRESS.toLowerCase()}`);
});
test('connect requests injected accounts and switches to the env chain', async () => {
  const f = fixture();
  assert.equal(await f.data.connect(), ADDRESS.toLowerCase());
  assert.equal(f.state.chainId, settings.vaultChainId);
  assert(f.walletCalls.some(c => c.method === 'wallet_switchEthereumChain'));
  assert.equal(f.data.isMock, false);
  assert.equal(f.data.isRunMock, true);
});
test('overview preserves bigint amounts and reads redemption assets rather than assuming 1:1', async () => {
  const f = fixture();
  const overview = await f.data.overview(ADDRESS);
  assert.equal(overview.vault.shares, huge);
  assert.equal(overview.vault.principal, huge - 3n);
  assert.equal(overview.vault.walletUsdc, huge * 2n);
  assert.equal(overview.vault.allowance, 0n);
  assert.equal(overview.credits.credited, huge + 99n);
  assert.equal(overview.credits.spent, huge);
  assert.equal(overview.credits.available, 99n);
  assert.equal(overview.credits.keyEpoch, 7);
  const near = f.requests.find(r => r.url === settings.nearRpcUrl)!.body;
  assert.equal(near.method, 'query');
  const params = near.params as { request_type: string; finality: string; account_id: string; args_base64: string };
  assert.equal(params.request_type, 'call_function');
  assert.equal(params.finality, 'final');
  assert.equal(params.account_id, 'connector.near');
  assert.deepEqual(JSON.parse(atob(params.args_base64)), { user: `eip155:8453:${ADDRESS.toLowerCase()}` });
  for (const r of f.requests.filter(r => r.body.method === 'eth_call')) assert.equal((r.body.params as unknown[])[1], '0x64');
});
test('NEAR debited_amount handles U128 strings and null without a wallet', async () => {
  const f = fixture();
  assert.equal(await f.data.debitedAmount('id-1'), huge);
  f.state.debit = null;
  assert.equal(await f.data.debitedAmount('id-2'), null);
  assert.deepEqual(f.walletCalls, []);
});
test('invalid numeric NEAR amounts are rejected instead of silently losing precision', async () => {
  const f = fixture(); f.state.malformedAmount = true;
  await assert.rejects(f.data.overview(ADDRESS), rejectsCode('near_rpc'));
});
test('deposit confirms an exact approval before sending the deposit', async () => {
  const f = fixture();
  const result = await f.data.deposit(ADDRESS, huge);
  assert.equal(f.transactions.length, 2);
  const approval = decodeFunctionData({ abi: usdcAbi, data: f.transactions[0].data });
  assert.equal(approval.functionName, 'approve');
  assert.deepEqual(approval.args, [getAddress(VAULT), huge]);
  const deposit = decodeFunctionData({ abi: vaultAbi, data: f.transactions[1].data });
  assert.equal(deposit.functionName, 'deposit');
  assert.deepEqual(deposit.args, [huge, getAddress(ADDRESS)]);
  assert.equal(f.receiptsRead.length, 2);
  assert.equal(result.txHash, `0x${'2'.padStart(64, '0')}`);
});
test('sufficient allowance skips approval; a reverted approval never sends a deposit', async () => {
  const f = fixture(); f.state.allowance = huge;
  await f.data.deposit(ADDRESS, huge);
  assert.equal(f.transactions.length, 1);
  assert.equal(decodeFunctionData({ abi: vaultAbi, data: f.transactions[0].data }).functionName, 'deposit');
  const failed = fixture(); failed.state.reverted = true;
  await assert.rejects(failed.data.deposit(ADDRESS, huge), rejectsCode('transaction_reverted'));
  assert.equal(failed.transactions.length, 1);
});
test('redeem encodes bigint shares and uses the owner as receiver, without approval', async () => {
  const f = fixture(); await f.data.redeem(ADDRESS, huge);
  const redeem = decodeFunctionData({ abi: vaultAbi, data: f.transactions[0].data });
  assert.equal(redeem.functionName, 'redeem');
  assert.deepEqual(redeem.args, [huge, getAddress(ADDRESS), getAddress(ADDRESS)]);
  assert.equal(f.receiptsRead.length, 1);
});
test('wallet proof names the site that asks for the signature, so wallets see a matching domain', () => {
  const parsed = parseSiweMessage(walletProofMessage(ADDRESS, 'fixtureNonce1', 'https://app.example', 8453));
  assert.equal(parsed.domain, 'app.example'); assert.equal(parsed.uri, 'https://app.example');
});
test('wallet proof binds to relay host/origin, chain, nonce, issued-at and expiration', async () => {
  const f = fixture(); const proof = await f.data.walletProof(ADDRESS);
  const parsed = parseSiweMessage(proof.message);
  assert.equal(parsed.domain, 'relay.example:9443');
  assert.equal(parsed.uri, settings.relayUrl);
  assert.equal(parsed.chainId, 8453);
  assert.equal(parsed.address?.toLowerCase(), ADDRESS.toLowerCase());
  assert.equal(parsed.nonce, 'fixtureNonce1');
  assert.equal(parsed.issuedAt?.toISOString(), '2026-11-04T12:00:00.000Z');
  assert.equal(parsed.expirationTime?.toISOString(), '2026-11-04T12:05:00.000Z');
  const sign = f.walletCalls.find(c => c.method === 'personal_sign')!;
  assert.equal(hexToString(sign.params![0] as Hex), proof.message);
  assert.equal(proof.signature, SIGNATURE);
});
test('key actions POST only fresh message/signature proofs, with no session or bearer auth', async () => {
  const f = fixture();
  const issueProof = await f.data.walletProof(ADDRESS);
  const key = await f.data.createKey(issueProof);
  const revokeProof = await f.data.walletProof(ADDRESS);
  const revoke = await f.data.revokeAll(revokeProof);
  assert.notEqual(issueProof.message, revokeProof.message);
  assert.deepEqual(key, { key: 'inf_fixture.signature', keyEpoch: 7, expiresAt: new Date(1_800_000_000_000).toISOString() });
  assert.deepEqual(revoke, { keyEpoch: 8, txHash: 'fixture-near-tx' });
  const posts = f.requests.filter(r => r.url.endsWith('/keys') || r.url.endsWith('/keys/revoke'));
  assert.deepEqual(posts.map(p => p.body), [issueProof, revokeProof]);
  for (const post of posts) assert.equal(new Headers(post.headers).get('authorization'), null);
});
test('relay errors retain their code and message', async () => {
  const f = fixture(); f.state.relayStatus = 401;
  await assert.rejects(f.data.walletProof(ADDRESS), error => rejectsCode('invalid_api_key')(error) && (error as Error).message === 'Fixture relay rejection');
});
test('wallet rejection, account changes, invalid amounts and RPC errors map to DataError', async () => {
  const f = fixture(); f.state.rejected = true;
  await assert.rejects(f.data.connect(), rejectsCode('wallet_rejected'));
  f.state.rejected = false; f.state.selected = VAULT;
  await assert.rejects(f.data.redeem(ADDRESS, 1n), rejectsCode('wallet_account'));
  await assert.rejects(f.data.deposit(ADDRESS, 0n), rejectsCode('amount'));
  await assert.rejects(f.data.redeem(ADDRESS, -1n), rejectsCode('amount'));
  f.state.failNear = true;
  await assert.rejects(f.data.debitedAmount('id'), rejectsCode('near_rpc'));
  f.state.failNear = false; f.state.failNetwork = true;
  await assert.rejects(f.data.debitedAmount('id'), rejectsCode('rpc'));
});
test('missing injected wallet produces a named error without falling back to a mock', async () => {
  const f = fixture();
  const data = createLiveData(settings, { fetch: f.fetcher });
  await assert.rejects(data.connect(), rejectsCode('wallet_missing'));
  assert.equal(data.isMock, false);
});

test('Try the API stays simulated even when wallet, chain and key routes are live', async () => {
  const f = fixture();
  const before = await f.data.overview(ADDRESS);
  const count = f.requests.length;
  const models = await f.data.models();
  const events: string[] = [];
  const result = await f.data.run({ key: 'inf_fixture', model: models[0], prompt: 'fixture prompt', maxTokens: 32 }, event => events.push(event.kind));
  assert.equal(f.requests.length, count, 'simulated inference must not contact a chain or relay');
  assert.equal(f.walletCalls.length, 0);
  assert.match(result.text, /mock reply/);
  assert(result.simulatedDebit !== undefined && result.simulatedDebit <= result.reservation);
  assert.equal(result.receipt.source, 'signed_usage');
  assert.equal(typeof result.receipt.promptTokens, 'number');
  assert(events.includes('attested') && events.includes('encrypted') && events.includes('text'));
  assert.deepEqual(await f.data.overview(ADDRESS), before, 'a mock run must not debit live credits or principal');
});


test('the exported data factory selects the labelled fallback or live implementation from config', async () => {
  const fallback = await import('./index.ts');
  assert.equal(fallback.data.isMock, true);
  const saved = { ...config };
  try {
    Object.assign(config, { ...settings, vaultChainId: String(settings.vaultChainId), slippageBps: String(settings.slippageBps) });
    const selectedModule = './index.ts?configured-live-test';
    const selected = await import(selectedModule);
    assert.equal(selected.data.isMock, false);
    assert.equal(selected.data.isRunMock, true);
  } finally { Object.assign(config, saved); }
});

test('the mock consumes one wallet proof per key action and issues no session', async () => {
  const { createMockData } = await import('./mock.ts');
  const saved = { ...config };
  try {
    config.relayUrl = settings.relayUrl;
    config.vaultChainId = String(settings.vaultChainId);
    const data = createMockData();
    const proof = await data.walletProof(ADDRESS);
    assert(parseSiweMessage(proof.message).expirationTime);
    const key = await data.createKey(proof);
    assert.match(key.key, /^inf_/);
    await assert.rejects(data.revokeAll(proof), rejectsCode('wallet_proof'));
    const fresh = await data.walletProof(ADDRESS);
    assert.notEqual(fresh.message, proof.message);
    const revoked = await data.revokeAll(fresh);
    assert.equal(revoked.keyEpoch, key.keyEpoch + 1);
  } finally { Object.assign(config, saved); }
});

test('four-vault overview distinguishes token units, aggregate credits and Rhea covered/queued balances', async () => {
  const f = fixture(), result = await f.data.overview(ADDRESS);
  assert.deepEqual(result.vaults.map(v => v.kind), ['aave', 'rate', 'pendle', 'rhea']);
  assert.deepEqual(result.vaults.map(v => v.asset.decimals), [6, 18, 18, 6]);
  assert.deepEqual(result.vaults.map(v => v.unitsLabel), ['USDC', 'ETH wei', 'USDC-scaled18', 'USDC']);
  assert.equal(result.vaults[1].asset.address.toLowerCase(), CBETH);
  assert.equal(result.vaults[2].yieldToken.address.toLowerCase(), PT);
  assert.equal(result.vaults[1].id, `eip155:8453:${settings.rateVaultAddress}`);
  assert.equal(result.vaults[2].buyUrl, settings.pendleAppUrl);
  for (const v of result.vaults) assert.match(v.lossNote, /losses pro-rata/);
  const rhea = result.vaults[3];
  assert.equal(rhea.id, 'near:mainnet:vault.near'); assert.equal(rhea.chain.name, 'NEAR');
  assert.equal(rhea.position.principal, 90_000_000n); assert.equal(rhea.position.shares, 100_000_000n);
  assert.equal(rhea.position.yieldCredited, 333_333n); assert.equal(rhea.position.allowance, 0n);
  assert.deepEqual(rhea.position.rhea, { pendingIn: 2_000_000n, pendingOut: 1_000_000n, coverage: 900_000_000_000_000_000n, busy: false, intentsBalance: 5_000_000n });
  assert.equal(result.credits.available, 99n, 'credits come from the aggregate connector account, never local token summation');
  const balanceRead = f.requests.find(r => (r.body.params as { method_name?: string })?.method_name === 'mt_balance_of')!;
  assert.equal((balanceRead.body.params as { account_id: string }).account_id, settings.intentsAccount);
  f.state.coverage = '0'; f.state.pendingOut = null; f.state.busy = true;
  const lost = (await f.data.overview(ADDRESS)).vaults[3].position;
  assert.equal(lost.principal, 0n); assert.equal(lost.rhea?.pendingOut, null); assert.equal(lost.rhea?.busy, true);
});

for (const kind of ['aave', 'rate', 'pendle'] as const) {
  test(`${kind} uses the same ERC4626 approval/deposit/redeem path in native units`, async () => {
    const f = fixture();
    const selected = (await f.data.overview(ADDRESS)).vaults.find(v => v.kind === kind)!;
    const assets = kind === 'aave' ? 5_000_000n : 123_456_789_123_456_789n;
    await f.data.deposit(ADDRESS, assets, selected.id);
    const approval = decodeFunctionData({ abi: usdcAbi, data: f.transactions[0].data });
    assert.deepEqual(approval.args, [getAddress(selected.id.split(':')[2]), assets]);
    assert.equal(f.transactions[0].to.toLowerCase(), selected.asset.address.toLowerCase());
    const deposit = decodeFunctionData({ abi: vaultAbi, data: f.transactions[1].data });
    assert.deepEqual(deposit.args, [assets, getAddress(ADDRESS)]);
    await f.data.redeem(ADDRESS, assets - 1n, selected.id);
    const redeem = decodeFunctionData({ abi: vaultAbi, data: f.transactions[2].data });
    assert.deepEqual(redeem.args, [assets - 1n, getAddress(ADDRESS), getAddress(ADDRESS)]);
    assert.equal(f.transactions[2].to.toLowerCase(), selected.id.split(':')[2]);
    await assert.rejects(f.data.deposit(ADDRESS, assets, 'near:mainnet:vault.near'), rejectsCode('vault'));
  });
}

test('Rhea quote previews are dry, bind the Base-to-vault route, and never sign/send', async () => {
  const f = fixture(), preview = await f.data.rheaQuote(ADDRESS, 5_000_000n, 'deposit');
  assert.equal(preview.dry, true); assert.equal(preview.depositAddress, undefined);
  assert.equal(preview.amountOut, 4_999_000n); assert.equal(preview.isMock, false);
  const request = f.requests.find(r => r.url.endsWith('/v0/quote'))!.body;
  assert.deepEqual(request, { dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100,
    originAsset: settings.baseUsdcAssetId, destinationAsset: 'nep141:usdc.near', depositType: 'ORIGIN_CHAIN',
    recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN', amount: '5000000', refundTo: ADDRESS.toLowerCase(),
    recipient: 'vault.near', customRecipientMsg: `{"user":"eip155:8453:${ADDRESS.toLowerCase()}"}`, deadline: '2026-11-04T12:10:00.000Z' });
  assert.equal(f.transactions.length, 0); assert.equal(f.walletCalls.length, 0);
});

test('confirmed Rhea deposit obtains a funded quote and sends exactly one Base USDC transfer', async () => {
  const f = fixture(), funded = await f.data.rheaDeposit(ADDRESS, 5_000_000n);
  assert.equal(funded.quote.dry, false); assert.equal(funded.quote.depositAddress, '0x7777777777777777777777777777777777777777');
  assert.equal(f.transactions.length, 1); assert.equal(f.transactions[0].to.toLowerCase(), USDC);
  const transfer = decodeFunctionData({ abi: usdcAbi, data: f.transactions[0].data });
  assert.equal(transfer.functionName, 'transfer');
  assert.deepEqual(transfer.args, ['0x7777777777777777777777777777777777777777', 5_000_000n]);
  assert.equal(f.receiptsRead.length, 1);
  assert.equal(f.requests.filter(r => r.url.endsWith('/v0/quote')).length, 1);
});

test('Rhea first withdrawal signature is the exact interfaces.md JSON, submitted unchanged', async () => {
  const f = fixture(), result = await f.data.rheaWithdraw(ADDRESS, 1_234_567n);
  assert.equal(result.txHash, 'fixture-relay-near-tx');
  const message = `{"action":"withdraw","network":"mainnet","vault":"vault.near","user":"eip155:8453:${ADDRESS.toLowerCase()}","amount":"1234567","nonce":8,"expires_at":1793793900}`;
  const sign = f.walletCalls.find(c => c.method === 'personal_sign')!;
  assert.equal(hexToString(sign.params![0] as Hex), message);
  const request = f.requests.find(r => r.url.endsWith('/rhea/withdraw'))!;
  assert.deepEqual(request.body, { message, signature: SIGNATURE });
  assert.equal(new Headers(request.headers).get('authorization'), null);
  assert.equal(f.transactions.length, 0); assert.ok(!f.requests.some(r => r.url.startsWith(settings.oneClickUrl)));
});

test('Rhea exit previews INTENTS-to-Base, then signs the native ERC191 transfer with normalized recovery id', async () => {
  const f = fixture();
  await f.data.rheaQuote(ADDRESS, 5_000_000n, 'withdraw');
  assert.equal(f.walletCalls.length, 0);
  const result = await f.data.rheaExit(ADDRESS, 5_000_000n);
  const quoteRequest = f.requests.filter(r => r.url.endsWith('/v0/quote'))[1].body;
  assert.equal(quoteRequest.dry, false); assert.equal(quoteRequest.depositType, 'INTENTS');
  assert.equal(quoteRequest.refundType, 'INTENTS'); assert.equal(quoteRequest.refundTo, ADDRESS.toLowerCase());
  assert.equal(quoteRequest.originAsset, 'nep141:usdc.near'); assert.equal(quoteRequest.destinationAsset, settings.baseUsdcAssetId);
  assert.equal(quoteRequest.recipientType, 'DESTINATION_CHAIN'); assert.equal(quoteRequest.recipient, ADDRESS.toLowerCase());
  assert.ok(!('customRecipientMsg' in quoteRequest));
  const post = f.requests.find(r => r.url.endsWith('/intents/execute'))!.body as { signed: { standard: string; payload: string; signature: string }[] };
  assert.equal(post.signed.length, 1); const signed = post.signed[0];
  const payload = JSON.parse(signed.payload);
  assert.equal(signed.standard, 'erc191');
  assert.equal(signed.payload, JSON.stringify({ signer_id: ADDRESS.toLowerCase(), verifying_contract: 'intents.near',
    deadline: '2026-11-04T12:10:00.000Z', nonce: payload.nonce,
    intents: [{ intent: 'transfer', receiver_id: 'quote.near', tokens: { 'nep141:usdc.near': '5000000' } }] }));
  assert.equal(atob(payload.nonce).length, 32);
  assert.equal(hexToString(f.walletCalls.find(c => c.method === 'personal_sign')!.params![0] as Hex), signed.payload);
  const signature = base58.decode(signed.signature.slice('secp256k1:'.length));
  assert.deepEqual(signature.slice(0, 64), hexToBytes(SIGNATURE).slice(0, 64)); assert.equal(signature[64], 0);
  assert.equal(result.txHash, 'fixture-relay-near-tx'); assert.equal(f.transactions.length, 0);
});

test('1Click status can be polled until terminal without wallet actions', async () => {
  const f = fixture();
  assert.deepEqual(await f.data.rheaStatus('quote.near'), { status: 'PROCESSING', terminal: false, isMock: false });
  for (const status of ['SUCCESS', 'FAILED', 'REFUNDED']) {
    f.state.swapStatus = status;
    assert.equal((await f.data.rheaStatus('quote.near')).terminal, true);
  }
  assert.ok(f.requests[0].url.endsWith('/v0/status?depositAddress=quote.near'));
  assert.equal(f.walletCalls.length, 0);
});

test('Rhea maps quote, relay and wallet errors and never funds mismatched/expired/missing quotes', async () => {
  for (const key of ['quoteMismatch', 'missingFunding', 'wrongAmount', 'expiredQuote'] as const) {
    const f = fixture(); f.state[key] = true;
    await assert.rejects(f.data.rheaDeposit(ADDRESS, 5_000_000n), rejectsCode('quote'));
    assert.equal(f.transactions.length, 0);
  }
  // A deposit that would arrive below the vault's 1 USDC minimum is refused before any transfer.
  const small = fixture(); small.state.minOut = '999999';
  await assert.rejects(small.data.rheaDeposit(ADDRESS, 1_000_000n), rejectsCode('amount'));
  assert.equal(small.transactions.length, 0);
  const f = fixture(); f.state.quoteStatus = 400;
  await assert.rejects(f.data.rheaQuote(ADDRESS, 1n, 'deposit'), rejectsCode('oneclick'));
  await assert.rejects(f.data.rheaStatus('quote.near'), rejectsCode('oneclick'));
  f.state.relayStatus = 429; f.state.relayCode = 'read_rate_limit';
  await assert.rejects(f.data.rheaWithdraw(ADDRESS, 1n), rejectsCode('read_rate_limit'));
  f.state.nonceNear = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(f.data.rheaWithdraw(ADDRESS, 1n), rejectsCode('near_rpc'));
  const rejected = fixture(); rejected.state.rejected = true;
  await assert.rejects(rejected.data.rheaDeposit(ADDRESS, 1n), rejectsCode('wallet_rejected'));
  assert.equal(rejected.requests.length, 0);
  for (const action of [() => f.data.rheaQuote(ADDRESS, 0n, 'deposit'), () => f.data.rheaWithdraw(ADDRESS, -1n), () => f.data.rheaExit(ADDRESS, 0n)])
    await assert.rejects(action(), rejectsCode('amount'));
});

test('labelled mock exposes four vaults and simulates both Rhea bridge stages without touching credits', async () => {
  const { createMockData } = await import('./mock.ts');
  const data = createMockData(), initial = await data.overview(ADDRESS);
  assert.equal(data.isMock, true); assert.equal(initial.vaults.length, 4);
  assert.deepEqual(initial.vaults.map(v => v.asset.decimals), [6, 18, 18, 6]);
  const preview = await data.rheaQuote(ADDRESS, 5_000_000n, 'deposit');
  assert.equal(preview.dry, true); assert.equal(preview.isMock, true); assert.equal(preview.depositAddress, undefined);
  const deposit = await data.rheaDeposit(ADDRESS, 5_000_000n);
  assert.equal((await data.overview(ADDRESS)).vaults[3].position.rhea?.pendingIn, 0n); // still bridging
  await data.rheaStatus(deposit.quote.depositAddress!);
  const pending = (await data.overview(ADDRESS)).vaults[3].position; // delivered, queued in the vault
  assert.equal(pending.rhea?.pendingIn, deposit.quote.amountOut);
  const landed = await data.overview(ADDRESS); // the next cycle activates it
  assert.equal(landed.vaults[3].position.principal, initial.vaults[3].position.principal + deposit.quote.amountOut);
  assert.equal(landed.vaults[0].position.walletBalance, initial.vaults[0].position.walletBalance - 5_000_000n);
  await data.rheaWithdraw(ADDRESS, 3_000_000n);
  const withdrawn = await data.overview(ADDRESS);
  assert.equal(withdrawn.vaults[3].position.rhea?.intentsBalance, 3_000_000n);
  const exit = await data.rheaExit(ADDRESS, 3_000_000n); await data.rheaStatus(exit.quote.depositAddress!);
  const final = await data.overview(ADDRESS);
  assert.equal(final.vaults[0].position.walletBalance, landed.vaults[0].position.walletBalance + exit.quote.amountOut);
  assert.deepEqual(final.credits, initial.credits);
});

test('native Intents signature encoding accepts wallet recovery ids and rejects unsupported formats', async () => {
  const { intentSignature } = await import('./rhea.ts');
  for (const [v, recovery] of [[27, 0], [28, 1], [0, 0], [1, 1]]) {
    const signed = intentSignature(`0x${'12'.repeat(64)}${v.toString(16).padStart(2, '0')}`);
    const decoded = base58.decode(signed.slice('secp256k1:'.length));
    assert.equal(decoded.length, 65); assert.equal(decoded[64], recovery);
  }
  assert.throws(() => intentSignature(`0x${'12'.repeat(64)}`), rejectsCode('wallet_signature'));
  assert.throws(() => intentSignature(`0x${'12'.repeat(64)}25`), rejectsCode('wallet_signature'));
});
