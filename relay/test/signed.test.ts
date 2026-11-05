import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { baseEncode } from 'near-api-js';
import { hexToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MAX_BODY_BYTES } from '../src/gateway/server.ts';
import { harness } from './harness.ts';

const wallet = privateKeyToAccount('0x' + '23'.repeat(32) as `0x${string}`);
const wrongWallet = privateKeyToAccount('0x' + '24'.repeat(32) as `0x${string}`);
const now = Date.parse('2026-11-05T00:00:00Z');
const withdrawPayload = (overrides = {}) => JSON.stringify({ action: 'withdraw', network: 'mainnet', vault: 'vault.near',
  user: `eip155:8453:${wallet.address.toLowerCase()}`, amount: '1000000', nonce: 0, expires_at: now / 1000 + 60, ...overrides });
async function withdrawal(message = withdrawPayload(), signer = wallet) { return { message, signature: await signer.signMessage({ message }) }; }
async function intent(overrides = {}, signer = wallet) {
  const payload = JSON.stringify({ signer_id: wallet.address.toLowerCase(), verifying_contract: 'intents.near',
    deadline: new Date(now + 60_000).toISOString(), nonce: Buffer.alloc(32, 7).toString('base64'),
    intents: [{ intent: 'transfer', receiver_id: 'quote.near', tokens: { 'nep141:usdc.near': '1000000' } }], ...overrides });
  const bytes = hexToBytes(await signer.signMessage({ message: payload }));
  bytes[64] -= 27; // The verifier's base58 signature uses recovery id 0/1, not wallet v=27/28.
  return { signed: [{ standard: 'erc191', payload, signature: 'secp256k1:' + baseEncode(bytes) }] };
}
function operations() {
  const calls: unknown[] = [];
  return { calls, async withdraw(message: string, signature: string) { calls.push({ message, signature }); return { tx_hash: 'withdraw-tx' }; },
    async executeIntents(signed: unknown[]) { calls.push({ signed }); return { tx_hash: 'intent-tx' }; } };
}
const post = (base: string, path: string, body: unknown, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('signed routes preserve authenticated bytes and discard unsigned transaction fields', async t => {
  const ops = operations(), h = await harness({ now: () => now, signedOperations: ops }); t.after(h.close);
  const request = await withdrawal();
  const response = await post(h.base, '/rhea/withdraw', { ...request, receiver_id: 'attacker.near', amount: '999', deposit: '100' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { tx_hash: 'withdraw-tx' });
  assert.deepEqual(ops.calls[0], request);
  const signed = await intent();
  const execute = await post(h.base, '/intents/execute', { ...signed, receiver_id: 'attacker.near', deposit: '100' });
  assert.equal(execute.status, 200); assert.deepEqual(await execute.json(), { tx_hash: 'intent-tx' });
  assert.deepEqual(ops.calls[1], signed);
});

test('withdraw rejects bad signature, expired, wrong network/vault/user and malformed proofs before spending gas', async t => {
  const ops = operations(), h = await harness({ now: () => now, signedOperations: ops }); t.after(h.close);
  const invalid: unknown[] = [null, {}, await withdrawal(withdrawPayload(), wrongWallet),
    await withdrawal(withdrawPayload({ expires_at: now / 1000 - 1 })), await withdrawal(withdrawPayload({ vault: 'other.near' })),
    await withdrawal(withdrawPayload({ network: 'testnet' })), await withdrawal(withdrawPayload({ user: `eip155:1:${wallet.address.toLowerCase()}` })),
    await withdrawal(withdrawPayload({ amount: '0' })), await withdrawal(withdrawPayload({ nonce: -1 })),
    { ...(await withdrawal()), signature: '0x00' }];
  for (const request of invalid) {
    const response = await post(h.base, '/rhea/withdraw', request);
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'invalid_signed_request');
  }
  assert.deepEqual(ops.calls, []);
});

test('intent rejects bad or missing signature/expiry, wrong verifier and non-ERC191 before spending gas', async t => {
  const ops = operations(), h = await harness({ now: () => now, signedOperations: ops }); t.after(h.close);
  const badStandard = await intent(); badStandard.signed[0].standard = 'nep413';
  const invalid = [null, { signed: [] }, await intent({}, wrongWallet), await intent({ deadline: new Date(now - 1).toISOString() }),
    await intent({ deadline: null }), await intent({ verifying_contract: 'other.near' }), badStandard,
    { signed: [{ standard: 'erc191', payload: '{}', signature: 'secp256k1:bad' }] },
    { signed: [{ standard: 'erc191', payload: '{}', signature: 'secp256k1:' + 'z'.repeat(100_000) }] }];
  for (const request of invalid) {
    const response = await post(h.base, '/intents/execute', request);
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'invalid_signed_request');
  }
  // A valid first member must not cause partial submission if another signature is invalid.
  const first = await intent(), bad = await intent({}, wrongWallet);
  assert.equal((await post(h.base, '/intents/execute', { signed: [...first.signed, ...bad.signed] })).status, 400);
  assert.deepEqual(ops.calls, []);
});

for (const path of ['/rhea/withdraw', '/intents/execute']) {
  test(`${path} rejects oversized bodies before calling NEAR`, async t => {
    const ops = operations(), h = await harness({ now: () => now, signedOperations: ops }); t.after(h.close);
    const response = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const client = request(h.base + path, { method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 1) } }, response => {
        const chunks: Buffer[] = []; response.on('data', part => chunks.push(Buffer.from(part)));
        response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      client.on('error', reject); client.end();
    });
    assert.equal(response.status, 413); assert.equal(response.body.error.code, 'body_too_large');
    assert.deepEqual(ops.calls, []);
  });
}

test('new routes share the read IP bucket, ignore forwarded IPs, enforce limit with a valid API key and reset after a minute', async t => {
  let clock = now;
  const ops = operations(), h = await harness({ now: () => clock, signedOperations: ops }); t.after(h.close);
  for (let i = 0; i < 28; i++) assert.equal((await fetch(h.base + '/v1/attestation/report')).status, 200);
  const withdraw = await withdrawal(), signed = await intent();
  assert.equal((await post(h.base, '/rhea/withdraw', withdraw)).status, 200);
  assert.equal((await post(h.base, '/intents/execute', signed)).status, 200);
  for (const path of ['/rhea/withdraw', '/intents/execute']) {
    const response = await post(h.base, path, path === '/rhea/withdraw' ? withdraw : signed,
      { authorization: `Bearer ${h.key}`, 'x-forwarded-for': '203.0.113.99' });
    assert.equal(response.status, 429);
  }
  assert.equal((await fetch(h.base + '/v1/attestation/report')).status, 429);
  assert.equal(ops.calls.length, 2);
  clock += 60_001;
  // Fresh proofs have longer deadlines for the new bucket window.
  assert.equal((await post(h.base, '/rhea/withdraw', await withdrawal(withdrawPayload({ expires_at: clock / 1000 + 60 | 0 })))).status, 200);
});
