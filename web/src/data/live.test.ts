// Offline fixtures: no wallet, transaction, relay or chain network is contacted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFunctionData, encodeFunctionResult, getAddress, hexToString, type EIP1193Provider, type Hex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { caip10, config, liveConfig, type LiveConfig } from '../config.ts';
import { vaultAbi, usdcAbi } from './abi.ts';
import { createLiveData } from './live.ts';
import { DataError } from './errors.ts';
import type { Address } from './types.ts';

const ADDRESS = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as Address;
const VAULT = '0x2222222222222222222222222222222222222222' as Address;
const USDC = '0x3333333333333333333333333333333333333333' as Address;
const SIGNATURE = `0x${'ab'.repeat(65)}` as Hex;
const settings: LiveConfig = {
  relayUrl: 'https://relay.example:9443', vaultChainId: 8453, vaultAddress: VAULT,
  baseRpcUrl: 'https://base.example', nearRpcUrl: 'https://near.example', connectorAccount: 'connector.near',
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
        const abi = call.to.toLowerCase() === VAULT ? vaultAbi : usdcAbi;
        const decoded = decodeFunctionData({ abi, data: call.data });
        const value = decoded.functionName === 'asset' ? USDC
          : decoded.functionName === 'convertToAssets' ? state.assets
          : decoded.functionName === 'yieldCredited' ? 42n
          : decoded.functionName === 'allowance' ? state.allowance
          : call.to.toLowerCase() === VAULT ? state.shares : state.wallet;
        result = encodeFunctionResult({ abi, functionName: decoded.functionName, result: value } as Parameters<typeof encodeFunctionResult>[0]);
      } else throw new Error(`Unexpected Base RPC ${body.method}`);
      return json({ jsonrpc: '2.0', id: body.id, result });
    }
    if (url === settings.nearRpcUrl) {
      if (state.failNear) return json({ error: { message: 'Fixture connector unavailable' } });
      const result = body.params.method_name === 'account'
        ? { credited: state.malformedAmount ? Number(state.credited) : String(state.credited), spent: String(state.spent), available: '99', key_epoch: 7 }
        : state.debit;
      return json({ jsonrpc: '2.0', id: body.id, result: { result: [...new TextEncoder().encode(JSON.stringify(result))] } });
    }
    if (state.relayStatus !== 200) return json({ error: { code: state.relayCode, message: 'Fixture relay rejection' } }, state.relayStatus);
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
  const values = { ...settings, vaultChainId: String(settings.vaultChainId) };
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
    Object.assign(config, { ...settings, vaultChainId: String(settings.vaultChainId) });
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
