import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { HttpRequestError } from 'viem';
import { Gateway } from '../src/gateway/ledger.ts';
import { MAX_BODY_BYTES } from '../src/gateway/server.ts';
import { ExpiringMap, MAX_ANONYMOUS_ENTRIES } from '../src/gateway/expiring-map.ts';
import { Meter, inferenceId } from '../src/gateway/meter.ts';
import { Upstream } from '../src/gateway/upstream.ts';
import { Keeper } from '../src/keeper/keeper.ts';
import { reportError } from '../src/types.ts';
import { harness, fixture, USER, VAULT, settle, eventually } from './harness.ts';

test('CR1-1: live catalog field names admit attested text models and exclude image/external/alias models', async t => {
  const h = await harness(); t.after(h.close);
  const rows = JSON.parse(fixture('models.json').toString()).models;
  assert.deepEqual(rows[0].metadata.architecture, { inputModalities: ['text'], outputModalities: ['text'] });
  assert.equal(rows[0].metadata.architecture.input, undefined);
  assert.deepEqual((await h.gateway.upstream.models()).map(model => model.id), ['fixture/tee']);
  const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: fixture('chat.json') });
  assert.equal(response.status, 200); await response.arrayBuffer(); await settle(h.gateway);
  assert.equal(h.connector.accounts.get(USER)!.spent, 13n);
});

test('CR1-2: failed revoke cannot mint a future epoch or revive a revoked key after a current-read restart', async t => {
  const h = await harness(); t.after(h.close);
  const bump = h.connector.bumpKeyEpoch.bind(h.connector);
  h.connector.bumpKeyEpoch = async () => { throw new Error('fixture revoke rejected before landing'); };
  await assert.rejects(h.gateway.revoke(USER));
  await assert.rejects(h.gateway.authenticate(`Bearer ${h.key}`), { status: 401 });
  await assert.rejects(h.gateway.issue(USER), { status: 503, code: 'revocation_pending' });
  // Repeat the failure: an unconfirmed rejection target must not advance again.
  await assert.rejects(h.gateway.revoke(USER));
  assert.equal(h.gateway.state(USER).key_epoch, 1);
  h.connector.bumpKeyEpoch = bump;
  assert.equal((await h.gateway.revoke(USER)).key_epoch, 1);
  const issued = await h.gateway.issue(USER);
  assert.equal(issued.key_epoch, 1);
  assert.equal((await h.gateway.revoke(USER)).key_epoch, 2);
  const restarted = new Gateway({ auth: h.auth, upstream: h.gateway.upstream, connector: h.connector, maxTokens: 100, report: () => {} });
  await assert.rejects(restarted.authenticate(`Bearer ${issued.key}`), { status: 401 });
});

test('CR1-2: landed-but-timed-out revoke allows issuance only after a confirming read', async t => {
  const h = await harness(); t.after(h.close);
  const bump = h.connector.bumpKeyEpoch.bind(h.connector);
  h.connector.bumpKeyEpoch = async user => { await bump(user); throw new Error('fixture timeout after landing'); };
  h.connector.accountOverride = { credited: 1000000n, spent: 0n, available: 1000000n, key_epoch: 0 };
  await assert.rejects(h.gateway.revoke(USER));
  await assert.rejects(h.gateway.issue(USER), { code: 'revocation_pending' });
  h.connector.accountOverride = undefined;
  const issued = await h.gateway.issue(USER);
  assert.equal(issued.key_epoch, 1);
  h.connector.bumpKeyEpoch = bump;
  await h.gateway.revoke(USER);
  await assert.rejects(h.gateway.authenticate(`Bearer ${issued.key}`), { status: 401 });
});

test('CR1-3: Connection nominations cannot strip any required E2EE header after admission', async t => {
  const h = await harness(); t.after(h.close);
  for (const name of ['X-Encryption-Version', 'X-Signing-Algo', 'X-Client-Pub-Key', 'X-Model-Pub-Key', 'X-Encrypt-All-Fields', 'X-No-Aliasing']) {
    // Raw HTTP is intentional: Fetch normalizes away caller Connection nominations.
    const response = await postHeaders(h.base, '/v1/chat/completions', { ...h.headers, connection: `keep-alive, ${name}` }, [fixture('chat.json')]);
    assert.equal(response.status, 400, name);
    assert.equal(h.gateway.state(USER).reserved, 0n);
    assert.equal(h.gateway.state(USER).active, 0);
  }
  assert.equal(h.requests.filter(r => r.path.includes('/chat/')).length, 0);
});

test('CR1-4 / Flex1-3: gateway, keeper and retries classify errors without logging credential URLs or request fragments', async t => {
  const h = await harness(); t.after(h.close);
  const secret = 'DO_NOT_LOG_FIXTURE_SECRET';
  const failure = new HttpRequestError({ url: `https://user:${secret}@rpc.invalid/?api_key=${secret}`, body: { request: secret } });
  const events: unknown[] = [];
  const report = (event: string, details: Record<string, unknown>) => { events.push({ event, details }); };
  reportError(report, 'parser', new SyntaxError(`Unexpected token '${secret}'`));
  const hostile = new Error(secret); hostile.name = `https://user:${secret}@rpc.invalid`;
  reportError(report, 'hostile_name', hostile);
  const storage = h.connector.storageBalance.bind(h.connector);
  h.connector.storageBalance = async () => { throw failure; };
  const keeper = new Keeper([{ id: VAULT, async skim() { throw failure; }, async snapshot() { throw failure; } }],
    h.connector, { async tick() { throw failure; } }, report);
  await keeper.tick();
  h.connector.storageBalance = storage;
  const models = h.gateway.upstream.models.bind(h.gateway.upstream);
  h.gateway.upstream.models = async () => { throw failure; };
  assert.equal((await fetch(h.base + '/v1/models')).status, 503);
  h.gateway.upstream.models = models;
  assert.equal((await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: secret })).status, 400);
  const readDebit = h.connector.debitedAmount.bind(h.connector);
  h.connector.debitedAmount = async () => { throw failure; };
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: fixture('chat.json') })).arrayBuffer();
  await h.gateway.retryDebits();
  await eventually(() => h.events.some(event => event.event === 'debit_retry'));
  const logged = JSON.stringify([...events, ...h.events]);
  assert.ok(!logged.includes(secret)); assert.ok(!logged.includes('rpc.invalid')); assert.ok(!logged.includes('https://'));
  assert.ok(events.length >= 5);
  h.connector.debitedAmount = readDebit; await settle(h.gateway);
});

function postHeaders(base: string, path: string, headers: Record<string, string>, chunks: Buffer[] = []): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const client = request(base + path, { method: 'POST', headers }, response => {
      const parts: Buffer[] = [];
      response.on('data', part => parts.push(Buffer.from(part)));
      response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(parts).toString()) }));
    });
    client.on('error', reject);
    for (const chunk of chunks) client.write(chunk);
    client.end();
  });
}

test('CR1-5 / Flex1-2 / Flex2-2: authenticate chat before buffering; declared and chunked bodies above one limit receive 413', async t => {
  const h = await harness(); t.after(h.close);
  // Headers alone must yield 401 without waiting for this advertised body.
  const unauthenticated = await postHeaders(h.base, '/v1/chat/completions', { 'content-length': String(MAX_BODY_BYTES + 1) });
  assert.equal(unauthenticated.status, 401);
  for (const path of ['/v1/chat/completions', '/keys', '/keys/revoke']) {
    const declared = await postHeaders(h.base, path, { ...h.headers, 'content-length': String(MAX_BODY_BYTES + 1) });
    assert.equal(declared.status, 413); assert.equal(declared.body.error.code, 'body_too_large');
    const chunked = await postHeaders(h.base, path, { ...h.headers, 'transfer-encoding': 'chunked' }, [Buffer.alloc(MAX_BODY_BYTES, 32), Buffer.from('overflow')]);
    assert.equal(chunked.status, 413); assert.equal(chunked.body.error.code, 'body_too_large');
  }
  assert.equal(h.gateway.state(USER).reserved, 0n);
  assert.equal(h.requests.filter(r => r.path.includes('/chat/')).length, 0);
  const chat = fixture('chat.json');
  const boundary = Buffer.concat([chat, Buffer.alloc(MAX_BODY_BYTES - chat.length, 32)]);
  const allowed = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: boundary });
  assert.equal(allowed.status, 200); await allowed.arrayBuffer(); await settle(h.gateway);
});

test('CR1-6: null and non-object metadata use the reservation fallback without leaking active slots', async t => {
  const h = await harness(); t.after(h.close);
  for (const [index, value] of ['null', '[]', '42', '"text"'].entries()) {
    const id = `non-object-${index}`;
    h.respond({ body: Buffer.from(value), id });
    await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: fixture('chat.json') })).arrayBuffer();
    await settle(h.gateway);
    assert.equal(h.connector.receipts.get(id)!.source, 'reservation');
    assert.equal(h.gateway.state(USER).active, 0); assert.equal(h.gateway.state(USER).reserved, 0n);
  }
  const original = Meter.prototype.finish;
  t.mock.method(Meter.prototype, 'finish', function(this: Meter) { original.call(this); throw new SyntaxError('fixture unexpected meter failure'); });
  h.respond({ body: fixture('response.json'), id: 'meter-threw' });
  await (await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: fixture('chat.json') })).arrayBuffer();
  await settle(h.gateway);
  assert.equal(h.connector.receipts.get('meter-threw')!.source, 'reservation');
  assert.equal(h.gateway.state(USER).active, 0); assert.equal(h.gateway.state(USER).reserved, 0n);
});

test('CR1-7: deadline before headers forgives, while stalled header/body completions still settle', async t => {
  for (const phase of ['no_headers', 'header_id', 'body_id']) await t.test(phase, async t => {
    const h = await harness({ deadlineMs: 200 }); t.after(h.close);
    let release!: () => void;
    const wait = new Promise<void>(done => { release = done; }); t.after(() => release());
    h.respond(phase === 'no_headers' ? { headersWait: wait } : { wait, stream: true, id: phase === 'header_id' ? 'stalled-header-id' : null });
    const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers,
      body: JSON.stringify({ model: 'fixture/tee', messages: [{ role: 'user', content: 'aabb' }], max_tokens: 10, stream: true, stream_options: { include_usage: true } }) });
    if (phase === 'no_headers') { assert.equal(response.status, 504); await response.arrayBuffer(); }
    else { assert.equal(response.status, 200); await assert.rejects(response.arrayBuffer()); }
    await settle(h.gateway);
    assert.equal(h.gateway.state(USER).active, 0); assert.equal(h.gateway.state(USER).reserved, 0n);
    if (phase === 'no_headers') assert.equal(h.connector.amounts.size, 0);
    else assert.equal(h.connector.receipts.get(phase === 'header_id' ? 'stalled-header-id' : inferenceId('chatcmpl-delayed'))!.source, 'reservation');
  });
});

test('Flex1-1 / Flex2-1: one bounded expiry rule caps nonce and IP maps, preserves live entries and reclaims expired slots', async t => {
  let now = Date.now();
  for (const ttl of [60_000, 300_000]) {
    const map = new ExpiringMap<number>(ttl, () => now);
    for (let i = 0; i < MAX_ANONYMOUS_ENTRIES; i++) map.set(String(i), i);
    assert.throws(() => map.set('overflow', 1), { status: 503 });
    assert.equal(map.get('0'), 0);
    assert.equal(map.delete('0'), true); map.set('replacement', 1);
    now += ttl;
    map.set('after-expiry', 2);
    assert.equal(map.get('replacement'), undefined); assert.equal(map.get('after-expiry'), 2);
  }
  const h = await harness({ now: () => now }); t.after(h.close);
  for (let i = 0; i < MAX_ANONYMOUS_ENTRIES; i++) h.auth.nonce();
  assert.equal((await fetch(h.base + '/auth/nonce')).status, 503);
  now += 300_000;
  assert.equal((await fetch(h.base + '/auth/nonce')).status, 200);
});

test('CR1-7: trickling bytes cannot extend the total upstream deadline', async t => {
  let chunks = 0;
  const server = createServer((_req, res) => {
    res.writeHead(200); res.flushHeaders();
    const timer = setInterval(() => { chunks++; res.write(': keepalive\n\n'); }, 20);
    res.once('close', () => clearInterval(timer));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); });
  const upstream = new Upstream(`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, 'fixture-key', Date.now, 200);
  const response = await upstream.request('/stream', 'GET');
  await assert.rejects(async () => { for await (const _chunk of response) {} }, { code: 'upstream_timeout' });
  assert.ok(chunks >= 2);
});
