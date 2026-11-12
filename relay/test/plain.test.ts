import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, fixture, USER, settle } from './harness.ts';

// Standard mode: what an ordinary OpenAI client sends, with only a base URL and an API key.
const body = (overrides: Record<string, unknown> = {}) => {
  const value: Record<string, unknown> = { ...JSON.parse(fixture('chat.json').toString()), ...overrides };
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return JSON.stringify(value);
};
const sentUpstream = (h: Awaited<ReturnType<typeof harness>>) => h.requests.filter(r => r.path === '/v1/chat/completions').map(r => JSON.parse(r.body.toString()));

test('standard mode: a plain OpenAI request is served with only an API key, and charged like any other', async t => {
  const h = await harness(); t.after(h.close);
  const plain = { authorization: `Bearer ${h.key}`, 'content-type': 'application/json' };
  const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: plain, body: body() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), JSON.parse(fixture('response.json').toString()));
  const upstream = h.requests.find(r => r.path === '/v1/chat/completions')!;
  assert.equal(upstream.headers.authorization, 'Bearer fixture-upstream-key'); // the caller's key never goes upstream
  assert.equal(upstream.headers['x-encryption-version'], undefined);
  assert.deepEqual(JSON.parse(upstream.body.toString()), JSON.parse(body()));
  await settle(h.gateway);
  assert.equal(h.connector.accounts.get(USER)!.spent, 13n);
  assert.equal(h.connector.receipts.get('fixture-inference')!.source, 'signed_usage');
});

test('standard mode fills in what billing needs: an output limit and usage on streams', async t => {
  const h = await harness(); t.after(h.close);
  const plain = { authorization: `Bearer ${h.key}`, 'content-type': 'application/json' };
  const send = (overrides: Record<string, unknown>) => fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: plain, body: body(overrides) }).then(async r => { await r.arrayBuffer(); return r.status; });
  h.respond({ id: 'plain-{n}' });
  assert.equal(await send({ max_tokens: undefined }), 200);
  assert.equal(await send({ max_tokens: undefined, max_completion_tokens: 7 }), 200);
  assert.equal(await send({ max_tokens: null, stream: true }), 200);
  assert.equal(await send({ stream: true, stream_options: { include_usage: false, other: 1 } }), 200);
  const sent = sentUpstream(h);
  assert.equal(sent[0].max_tokens, 100); // the relay's configured cap
  assert.equal(sent[1].max_tokens, 7); assert.equal('max_completion_tokens' in sent[1], false);
  assert.equal(sent[2].max_tokens, 100); assert.deepEqual(sent[2].stream_options, { include_usage: true });
  assert.deepEqual(sent[3].stream_options, { include_usage: true, other: 1 });
  await settle(h.gateway);
});

test('standard mode keeps the same refusals: token cap, n, unknown model, no credits, bad key', async t => {
  const h = await harness({ seed: false }); t.after(h.close);
  const plain = { authorization: `Bearer ${h.key}`, 'content-type': 'application/json' };
  const status = (overrides: Record<string, unknown>, headers: Record<string, string> = plain) =>
    fetch(h.base + '/v1/chat/completions', { method: 'POST', headers, body: body(overrides) }).then(async r => { await r.arrayBuffer(); return r.status; });
  assert.equal(await status({ max_tokens: 101 }), 400);
  assert.equal(await status({ max_completion_tokens: 101, max_tokens: undefined }), 400);
  assert.equal(await status({ n: 2 }), 400);
  assert.equal(await status({ model: 'fixture/external' }), 404);
  assert.equal(await status({}), 402); // this user has no credits
  assert.equal(await status({}, { 'content-type': 'application/json' }), 401);
  assert.equal(sentUpstream(h).length, 0);
});
