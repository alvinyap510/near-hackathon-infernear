import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FreeCalls, freeCallLimit } from '../src/gateway/free-calls.ts';
import { MAX_ANONYMOUS_ENTRIES } from '../src/gateway/expiring-map.ts';
import { Meter } from '../src/gateway/meter.ts';
import { costMicro, HttpError } from '../src/types.ts';
import { harness as createHarness, fixture, USER, eventually, settle } from './harness.ts';

const harness = createHarness;
type Harness = Awaited<ReturnType<typeof harness>>;
const requestBody = (extra = {}) => JSON.stringify({ model: 'fixture/tee', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 10, ...extra });
const headers = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });
const chat = (h: Harness, key = h.key, body = requestBody(), privateMode = false) => fetch(h.base + '/v1/chat/completions', {
  method: 'POST', headers: privateMode ? { ...h.headers, authorization: `Bearer ${key}` } : headers(key), body,
});
const status = async (h: Harness, key = h.key) => {
  const response = await fetch(h.base + '/v1/free-calls', { headers: headers(key) });
  assert.equal(response.status, 200); return response.json() as Promise<{ per_user: number; used: number; remaining: number }>;
};
const drain = async (response: Response) => { await response.arrayBuffer(); return response; };
const quiet = async (h: Harness) => eventually(() => h.gateway.state(USER).active === 0);
const trialOptions = { seed: false, freeCallsPerUser: 5, freeCallsPerDay: 300 };
const OTHER = 'eip155:8453:0x2222222222222222222222222222222222222222';

test('trial settings default off and reject invalid nonnegative integer config', () => {
  assert.equal(freeCallLimit(undefined, 'trial'), 0);
  for (const value of ['0', '5', '300']) assert.equal(freeCallLimit(value, 'trial'), Number(value));
  for (const invalid of ['', ' ', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', 'wallet'])
    assert.throws(() => freeCallLimit(invalid, 'RELAY_FREE_CALLS_PER_DAY'), /Invalid RELAY_FREE_CALLS_PER_DAY/);
});

test('feature off reports zeros, keeps credit admission/debits and labels credit responses', async t => {
  const h = await harness(); t.after(h.close);
  assert.deepEqual(await status(h), { per_user: 0, used: 0, remaining: 0 });
  const response = await drain(await chat(h));
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-infernear-billing'), 'credits');
  assert.equal(response.headers.get('x-infernear-free-remaining'), null);
  await settle(h.gateway);
  assert.equal(h.connector.debitCalls, 1); assert.equal(h.connector.amounts.get('fixture-inference'), 13n);
  for (const limits of [{ freeCallsPerUser: 5, freeCallsPerDay: 0 }, { freeCallsPerUser: 0, freeCallsPerDay: 300 }]) {
    const off = await harness({ seed: false, ...limits }); t.after(off.close);
    assert.deepEqual(await status(off), { per_user: 0, used: 0, remaining: 0 });
    assert.equal((await chat(off)).status, 402);
  }
});

test('five calls are free for a zero-credit wallet; its sixth keeps the existing 402 response', async t => {
  const h = await harness(trialOptions); t.after(h.close);
  h.respond({ id: 'free-{n}' });
  let key = h.key;
  for (let i = 1; i <= 5; i++) {
    const response = await drain(await chat(h, key));
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-infernear-billing'), 'free');
    assert.equal(response.headers.get('x-infernear-free-remaining'), String(5 - i));
    await quiet(h);
    assert.deepEqual(await status(h, key), { per_user: 5, used: i, remaining: 5 - i });
    if (i === 2) {
      h.connector.seed(USER, 0n); h.connector.accounts.get(USER)!.key_epoch = 1;
      key = h.auth.issue(USER, 1).key; // Revoking/reissuing a key cannot replenish wallet trials.
    }
  }
  const denied = await chat(h, key);
  assert.equal(denied.status, 402); assert.equal((await denied.json()).error.code, 'insufficient_credit');
  assert.equal(h.connector.debitCalls, 0); assert.equal(h.connector.postCalls, 0); assert.equal(h.connector.debitReads, 0);
  assert.equal(h.events.filter(e => e.event === 'free_call').length, 5);
  assert.deepEqual(h.gateway.state(USER), { spent_floor: 0n, key_epoch: 1, active: 0, reserved: 0n, pending: 0 });
});

test('trials are used before existing credits, then paid calls debit only their own usage', async t => {
  const h = await harness({ freeCallsPerUser: 5, freeCallsPerDay: 300 }); t.after(h.close);
  h.respond({ id: 'priced-{n}' });
  for (let i = 0; i < 5; i++) { await drain(await chat(h)); await quiet(h); }
  assert.equal(h.connector.debitCalls, 0); assert.equal(h.connector.accounts.get(USER)!.spent, 0n);
  const paid = await drain(await chat(h));
  assert.equal(paid.headers.get('x-infernear-billing'), 'credits');
  assert.equal(paid.headers.get('x-infernear-free-remaining'), null);
  await settle(h.gateway);
  assert.equal(h.connector.debitCalls, 1); assert.equal(h.connector.amounts.size, 1);
  assert.equal(h.connector.accounts.get(USER)!.spent, 13n);
  assert.equal(h.gateway.state(USER).spent_floor, 13n);
});

test('daily quota is shared by EVM/NEAR wallets and resets at UTC midnight without resetting wallet usage', async t => {
  let clock = Date.parse('2026-11-13T23:59:59Z');
  const h = await harness({ ...trialOptions, freeCallsPerDay: 3, now: () => clock }); t.after(h.close);
  h.respond({ id: 'daily-{n}' });
  const keys = [h.key, h.auth.issue('near:mainnet:alice.near', 0).key, h.auth.issue(OTHER, 0).key];
  for (const key of keys) { assert.equal((await drain(await chat(h, key))).status, 200); await quiet(h); }
  assert.deepEqual(await status(h), { per_user: 5, used: 1, remaining: 0 });
  assert.equal((await chat(h, h.auth.issue('near:mainnet:bob.near', 0).key)).status, 402);
  clock += 1000;
  assert.deepEqual(await status(h), { per_user: 5, used: 1, remaining: 3 });
  assert.equal((await drain(await chat(h))).status, 200); await quiet(h);
  assert.deepEqual(await status(h), { per_user: 5, used: 2, remaining: 2 });
  assert.equal(h.connector.debitCalls, 0);
});

test('non-2xx and successful replies without an id release both quotas', async t => {
  const h = await harness({ ...trialOptions, freeCallsPerDay: 1 }); t.after(h.close);
  for (const reply of [
    { status: 503, id: 'not-successful', body: Buffer.from('{"id":"error-id"}') },
    { status: 200, id: null, body: Buffer.from('{"choices":[]}') },
  ]) {
    h.respond(reply); await drain(await chat(h)); await quiet(h);
    assert.deepEqual(await status(h), { per_user: 5, used: 0, remaining: 1 });
  }
  assert.equal(h.events.filter(e => e.event === 'free_call').length, 0);
  assert.equal(h.events.filter(e => e.event === 'inference_loss').length, 2);
  h.respond({ status: 200, id: 'now-success', body: fixture('response.json') });
  await drain(await chat(h)); await quiet(h);
  assert.deepEqual(await status(h), { per_user: 5, used: 1, remaining: 0 });
  assert.equal(h.connector.debitCalls, 0);
});

test('the last wallet free call is held in flight; an overlapping call falls through to credits', async t => {
  const h = await harness({ ...trialOptions, freeCallsPerUser: 1 }); t.after(h.close);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  h.respond({ headersWait: wait });
  const first = chat(h);
  await eventually(() => h.gateway.state(USER).active === 1);
  assert.deepEqual(await status(h), { per_user: 1, used: 0, remaining: 0 });
  assert.equal(h.gateway.state(USER).reserved, 0n);
  const second = await chat(h); assert.equal(second.status, 402);
  release(); assert.equal((await drain(await first)).headers.get('x-infernear-billing'), 'free'); await quiet(h);
  assert.deepEqual(await status(h), { per_user: 1, used: 1, remaining: 0 });
  assert.equal(h.connector.debitCalls, 0);
});

test('different wallets cannot both hold the last daily call', async t => {
  const h = await harness({ ...trialOptions, freeCallsPerDay: 1 }); t.after(h.close);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  h.respond({ headersWait: wait });
  const first = chat(h); await eventually(() => h.gateway.state(USER).active === 1);
  const other = h.auth.issue(OTHER, 0).key;
  assert.equal((await chat(h, other)).status, 402);
  assert.deepEqual(await status(h, other), { per_user: 5, used: 0, remaining: 0 });
  release(); await drain(await first); await quiet(h);
  assert.equal(h.events.filter(e => e.event === 'free_call').length, 1);
});

test('live holds survive midnight and spend the completion day rather than escaping its daily cap', async t => {
  let clock = Date.parse('2026-11-13T23:59:59Z');
  const h = await harness({ ...trialOptions, freeCallsPerDay: 1, now: () => clock }); t.after(h.close);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  h.respond({ headersWait: wait });
  const first = chat(h); await eventually(() => h.gateway.state(USER).active === 1);
  clock += 1000;
  const other = h.auth.issue(OTHER, 0).key;
  assert.deepEqual(await status(h, other), { per_user: 5, used: 0, remaining: 0 });
  release(); await drain(await first); await quiet(h);
  assert.deepEqual(await status(h), { per_user: 5, used: 1, remaining: 0 });
  assert.equal((await chat(h, other)).status, 402);
  clock += 86_400_000;
  assert.deepEqual(await status(h), { per_user: 5, used: 1, remaining: 1 });
});

test('free JSON and SSE keep exact reply bytes, billing headers and the CORS expose list', async t => {
  for (const privateMode of [false, true]) for (const streaming of [false, true]) {
    const h = await harness(trialOptions); t.after(h.close);
    const bytes = fixture(streaming ? 'stream.sse' : 'response.json');
    h.respond({ body: bytes, stream: streaming, id: null });
    const response = await chat(h, h.key, requestBody({ stream: streaming, ...(streaming ? { stream_options: { include_usage: true } } : {}) }), privateMode);
    assert.equal(response.headers.get('x-infernear-billing'), 'free');
    assert.equal(response.headers.get('x-infernear-free-remaining'), '4');
    const exposed = response.headers.get('access-control-expose-headers')!.toLowerCase().split(',').map(x => x.trim());
    assert.deepEqual(exposed, ['inference-id', 'x-infernear-billing', 'x-infernear-free-remaining']);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    await quiet(h); assert.equal((await status(h)).used, 1);
    assert.equal(h.connector.debitCalls, 0);
  }
});

test('free standard/private calls retain the normal 4096 token cap and validation', async t => {
  const h = await harness({ ...trialOptions, maxTokens: 4096 }); t.after(h.close);
  h.respond({ id: 'modes-{n}' });
  for (const privateMode of [false, true]) {
    const body = requestBody({ max_tokens: 4096 });
    const response = await drain(await chat(h, h.key, body, privateMode));
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-infernear-billing'), 'free');
    await quiet(h);
    const forwarded = h.requests.filter(r => r.path.startsWith('/v1/chat/completions')).at(-1)!;
    assert.equal(JSON.parse(forwarded.body.toString()).max_tokens, 4096);
    if (privateMode) assert.deepEqual(forwarded.body, Buffer.from(body));
  }
  for (const variant of [{ max_tokens: 4097 }, { n: 2 }, { messages: [] }])
    assert.equal((await chat(h, h.key, requestBody(variant))).status, 400);
  assert.equal((await chat(h, h.key, requestBody({ model: 'unknown' }))).status, 404);
  assert.deepEqual(await status(h), { per_user: 5, used: 2, remaining: 3 });
});

test('free calls still occupy all four slots; keys must be valid and current before a hold', async t => {
  const h = await harness(trialOptions); t.after(h.close);
  assert.equal((await chat(h, 'inf_invalid')).status, 401);
  h.connector.seed(USER, 0n); h.connector.accounts.get(USER)!.key_epoch = 1;
  assert.equal((await chat(h)).status, 401);
  const fresh = h.auth.issue(USER, 1).key;
  assert.equal((await status(h, fresh)).used, 0);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  h.respond({ headersWait: wait, id: 'slots-{n}' });
  const calls = Array.from({ length: 4 }, () => chat(h, fresh));
  await eventually(() => h.gateway.state(USER).active === 4);
  assert.equal((await chat(h, fresh)).status, 429);
  assert.deepEqual(await status(h, fresh), { per_user: 5, used: 0, remaining: 1 });
  assert.equal(h.gateway.state(USER).reserved, 0n);
  release(); await Promise.all(calls.map(async call => drain(await call))); await quiet(h);
  assert.deepEqual(await status(h, fresh), { per_user: 5, used: 4, remaining: 1 });
});

test('a free call does not depend on ledger storage and writes nothing to the ledger', async t => {
  const h = await harness(trialOptions); t.after(h.close);
  h.connector.storageBalance = async () => { throw new Error('free call read storage'); };
  const response = await drain(await chat(h)); assert.equal(response.status, 200); await quiet(h);
  assert.equal(h.connector.debitCalls, 0); assert.equal(h.connector.debitReads, 0);
  assert.equal(h.gateway.state(USER).spent_floor, 0n);
  assert.equal(h.gateway.state(USER).pending, 0);
});

test('free settlement reports the would-be charge and never touches the connector', async t => {
  const h = await harness(trialOptions); t.after(h.close);
  const admission = await h.gateway.admit(Buffer.from(requestBody()), headers(h.key));
  const meter = new Meter(false); meter.push(fixture('response.json')); meter.finish();
  const before = [h.connector.accountCalls, h.connector.storageCalls, h.connector.debitReads, h.connector.debitCalls, h.connector.postCalls];
  await h.gateway.complete(admission, 200, 'once-only', meter);
  assert.deepEqual(h.events.filter(e => e.event === 'free_call'), [{ event: 'free_call', details: { user: USER, inference_id: 'once-only', amount_micro: '13', source: 'signed_usage' } }]);
  assert.deepEqual([h.connector.accountCalls, h.connector.storageCalls, h.connector.debitReads, h.connector.debitCalls, h.connector.postCalls], before);
  assert.deepEqual(h.gateway.state(USER), { spent_floor: 0n, key_epoch: 0, active: 0, reserved: 0n, pending: 0 });
});

test('an upstream failure before headers releases the hold', async t => {
  const h = await harness(trialOptions); t.after(h.close);
  await h.gateway.upstream.models();
  h.gateway.upstream.request = async () => { throw new HttpError(504, 'upstream_timeout', 'Fixture timeout'); };
  const response = await chat(h);
  assert.equal(response.status, 504); await response.arrayBuffer(); await quiet(h);
  assert.deepEqual(await status(h), { per_user: 5, used: 0, remaining: 5 });
  assert.equal(h.connector.debitCalls, 0);
});

test('missing/failed metering uses the existing reservation formula without failing a free request', async t => {
  const h = await harness(trialOptions); t.after(h.close);
  const finish = Meter.prototype.finish;
  Meter.prototype.finish = function () { throw new Error('fixture metering failure'); };
  t.after(() => { Meter.prototype.finish = finish; });
  const response = await drain(await chat(h)); assert.equal(response.status, 200); await quiet(h);
  const forwarded = h.requests.find(r => r.path.startsWith('/v1/chat/completions'))!.body;
  const amount = costMicro(forwarded.length + 1024, 10, 1000n, 1000n);
  const report = h.events.find(e => e.event === 'free_call')!;
  assert.equal(report.details.source, 'reservation'); assert.equal(report.details.amount_micro, String(amount));
  assert.equal(h.connector.debitCalls, 0);
});

test('free-calls endpoint uses the normal API-key authentication and does not call upstream', async t => {
  const h = await harness(trialOptions); t.after(h.close);
  for (const authorization of [undefined, 'Bearer inf_bad']) {
    const response = await fetch(h.base + '/v1/free-calls', { headers: authorization ? { authorization } : {} });
    assert.equal(response.status, 401); assert.equal((await response.json()).error.code, 'invalid_api_key');
  }
  assert.deepEqual(await status(h), { per_user: 5, used: 0, remaining: 5 });
  h.connector.seed(USER, 0n); h.connector.accounts.get(USER)!.key_epoch = 1;
  assert.equal((await fetch(h.base + '/v1/free-calls', { headers: headers(h.key) })).status, 401);
  assert.equal(h.requests.length, 0); assert.equal(h.connector.debitCalls, 0);
});

test('trial map reuses the existing bound without evicting consumed usage or a live hold', () => {
  const free = new FreeCalls(1, MAX_ANONYMOUS_ENTRIES + 2, () => 0);
  const live = free.hold('live')!;
  for (let i = 1; i < MAX_ANONYMOUS_ENTRIES; i++) free.settle(free.hold(String(i))!, true);
  assert.equal(free.hold('new-wallet'), undefined);
  assert.deepEqual(free.status('live'), { per_user: 1, used: 0, remaining: 0 });
  assert.equal(free.status('1').used, 1);
  free.settle(live, false); // No consumed usage: safe to remove this entry.
  assert.ok(free.hold('new-wallet'));
  assert.equal(free.hold('1'), undefined, 'used wallets never regain a trial through eviction');
});

test('an overlapping paid request reserves credits while the last free call holds quota only', async t => {
  const h = await harness({ freeCallsPerUser: 1, freeCallsPerDay: 300 }); t.after(h.close);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); t.after(() => release());
  h.respond({ headersWait: wait, id: 'overlap-{n}' });
  const calls = [chat(h), chat(h)];
  await eventually(() => h.gateway.state(USER).active === 2);
  assert.ok(h.gateway.state(USER).reserved > 0n);
  assert.deepEqual(await status(h), { per_user: 1, used: 0, remaining: 0 });
  release();
  const responses = await Promise.all(calls.map(async call => drain(await call)));
  assert.deepEqual(responses.map(r => r.headers.get('x-infernear-billing')).sort(), ['credits', 'free']);
  await settle(h.gateway);
  assert.equal(h.connector.debitCalls, 1); assert.equal(h.connector.accounts.get(USER)!.spent, 13n);
  assert.equal(h.events.filter(e => e.event === 'free_call').length, 1);
});
