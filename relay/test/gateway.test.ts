import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate as turn } from 'node:timers/promises';
import { request } from 'node:http';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { Auth } from '../src/gateway/auth.ts';
import { Meter, inferenceId } from '../src/gateway/meter.ts';
import { costMicro, HttpError } from '../src/types.ts';
import { harness, fixture, USER, e2ee, settle, eventually } from './harness.ts';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const raw = (overrides: Record<string, unknown> = {}) => Buffer.from(JSON.stringify({ ...JSON.parse(fixture('chat.json').toString()), ...overrides }));

test('chat rejects unsupported parameters and missing encryption headers before upstream inference', async t => {
  const h = await harness(); t.after(h.close);
  const variants = [
    { max_completion_tokens: 10 }, { n: 2 }, { max_tokens: undefined }, { max_tokens: 101 }, { max_tokens: 1.1 },
    { stream: true }, { stream: true, stream_options: { include_usage: false } },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'fixture' }] }] },
  ];
  for (const variant of variants) {
    const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw(variant) });
    assert.equal(response.status, 400); assert.ok((await response.json()).error.code);
  }
  for (const patch of [{ 'x-encryption-version': '2' }, { 'x-client-pub-key': '' }, { 'x-encrypt-all-fields': 'false' }, { 'x-no-aliasing': 'false' }]) {
    const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: { ...h.headers, ...patch }, body: raw() });
    assert.equal(response.status, 400);
  }
  const unencrypted = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${h.key}` }, body: raw() });
  assert.equal(unencrypted.status, 400);
  for (const model of ['fixture/external', 'fixture/unattested', 'fixture-alias', 'unknown', 'fixture/image']) {
    const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw({ model }) });
    assert.equal(response.status, 404);
  }
  assert.equal(h.requests.filter(r => r.path.includes('/chat/')).length, 0);
});

test('JSON forwarding preserves hashes and headers, snapshots prices and caps metering at the reservation', async t => {
  const h = await harness(); t.after(h.close);
  const bytes = fixture('chat.json');
  const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: bytes });
  const received = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(received), hash(fixture('response.json')));
  const upstream = h.requests.find(r => r.path === '/v1/chat/completions')!;
  assert.equal(hash(upstream.body), hash(bytes));
  assert.equal(upstream.headers.authorization, 'Bearer fixture-upstream-key');
  assert.equal(upstream.headers['accept-encoding'], 'identity');
  for (const [name, value] of Object.entries(e2ee)) assert.equal(upstream.headers[name], value);
  assert.equal(response.headers.get('inference-id'), 'fixture-inference');
  assert.equal(response.headers.get('access-control-expose-headers'), 'Inference-Id');
  await settle(h.gateway);
  assert.equal(h.connector.amounts.get('fixture-inference'), 13n);
  assert.equal(h.connector.receipts.get('fixture-inference')!.source, 'signed_usage');
  h.respond({ id: 'over-reservation', body: Buffer.from('{"id":"huge-usage","usage":{"prompt_tokens":1000000,"completion_tokens":1000000}}') });
  const next = raw();
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: next })).arrayBuffer();
  await settle(h.gateway);
  assert.equal(h.connector.amounts.get('over-reservation'), costMicro(Math.ceil(next.length / 2), 10, 1000n, 1000n));
});

test('SSE frames stay byte-exact and headerless streams use UUIDv5 (Flex1-4: DNS reference vector)', async t => {
  const h = await harness(); t.after(h.close);
  const stream = Buffer.from(fixture('stream.sse').toString().replaceAll('\n', '\r\n'));
  h.respond({ body: stream, stream: true, id: null });
  const body = raw({ stream: true, stream_options: { include_usage: true } });
  const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body });
  assert.equal(response.status, 200);
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(stream));
  assert.equal(hash(h.requests.find(r => r.path.includes('/chat/'))!.body), hash(body));
  await settle(h.gateway);
  const id = inferenceId('chatcmpl-stream');
  assert.equal(h.connector.amounts.get(id), 13n);
  assert.equal(h.connector.receipts.get(id)!.chat_id, 'chatcmpl-stream');
  // Published UUIDv5 DNS test vector, independent of our completion fixture.
  assert.equal(inferenceId('www.widgets.com'), '21f7f8de-8051-5b89-8680-0195ef798b6a');
});

test('completion without usage charges numeric reservation inputs; failures without a completion are forgiven', async t => {
  const h = await harness(); t.after(h.close);
  h.respond({ id: null, body: Buffer.from('{"id":"no-usage","choices":[{"message":{"content":"aabb"}}]}') });
  const requestBytes = raw();
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: requestBytes })).arrayBuffer();
  await settle(h.gateway);
  const id = inferenceId('no-usage');
  assert.equal(h.connector.amounts.get(id), BigInt(Math.ceil(requestBytes.length / 2) + 10));
  const receipt = h.connector.receipts.get(id)!;
  assert.equal(receipt.source, 'reservation');
  assert.equal(receipt.prompt_tokens, Math.ceil(requestBytes.length / 2));
  assert.equal(receipt.completion_tokens, 10);
  const spent = h.connector.accounts.get(USER)!.spent;
  for (const options of [
    { status: 200, id: null, body: Buffer.from('{"error":{"message":"no completion"}}') },
    { status: 500, id: 'misleading-header', body: Buffer.from('{"id":"not-a-completion","error":{"message":"failed"}}') },
  ]) {
    h.respond(options);
    await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw() })).arrayBuffer();
    await settle(h.gateway);
  }
  assert.equal(h.connector.accounts.get(USER)!.spent, spent);
  assert.equal(h.gateway.state(USER).reserved, 0n);
  assert.equal(h.events.filter(e => e.event === 'inference_loss').length, 2);
});

test('fifth in-flight request is 429 and reservations persist until stream metering finishes', async t => {
  const h = await harness(); t.after(h.close);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  t.after(release);
  h.respond({ stream: true, body: fixture('stream.sse'), id: 'concurrent-{n}', wait });
  const calls = Array.from({ length: 4 }, () => fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw({ stream: true, stream_options: { include_usage: true } }) }));
  await eventually(() => h.gateway.state(USER).active === 4);
  assert.ok(h.gateway.state(USER).reserved > 0n);
  const fifth = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw() });
  assert.equal(fifth.status, 429);
  release();
  await Promise.all(calls.map(async call => (await call).arrayBuffer()));
  await settle(h.gateway);
  assert.equal(h.gateway.state(USER).active, 0);
  assert.equal(h.gateway.state(USER).reserved, 0n);
  assert.equal(h.connector.amounts.size, 4);
});

test('client disconnect still drains the upstream stream and debits its final usage', async t => {
  const h = await harness(); t.after(h.close);
  let release!: () => void;
  h.respond({ stream: true, id: 'disconnect-id', body: fixture('stream.sse'), wait: new Promise<void>(resolve => { release = resolve; }) });
  t.after(release);
  await new Promise<void>((resolve, reject) => {
    const client = request(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers }, response => {
      response.once('data', () => { response.destroy(); client.destroy(); resolve(); });
    });
    client.on('error', error => { if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error); });
    client.end(raw({ stream: true, stream_options: { include_usage: true } }));
  });
  assert.ok(h.gateway.state(USER).reserved > 0n);
  release();
  await eventually(() => h.connector.amounts.has('disconnect-id'));
  await settle(h.gateway);
  assert.equal(h.connector.amounts.get('disconnect-id'), 13n);
});

test('debit retries count once in spent_floor and lagging reads cannot reopen headroom', async t => {
  const h = await harness(); t.after(h.close);
  h.connector.accounts.get(USER)!.credited = 200n;
  h.connector.accounts.get(USER)!.available = 200n;
  h.connector.accountOverride = { credited: 200n, spent: 0n, available: 200n, key_epoch: 0 };
  h.connector.landThenThrow = true;
  h.connector.hiddenDebits = 3;
  h.respond({ id: 'retry-id', body: Buffer.from('{"id":"retry-completion"}') });
  const bytes = raw();
  const expected = BigInt(Math.ceil(bytes.length / 2) + 10);
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: bytes })).arrayBuffer();
  await settle(h.gateway);
  assert.ok(h.connector.debitCalls >= 2);
  assert.equal(h.connector.accounts.get(USER)!.spent, expected);
  assert.equal(h.gateway.state(USER).spent_floor, expected);
  const next = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: bytes });
  assert.equal(next.status, 402);
  assert.equal(h.gateway.state(USER).reserved, 0n);
});

test('transient failures retain a retry and insufficient-credit outcome is reported as operator loss', async t => {
  const h = await harness(); t.after(h.close);
  h.connector.beforeFailures = 2;
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw() })).arrayBuffer();
  await settle(h.gateway);
  assert.equal(h.connector.accounts.get(USER)!.spent, 13n);
  assert.equal(h.gateway.state(USER).spent_floor, 13n);
  assert.equal(h.events.filter(e => e.event === 'debit_retry').length, 2);
  h.connector.accountOverride = { credited: 1000000n, available: 1000000n, spent: 0n, key_epoch: 0 };
  h.connector.accounts.get(USER)!.available = 0n;
  h.respond({ id: 'insufficient-on-chain' });
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw() })).arrayBuffer();
  await settle(h.gateway);
  assert.ok(h.events.some(e => e.event === 'inference_loss' && e.details.reason === 'insufficient_credit'));
});

test('a late pre-restart spend stays in the floor after it is observed, even when the next read lags', async t => {
  const h = await harness(); t.after(h.close);
  await h.gateway.authenticate(`Bearer ${h.key}`);
  h.connector.accountOverride = { credited: 1000000n, spent: 999999n, available: 1n, key_epoch: 0 };
  await h.gateway.authenticate(`Bearer ${h.key}`);
  h.connector.accountOverride.spent = 0n;
  const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw() });
  assert.equal(response.status, 402);
  assert.equal(h.gateway.state(USER).spent_floor, 999999n);
});

test('keys reject bad MAC, expiry, and old epochs; revocation takes effect before its transaction lands', async t => {
  let now = Date.now();
  const h = await harness({ now: () => now }); t.after(h.close);
  await assert.rejects(h.gateway.authenticate(`Bearer ${h.key.slice(0, -5)}xxxxx`), { status: 401 });
  now += 31 * 24 * 3600 * 1000;
  await assert.rejects(h.gateway.authenticate(`Bearer ${h.key}`), { status: 401 });
  now -= 31 * 24 * 3600 * 1000;
  h.connector.accountOverride = { credited: 1000000n, spent: 0n, available: 1000000n, key_epoch: 0 };
  let release!: () => void;
  h.connector.bumpWait = new Promise<void>(resolve => { release = resolve; });
  const revoking = h.gateway.revoke(USER);
  await eventually(() => h.gateway.state(USER).key_epoch === 1);
  await assert.rejects(h.gateway.authenticate(`Bearer ${h.key}`), { status: 401 });
  release(); await revoking;
  const issued = await h.gateway.issue(USER);
  assert.equal(issued.key_epoch, 1);
  await h.gateway.authenticate(`Bearer ${issued.key}`);
  await assert.rejects(h.gateway.authenticate(`Bearer ${h.key}`), { status: 401 });
  // A later observed epoch is also remembered through a subsequent lagging read.
  h.connector.accountOverride.key_epoch = 2;
  await assert.rejects(h.gateway.authenticate(`Bearer ${issued.key}`), { status: 401 });
  h.connector.accountOverride.key_epoch = 0;
  await assert.rejects(h.gateway.authenticate(`Bearer ${issued.key}`), { status: 401 });
});

test('a cold process has the documented stale-epoch window until its read catches up', async t => {
  const h = await harness(); t.after(h.close);
  h.connector.accounts.get(USER)!.key_epoch = 1;
  h.connector.accountOverride = { credited: 1000000n, spent: 0n, available: 1000000n, key_epoch: 0 };
  await h.gateway.authenticate(`Bearer ${h.key}`);
  const coldIssued = await h.gateway.issue(USER);
  assert.equal(coldIssued.key_epoch, 0);
  h.connector.accountOverride = undefined;
  await assert.rejects(h.gateway.authenticate(`Bearer ${coldIssued.key}`), { status: 401 });
  assert.equal((await h.gateway.issue(USER)).key_epoch, 1);
});

test('SIWE key routes require a single-use expiring nonce, our domain/URI, chain and signature', async t => {
  let now = Date.now();
  const h = await harness({ now: () => now }); t.after(h.close);
  const wallet = privateKeyToAccount(('0x' + '12'.repeat(32)) as `0x${string}`);
  const proof = async (nonce: string, overrides: Record<string, unknown> = {}) => {
    const message = createSiweMessage({ address: wallet.address, chainId: 8453, domain: 'relay.test', uri: 'http://relay.test', version: '1', nonce,
      issuedAt: new Date(now), expirationTime: new Date(now + 300_000), ...overrides });
    return { message, signature: await wallet.signMessage({ message }) };
  };
  const nonce = async () => (await (await fetch(h.base + '/auth/nonce')).json()).nonce as string;
  const send = (path: string, p: object) => fetch(h.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
  const valid = await proof(await nonce());
  const responses = await Promise.all([send('/keys', valid), send('/keys', valid)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
  for (const overrides of [{ domain: 'evil.test' }, { uri: 'https://evil.test' }, { uri: 'https://relay.test' }, { chainId: 1 }, { expirationTime: undefined }]) {
    assert.equal((await send('/keys', await proof(await nonce(), overrides))).status, 401);
  }
  const forged = await proof(await nonce());
  const otherWallet = privateKeyToAccount(('0x' + '34'.repeat(32)) as `0x${string}`);
  forged.signature = await otherWallet.signMessage({ message: forged.message });
  assert.equal((await send('/keys', forged)).status, 401);
  const expiredNonce = await proof(await nonce(), { expirationTime: new Date(now + 3600_000) }); now += 300_001;
  assert.equal((await send('/keys', expiredNonce)).status, 401);
  const revoke = await send('/keys/revoke', await proof(await nonce()));
  assert.equal(revoke.status, 200);
  assert.deepEqual(await revoke.json(), { key_epoch: 1, tx_hash: 'fixture-near-transaction' });
});

test('anonymous read bootstrap is byte-exact and limited; valid keys bypass the IP limit; models cache five minutes', async t => {
  let now = Date.now();
  const h = await harness({ now: () => now }); t.after(h.close);
  const models = await (await fetch(h.base + '/v1/models')).json();
  assert.deepEqual(models.data.map((m: any) => m.id), ['fixture/tee']);
  for (let i = 0; i < 3; i++) await fetch(h.base + '/v1/models');
  assert.equal(h.requests.filter(r => r.path === '/v1/model/list').length, 1);
  now += 300_001;
  await fetch(h.base + '/v1/models');
  assert.equal(h.requests.filter(r => r.path === '/v1/model/list').length, 2);
  for (let i = 0; i < 30; i++) {
    const path = ['/v1/attestation/report?nonce=fixture', '/v1/model/fixture%2Ftee', '/v1/signature/fixture'][i % 3];
    const response = await fetch(h.base + path);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{ "fixture": "unchanged" }\n');
  }
  assert.equal((await fetch(h.base + '/v1/attestation/report', { headers: { 'x-forwarded-for': 'spoofed-ip' } })).status, 429);
  assert.equal((await fetch(h.base + '/v1/attestation/report', { headers: { authorization: `Bearer ${h.key}` } })).status, 200);
  now += 60_001;
  assert.equal((await fetch(h.base + '/v1/attestation/report')).status, 200);
});

test('a configured client IP header gives each tunnel client its own bucket', async t => {
  const h = await harness({ clientIpHeader: 'CF-Connecting-IP' }); t.after(h.close);
  const read = (ip?: string) => fetch(h.base + '/v1/attestation/report', { headers: ip ? { 'cf-connecting-ip': ip } : {} });
  for (let i = 0; i < 30; i++) assert.equal((await read('203.0.113.1')).status, 200);
  assert.equal((await read('203.0.113.1')).status, 429);
  assert.equal((await read('203.0.113.2')).status, 200);
  assert.equal((await read()).status, 200);
});

test('meter handles arbitrary byte boundaries and reservation fallback on malformed metadata', () => {
  const meter = new Meter(true);
  const bytes = fixture('stream.sse');
  for (const byte of bytes) meter.push(Buffer.from([byte]));
  meter.finish();
  assert.equal(meter.chatId, 'chatcmpl-stream');
  assert.deepEqual(meter.usage, { prompt_tokens: 10, completion_tokens: 3 });
  const malformed = new Meter(false);
  malformed.push(Buffer.from('{"id":"missing-usage","usage":{"prompt_tokens":-1,"completion_tokens":3}}')); malformed.finish();
  assert.equal(malformed.usage, undefined);
  assert.equal(costMicro(1, 0, 1n, 0n), 1n);
});

test('a failing debit is resent with a doubling delay, while the free confirmation read still runs every pass', async t => {
  let clock = 1_000_000;
  const h = await harness({ now: () => clock, retryMs: 2000 }); t.after(h.close);
  h.connector.beforeFailures = 3;
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: raw() })).arrayBuffer();
  await eventually(() => h.connector.debitCalls === 1);
  for (let i = 0; i < 5; i++) await h.gateway.retryDebits();
  assert.equal(h.connector.debitCalls, 1);
  clock += 2000; await h.gateway.retryDebits(); await h.gateway.retryDebits(); assert.equal(h.connector.debitCalls, 2);
  clock += 3999; await h.gateway.retryDebits(); assert.equal(h.connector.debitCalls, 2);
  clock += 1; await h.gateway.retryDebits(); assert.equal(h.connector.debitCalls, 3);
  clock += 8000; await h.gateway.retryDebits(); assert.equal(h.connector.debitCalls, 4);
  await h.gateway.retryDebits();
  assert.equal(h.gateway.state(USER).pending, 0); assert.equal(h.connector.accounts.get(USER)!.spent, 13n);
});
