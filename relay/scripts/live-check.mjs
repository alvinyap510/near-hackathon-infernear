// Reproduces the live flow with no wallet of your own: a throwaway key signs in to the public
// relay, receives an API key, and makes one free trial call to a NEAR AI TEE model.
// It sends no transaction and needs no funds. It uses one of the day's shared free calls.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';

const api = (process.env.INFERNEAR_API_URL ?? 'https://api.infernear.dev').replace(/\/$/, '');
const site = new URL(process.env.INFERNEAR_APP_URL ?? 'https://app.infernear.dev');
const fail = (step, detail) => { console.log(`FAIL  ${step}: ${detail}`); process.exit(1); };
const json = async response => response.json().catch(() => ({}));

const models = await json(await fetch(`${api}/v1/models`));
if (!Array.isArray(models.data) || !models.data.length) fail('models', 'no model list');
console.log(`ok    ${models.data.length} models listed, each with inputCostPerToken and outputCostPerToken`);

const wallet = privateKeyToAccount(generatePrivateKey());
const { nonce } = await json(await fetch(`${api}/auth/nonce`));
const now = new Date();
const message = createSiweMessage({ address: wallet.address, chainId: 8453, domain: site.host, uri: site.origin, version: '1', nonce,
  issuedAt: now, expirationTime: new Date(now.getTime() + 5 * 60_000), statement: 'Authorize one InferNear API key action.' });
const issued = await fetch(`${api}/keys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature: await wallet.signMessage({ message }) }) });
const key = (await json(issued)).key;
if (!key) fail('key', `HTTP ${issued.status}`);
console.log(`ok    throwaway wallet ${wallet.address.slice(0, 10)}… signed in and received an API key`);

const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const before = await json(await fetch(`${api}/v1/free-calls`, { headers }));
console.log(`ok    free trial calls for this wallet: ${before.remaining} of ${before.per_user}`);
if (!before.remaining) fail('free calls', "none left: today's shared allowance is used up, or trials are switched off");

const model = process.env.INFERNEAR_MODEL ?? 'Qwen/Qwen3-VL-30B-A3B-Instruct';
const call = await fetch(`${api}/v1/chat/completions`, { method: 'POST', headers,
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 64 }) });
const completion = await json(call);
if (call.status !== 200) fail('chat', `HTTP ${call.status} ${JSON.stringify(completion.error ?? {})}`);
console.log(`ok    ${model} replied ${JSON.stringify(completion.choices?.[0]?.message?.content)} ` +
  `(prompt ${completion.usage?.prompt_tokens}, completion ${completion.usage?.completion_tokens} tokens)`);
console.log(`ok    billing: ${call.headers.get('x-infernear-billing')}, inference id ${call.headers.get('inference-id')}`);
const after = await json(await fetch(`${api}/v1/free-calls`, { headers }));
console.log(`ok    free trial calls left: ${after.remaining}`);
if (call.headers.get('x-infernear-billing') !== 'free' || after.remaining !== before.remaining - 1) fail('billing', 'the call was not counted as one free trial call');
console.log('PASS  sign-in, key issue and one free call to a NEAR AI TEE model on the live relay');
