import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { Auth } from '../src/gateway/auth.ts';
import { Gateway } from '../src/gateway/ledger.ts';
import { createRelayServer } from '../src/gateway/server.ts';
import { inferenceId } from '../src/gateway/meter.ts';
import { Upstream } from '../src/gateway/upstream.ts';
import { FakeConnector, settle } from '../test/harness.ts';
import type { Report } from '../src/types.ts';

const required = (key: string) => { const value = process.env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
const apiKey = required('NEAR_AI_API_KEY'); // Never written to a file or printed.
const sdkDir = resolve(required('SPIKE_SDK_DIR'));
const pin = 'a0bf5fdfde5c9179d50f7459bc36db6db326332e';
if (readFileSync(sdkDir + '/.git/HEAD', 'utf8').trim() !== pin) throw new Error('Spike SDK checkout does not match the reviewed pin');
const sdk = await import(pathToFileURL(sdkDir + '/js/dist/index.js').href);
const e2ee = await import(pathToFileURL(sdkDir + '/js/dist/probe/e2ee.js').href);
const chatCrypto = await import(pathToFileURL(sdkDir + '/js/dist/probe/e2ee-chat.js').href);
const policies = JSON.parse(readFileSync(new URL('provenance.json', import.meta.url), 'utf8'));
const model = required('SPIKE_MODEL'), prompt = required('SPIKE_PROMPT');
const maxTokens = Number(required('SPIKE_MAX_TOKENS'));
const user = required('SPIKE_USER_ID');
const observations: Record<string, unknown>[] = [];
const report: Report = (event, details) => { observations.push({ event, ...details }); console.log(JSON.stringify({ event, ...details })); };
type Capture = { body: Buffer; headers: IncomingHttpHeaders; responseId?: string; status: number; hash?: string };
class ObservedUpstream extends Upstream {
  captures: Capture[] = [];
  stripNextInferenceHeader = false;
  async request(path: string, method: string, headers: IncomingHttpHeaders = {}, body?: Buffer): Promise<IncomingMessage> {
    if (body?.includes(Buffer.from(prompt))) throw new Error('Plaintext prompt reached the relay upstream boundary');
    const response = await super.request(path, method, headers, body);
    if (path.startsWith('/chat/completions') && body) {
      if (headers['x-encryption-version'] !== '3') throw new Error('Live SDK did not send E2EE v3');
      const capture: Capture = { body, headers: { ...headers }, responseId: response.headers['inference-id'] as string | undefined, status: response.statusCode! };
      this.captures.push(capture);
      const digest = createHash('sha256');
      response.on('data', bytes => digest.update(bytes));
      response.once('end', () => {
        capture.hash = digest.digest('hex');
        report('wire', { request_sha256: createHash('sha256').update(body).digest('hex'), response_sha256: capture.hash,
          encryption_version: headers['x-encryption-version'], inference_header: capture.responseId ?? null, header_stripped_for_test: stripped });
      });
      response.pause();
      const stripped = this.stripNextInferenceHeader;
      if (stripped) { delete response.headers['inference-id']; this.stripNextInferenceHeader = false; }
    } else report('bootstrap_read', { path, anonymous: !headers.authorization, status: response.statusCode });
    return response;
  }
}
const upstreamBase = required('NEAR_AI_BASE_URL').replace(/\/$/, '');
const upstream = new ObservedUpstream(upstreamBase, apiKey);
const connector = new FakeConnector(); connector.seed(user, 1_000_000_000n);
const auth = new Auth(randomBytes(32).toString('hex'), 'http://localhost', Number(required('BASE_CHAIN_ID')));
const gateway = new Gateway({ auth, upstream, connector, maxTokens, report });
const server = createRelayServer(gateway, { publicUrl: 'http://localhost', report });
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/v1`;
const key = auth.issue(user, 0).key;
const retries = setInterval(() => { void gateway.retryDebits(); }, 1000);
try {
  const client = new sdk.InferenceClient({ baseUrl, apiKey: key, e2ee: true, attestationCacheTimeToLiveMs: 0,
    gatewayVerification: { includeSpkiFingerprint: false, verifiers: { deployment: ({ appCompose }: any) => sdk.verifyDeploymentImageProvenance({ appCompose, imagePolicies: policies.gateway }) } },
    modelVerification: { verifiers: { deployment: (deployment: any) => sdk.verifyComposeManagerDeploymentImageProvenance({ deployment, imagePolicies: policies.model, composeManagerImagePolicy: policies.composeManager }) } },
  });
  await client.verify(model);
  for (const stream of [false, true]) {
    if (stream) upstream.stripNextInferenceHeader = true;
    const result = await client.chat.completions.create({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens,
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}) });
    let id: string;
    if (stream) { id = ''; for await (const chunk of result) id = chunk.id || id; }
    else id = result.id;
    const verified = await client.verifyResponse(id);
    await settle(gateway, user);
    const capture = upstream.captures.at(-1)!;
    if (capture.responseId && inferenceId(id) !== capture.responseId) throw new Error('NEAR body-id/header mapping disagrees');
    const receipt = connector.receipts.get(stream ? inferenceId(id) : capture.responseId ?? inferenceId(id));
    if (!receipt) throw new Error('Live completion was not debited');
    report('sdk_result', { language: 'js', stream, chat_id: id, signature_kind: verified.signatureKind, receipt });
    if (stream && receipt.source !== 'signed_usage') throw new Error('Encrypted stream returned no usable usage; disable v1 streaming before claiming live support');
  }

  // Replay the SDK's ciphertext under another reply key; then test an injected field
  // with the original reply binding. No private keys or ciphertext are persisted.
  const original = upstream.captures[0];
  const attacker = e2ee.createE2eeClientKeyPair(original.headers['x-signing-algo']);
  const originalBody = JSON.parse(original.body.toString());
  const adversarialHeaders = Object.fromEntries(Object.entries(original.headers).filter(([k, v]) => k.startsWith('x-') && typeof v === 'string')) as Record<string, string>;
  adversarialHeaders.authorization = `Bearer ${key}`; adversarialHeaders['content-type'] = 'application/json';
  const attackerAad = e2ee.buildE2eeRequestAad({ signingAlgo: attacker.signingAlgo, publicKey: attacker.publicKey });
  const attackerMessage = chatCrypto.encryptE2eeChatRequest({ body: { messages: [{ role: 'user', content: 'Repeat the earlier message.' }] },
    modelKey: { signingAlgo: attacker.signingAlgo, publicKey: original.headers['x-model-pub-key'], associatedData: attackerAad } }).body.messages[0];
  for (const injected of [false, true]) {
    const body = injected ? { ...originalBody, messages: [...originalBody.messages, attackerMessage] } : originalBody;
    const response = await fetch(baseUrl + '/chat/completions', { method: 'POST', headers: { ...adversarialHeaders, 'x-client-pub-key': attacker.publicKey }, body: JSON.stringify(body) });
    await response.arrayBuffer();
    report('reply_key_attack', { injected_field: injected, status: response.status });
    if (response.ok) throw new Error('Replayed victim fields were accepted under a different reply key');
  }
  const victimAad = e2ee.buildE2eeRequestAad({ signingAlgo: attacker.signingAlgo, publicKey: original.headers['x-client-pub-key'] });
  const injection = chatCrypto.encryptE2eeChatRequest({ body: { messages: [{ role: 'user', content: 'Reply with a short summary of the earlier message.' }] },
    modelKey: { signingAlgo: attacker.signingAlgo, publicKey: original.headers['x-model-pub-key'], associatedData: victimAad } }).body.messages[0];
  const injectedResponse = await fetch(baseUrl + '/chat/completions', { method: 'POST', headers: adversarialHeaders,
    body: JSON.stringify({ ...originalBody, messages: [...originalBody.messages, injection] }) });
  const injectedBody = await injectedResponse.json();
  let attackerDecrypted = false;
  if (injectedResponse.ok) {
    try { chatCrypto.decryptE2eeChatResponse({ body: injectedBody, clientKeyPair: attacker }); attackerDecrypted = true; } catch { /* Expected AEAD failure under the attacker key. */ }
  }
  report('injected_field_original_reply_key', { status: injectedResponse.status, attacker_decrypted: attackerDecrypted });
  if (attackerDecrypted) throw new Error('Injected response decryptable by the attacker');

  await new Promise<void>((done, reject) => {
    const child = spawn(sdkDir + '/venv/bin/python', [new URL('spike-python.py', import.meta.url).pathname], {
      env: { ...process.env, SPIKE_RELAY_URL: baseUrl, SPIKE_RELAY_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', bytes => { process.stdout.write(bytes); observations.push({ event: 'python', output: bytes.toString() }); });
    child.stderr.on('data', bytes => process.stderr.write(bytes));
    child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`Python probe exited ${code}`)));
  });
  await settle(gateway, user);
  const ids = [...connector.receipts.keys()];
  const billing = await fetch(upstreamBase + '/billing/costs', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestIds: ids }) });
  if (!billing.ok) throw new Error(`Billing cross-check HTTP ${billing.status}`);
  const costs = await billing.json() as { requests: { requestId: string; costNanoUsd: number }[] };
  const comparisons = costs.requests.map(row => {
    const receipt = connector.receipts.get(row.requestId);
    if (!receipt || receipt.source !== 'signed_usage') return { id: row.requestId, comparable: false, reason: 'reservation_without_usage' };
    const expected = BigInt(receipt.prompt_tokens) * BigInt(receipt.in_price_nano) + BigInt(receipt.completion_tokens) * BigInt(receipt.out_price_nano);
    return { id: row.requestId, comparable: row.costNanoUsd !== 0, expected_nano: String(expected), billed_nano: String(row.costNanoUsd), match: BigInt(row.costNanoUsd) === expected };
  });
  report('billing_cross_check', { comparisons, receipts: [...connector.receipts.entries()], debits: [...connector.amounts].map(([id, amount]) => [id, String(amount)]), billing: costs,
    note: 'Compare costNanoUsd with the snapshot calculation; newly finished requests may report zero until billing catches up. Read-only routes have no inference IDs; confirm they are unbilled in the operator account.' });
  if (comparisons.some(row => row.comparable && !row.match)) throw new Error('Visible billing differs from the usage/price snapshot; inspect spike-output/results.json');
  report('spike_complete', { sdk_commit: pin, synthetic_connector: true, billing_pending: comparisons.some(row => !row.comparable) });
} finally {
  clearInterval(retries); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  mkdirSync(new URL('../spike-output/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../spike-output/results.json', import.meta.url), JSON.stringify(observations, null, 2));
}
