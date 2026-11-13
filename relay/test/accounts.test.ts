// Accounts: handle, UID and linked wallets. Local keys, a temporary directory and fake NEAR key reads only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { baseEncode } from 'near-api-js';
import { createSiweMessage } from 'viem/siwe';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { Accounts, statements, type Account } from '../src/gateway/accounts.ts';
import { KEY_STATEMENT } from '../src/gateway/auth.ts';
import { harness, settle } from './harness.ts';

type Signer = { id: string; proof(nonce: string, statement: string, now: number): Promise<Record<string, unknown>> };
const evm = (): Signer => {
  const wallet = privateKeyToAccount(generatePrivateKey());
  return { id: `eip155:8453:${wallet.address.toLowerCase()}`, async proof(nonce, statement, now) {
    const message = createSiweMessage({ address: wallet.address, chainId: 8453, domain: 'relay.test', uri: 'http://relay.test', version: '1', nonce,
      issuedAt: new Date(now), expirationTime: new Date(now + 300_000), statement });
    return { message, signature: await wallet.signMessage({ message }) };
  } };
};
const near = (accountId: string): Signer => {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = 'ed25519:' + baseEncode(pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const text = (value: string) => { const bytes = Buffer.from(value), size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); return Buffer.concat([size, bytes]); };
  return { id: `near:mainnet:${accountId}`, async proof(nonce, statement, now) {
    const message = JSON.stringify({ statement, account_id: accountId, nonce, expires_at: Math.floor(now / 1000) + 300 });
    const nonce32 = createHash('sha256').update(nonce).digest(), tag = Buffer.alloc(4); tag.writeUInt32LE(2147484061);
    const digest = createHash('sha256').update(Buffer.concat([tag, text(message), nonce32, text('relay.test'), Buffer.from([0])])).digest();
    return { near: { account_id: accountId, public_key: publicKey, signature: sign(null, digest, pair.privateKey).toString('base64'), message, nonce: nonce32.toString('base64'), recipient: 'relay.test' } };
  } };
};
async function setup(t: { after(fn: () => unknown): void }, enabled = true, options: Parameters<typeof harness>[0] = {}) {
  const clock = { now: Date.now() };
  const directory = await mkdtemp(join(tmpdir(), 'infernear-accounts-'));
  const events: string[] = [];
  const accounts = enabled ? await Accounts.open(directory, event => events.push(event), () => clock.now) : undefined;
  const h = await harness({ now: () => clock.now, nearKey: async () => true, accounts, ...options });
  t.after(h.close);
  const send = async (path: string, signer: Signer, statement: string, extra: Record<string, unknown> = {}) => {
    const nonce = (await (await fetch(h.base + '/auth/nonce')).json()).nonce as string;
    const response = await fetch(h.base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...extra, ...await signer.proof(nonce, statement, clock.now) }) });
    return { status: response.status, body: await response.json() as { account?: Account | null; error?: { code: string }; ticket?: string; key?: string } };
  };
  const create = (signer: Signer, handle: string) => send('/accounts', signer, statements.create(handle), { handle });
  const link = async (member: Signer, joiner: Signer, handle: string) => {
    const started = await send('/accounts/link/start', member, statements.invite(handle), { handle });
    return send('/accounts/link', joiner, statements.join(handle), { ticket: started.body.ticket });
  };
  return { h, clock, directory, events, send, create, link, accounts: accounts! };
}

test('accounts are off without a data directory: routes answer 404 and key issue is unchanged', async t => {
  const { h, send } = await setup(t, false), alice = evm();
  for (const path of ['/accounts', '/accounts/me', '/accounts/link/start', '/accounts/link', '/accounts/unlink']) {
    const response = await send(path, alice, statements.signIn, { handle: 'alice' });
    assert.deepEqual([response.status, response.body.error?.code], [404, 'accounts_disabled']);
  }
  const issued = await send('/keys', alice, KEY_STATEMENT);
  assert.equal(issued.status, 200); assert.equal('account' in issued.body, false);
  assert.equal(h.auth.parse(`Bearer ${issued.body.key}`).account, undefined);
});

test('either wallet type creates an account with a permanent UID, and a handle is unique and well formed', async t => {
  const { send, create } = await setup(t), alice = evm(), bob = near('bob.near');
  const made = await create(alice, 'alice');
  assert.equal(made.status, 201);
  const account = made.body.account!;
  assert.match(account.uid, /^acc_[0-9a-f]{32}$/);
  assert.deepEqual([account.handle, account.wallets, account.avatar_seed], ['alice', [alice.id], account.uid]);
  assert.deepEqual((await send('/accounts/me', alice, statements.signIn)).body.account, account);
  assert.equal((await send('/accounts/me', bob, statements.signIn)).body.account, null);
  assert.deepEqual((await create(bob, 'bob-near_1')).body.account!.wallets, [bob.id]);
  assert.equal((await create(evm(), 'alice')).body.error?.code, 'handle_taken');
  const again = await create(alice, 'second');
  assert.deepEqual([again.status, again.body.error?.code, again.body.account], [409, 'account_exists', account]);
  for (const handle of ['ab', 'a'.repeat(21), 'Alice', '-alice', 'alice-', 'al ice', 'admin', 'near', 7])
    assert.deepEqual([(await send('/accounts', evm(), statements.create(String(handle)), { handle })).body.error?.code, handle], ['invalid_handle', handle]);
});

test('a signature made for one action is refused for every other', async t => {
  const { send, create } = await setup(t), alice = evm(), mallory = evm();
  await create(alice, 'alice');
  assert.equal((await send('/keys', alice, statements.signIn)).status, 401);
  assert.equal((await send('/keys/revoke', alice, statements.signIn)).status, 401);
  assert.equal((await send('/accounts/me', alice, KEY_STATEMENT)).status, 401);
  assert.equal((await send('/accounts', mallory, statements.signIn, { handle: 'mallory' })).status, 401);
  assert.equal((await send('/accounts', mallory, statements.create('other'), { handle: 'mallory' })).status, 401);
  assert.equal((await send('/accounts/link/start', alice, statements.signIn, { handle: 'alice' })).status, 401);
  assert.equal((await send('/accounts/unlink', alice, statements.invite('alice'), { handle: 'alice' })).status, 401);
  // A wallet outside the account cannot invite into it, even with a correctly worded signature.
  assert.equal((await send('/accounts/link/start', mallory, statements.invite('alice'), { handle: 'alice' })).body.error?.code, 'no_account');
});

test('linking needs both wallets: a member invites, the new wallet joins, and the UID and avatar seed stay fixed', async t => {
  const { send, create, link, clock } = await setup(t), alice = evm(), bob = near('bob.near'), carol = evm();
  const account = (await create(alice, 'alice')).body.account!;
  const started = await send('/accounts/link/start', alice, statements.invite('alice'), { handle: 'alice' });
  assert.equal(started.status, 200); assert.match(started.body.ticket!, /^ilt_/);
  // The joining wallet must sign for this handle; the ticket alone is not enough.
  assert.equal((await send('/accounts/link', bob, statements.join('other'), { ticket: started.body.ticket })).status, 401);
  assert.equal((await send('/accounts/link', bob, statements.signIn, { ticket: started.body.ticket })).status, 401);
  const joined = await send('/accounts/link', bob, statements.join('alice'), { ticket: started.body.ticket });
  assert.deepEqual([joined.status, joined.body.account], [200, { ...account, wallets: [alice.id, bob.id] }]);
  assert.deepEqual((await send('/accounts/me', bob, statements.signIn)).body.account, joined.body.account);
  // One use, ten minutes, and the relay's own signature.
  assert.equal((await send('/accounts/link', carol, statements.join('alice'), { ticket: started.body.ticket })).body.error?.code, 'invalid_ticket');
  const second = await send('/accounts/link/start', bob, statements.invite('alice'), { handle: 'alice' });
  const [payload, mac] = second.body.ticket!.split('.');
  assert.equal((await send('/accounts/link', carol, statements.join('alice'), { ticket: `${payload}x.${mac}` })).body.error?.code, 'invalid_ticket');
  clock.now += 601_000;
  assert.equal((await send('/accounts/link', carol, statements.join('alice'), { ticket: second.body.ticket })).body.error?.code, 'invalid_ticket');
  // A wallet belongs to one account, and an account holds at most four.
  const dave = evm(); await create(dave, 'dave');
  assert.equal((await link(alice, dave, 'alice')).body.error?.code, 'wallet_linked');
  assert.equal((await link(alice, bob, 'alice')).body.error?.code, 'wallet_linked');
  assert.equal((await link(alice, carol, 'alice')).status, 200);
  assert.equal((await link(alice, evm(), 'alice')).body.account!.wallets.length, 4);
  assert.equal((await send('/accounts/link/start', alice, statements.invite('alice'), { handle: 'alice' })).body.error?.code, 'too_many_wallets');
});

test('a wallet unlinks only itself, the last wallet stays, and an invitation dies with its wallet', async t => {
  const { send, create, link } = await setup(t), alice = evm(), bob = near('bob.near'), carol = evm();
  const account = (await create(alice, 'alice')).body.account!;
  assert.equal((await send('/accounts/unlink', alice, statements.leave('alice'), { handle: 'alice' })).body.error?.code, 'last_wallet');
  await link(alice, bob, 'alice');
  const pending = await send('/accounts/link/start', bob, statements.invite('alice'), { handle: 'alice' });
  const left = await send('/accounts/unlink', bob, statements.leave('alice'), { handle: 'alice' });
  assert.deepEqual(left.body.account, { ...account, wallets: [alice.id] });
  assert.equal((await send('/accounts/me', bob, statements.signIn)).body.account, null);
  assert.equal((await send('/accounts/link', carol, statements.join('alice'), { ticket: pending.body.ticket })).body.error?.code, 'invalid_ticket');
  assert.equal((await create(bob, 'bob')).status, 201);
});

test('the registry survives a restart, and a damaged file is set aside so the relay still starts', async t => {
  const { create, link, directory } = await setup(t), alice = evm(), bob = near('bob.near');
  await create(alice, 'alice');
  const account = (await link(alice, bob, 'alice')).body.account!;
  const reopened = await Accounts.open(directory, () => {});
  assert.deepEqual([reopened.of(alice.id), reopened.of(bob.id), reopened.byId(account.uid)], [account, account, account]);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8')), { version: 1, accounts: [account] });
  await writeFile(join(directory, 'accounts.json'), '{ not json');
  const events: string[] = [];
  const empty = await Accounts.open(directory, event => events.push(event));
  assert.equal(empty.of(alice.id), null); assert.deepEqual(events, ['accounts_store_corrupt']);
  assert.equal((await readdir(directory)).some(name => name.startsWith('accounts.json.corrupt-')), true);
  assert.equal((await empty.create('alice', alice.id)).handle, 'alice');
});

test('key issue reports the account and records its UID in the key', async t => {
  const { h, send, create } = await setup(t), alice = evm(), loner = evm();
  const account = (await create(alice, 'alice')).body.account!;
  const linked = await send('/keys', alice, KEY_STATEMENT);
  assert.deepEqual(linked.body.account, account);
  assert.deepEqual([h.auth.parse(`Bearer ${linked.body.key}`).user, h.auth.parse(`Bearer ${linked.body.key}`).account], [alice.id, account.uid]);
  const alone = await send('/keys', loner, KEY_STATEMENT);
  assert.equal(alone.body.account, null); assert.equal(h.auth.parse(`Bearer ${alone.body.key}`).account, undefined);
});

test('account routes use each nonce once and share the per-IP limit', async t => {
  const { h, clock, send } = await setup(t), alice = evm();
  const nonce = (await (await fetch(h.base + '/auth/nonce')).json()).nonce as string;
  const proof = await alice.proof(nonce, statements.signIn, clock.now);
  const post = () => fetch(h.base + '/accounts/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proof) });
  assert.equal((await post()).status, 200); assert.equal((await post()).status, 401);
  for (let i = 0; i < 28; i++) await post();
  assert.equal((await send('/accounts/me', alice, statements.signIn)).body.error?.code, 'read_rate_limit');
});

// Spending and free trial calls for an account. Wallets are ids here; the registry is filled directly.
const A = 'eip155:8453:0x' + 'a'.repeat(40), B = 'near:mainnet:bob.near', C = 'eip155:8453:0x' + 'c'.repeat(40);
const chat = (base: string, key: string) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'fixture/tee', messages: [{ role: 'user', content: 'Hello' }], max_tokens: 10 }) });
const done = async (response: Response) => { await response.arrayBuffer(); return [response.status, response.headers.get('x-infernear-billing')]; };

test('a key spends from any wallet linked to its account: its own wallet first, one wallet per call', async t => {
  const { h, accounts } = await setup(t, true, { seed: false });
  const account = await accounts.create('alice', A); await accounts.link(account.uid, B);
  const key = h.auth.issue(A, 0, account.uid).key, spent = (wallet: string) => h.connector.accounts.get(wallet)?.spent ?? 0n;
  h.connector.seed(B, 1_000_000n);
  h.respond({ id: 'linked-{n}' });
  assert.deepEqual(await done(await chat(h.base, key)), [200, 'credits']);
  await settle(h.gateway, B);
  assert.deepEqual([spent(A), spent(B)], [0n, 13n]);
  h.connector.seed(A, 1_000_000n);
  assert.deepEqual(await done(await chat(h.base, key)), [200, 'credits']);
  await settle(h.gateway, A);
  assert.deepEqual([spent(A), spent(B)], [13n, 13n]);
  // Two wallets that each hold too little are not added together: one call, one debit.
  const short = await accounts.create('carol', C), D = 'near:mainnet:dave.near'; await accounts.link(short.uid, D);
  h.connector.seed(C, 5n); h.connector.seed(D, 5n);
  assert.equal((await chat(h.base, h.auth.issue(C, 0, short.uid).key)).status, 402);
});

test('a wallet that leaves an account can no longer be charged by it, and a key cannot name an account its wallet is not in', async t => {
  const { h, accounts } = await setup(t, true, { seed: false });
  const account = await accounts.create('alice', A); await accounts.link(account.uid, B);
  h.connector.seed(B, 1_000_000n);
  const key = h.auth.issue(A, 0, account.uid).key;
  assert.equal((await chat(h.base, h.auth.issue(C, 0, account.uid).key)).status, 402);
  await accounts.unlink(B);
  assert.equal((await chat(h.base, key)).status, 402);
  assert.equal(h.connector.accounts.get(B)!.spent, 0n); assert.equal(h.connector.debitCalls, 0);
  // Linked again later, the same key can be charged to it without being reissued.
  await accounts.link(account.uid, B);
  h.respond({ id: 'relinked' });
  assert.deepEqual(await done(await chat(h.base, key)), [200, 'credits']);
});

test('free trial calls are counted per account: what a wallet used moves in with it, and linking adds none', async t => {
  const { h, accounts } = await setup(t, true, { seed: false, freeCallsPerUser: 2, freeCallsPerDay: 300 });
  const left = async (key: string) => (await (await fetch(h.base + '/v1/free-calls', { headers: { authorization: `Bearer ${key}` } })).json()).remaining;
  h.respond({ id: 'trial-{n}' });
  const walletKey = h.auth.issue(A, 0).key;
  assert.deepEqual(await done(await chat(h.base, walletKey)), [200, 'free']);
  const account = await accounts.create('alice', A);
  const key = h.auth.issue(A, 0, account.uid).key;
  assert.equal(await left(key), 1);
  assert.deepEqual(await done(await chat(h.base, key)), [200, 'free']);
  await accounts.link(account.uid, B);
  const second = h.auth.issue(B, 0, account.uid).key;
  assert.deepEqual([await left(key), await left(second)], [0, 0]);
  assert.equal((await chat(h.base, second)).status, 402);
  assert.equal(h.connector.debitCalls, 0);
});
