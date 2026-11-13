// Accounts in the console: statements, request shapes, the browser cache and the pending link. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_STATEMENTS, accountCache, accountClient, parseAccount, pendingLink, validHandle } from './accounts.ts';
import { DataError } from './errors.ts';
import { KEY_STATEMENT, nearProofMessage, walletProofMessage } from './proof.ts';
import type { Session, WalletProof } from './types.ts';

const evm: Session = { kind: 'evm', address: '0x1111111111111111111111111111111111111111', user: 'eip155:8453:0x1111111111111111111111111111111111111111' };
const near: Session = { kind: 'near', accountId: 'bob.near', user: 'near:mainnet:bob.near' };
const rawAccount = { uid: 'acc_' + 'a'.repeat(32), handle: 'alice', wallets: [evm.user], avatar_seed: 'acc_' + 'a'.repeat(32), created_at: 1794500000 };
const account = parseAccount(rawAccount);
const memory = () => { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }; };

test('each account action has its own exact statement, in both proof formats, and the key statement is unchanged', () => {
  assert.deepEqual([ACCOUNT_STATEMENTS.signIn, ACCOUNT_STATEMENTS.create('alice'), ACCOUNT_STATEMENTS.invite('alice'), ACCOUNT_STATEMENTS.join('alice'), ACCOUNT_STATEMENTS.leave('alice')], [
    'Sign in to InferNear.', 'Create InferNear account "alice".', 'Add a wallet to InferNear account "alice".',
    'Link this wallet to InferNear account "alice".', 'Unlink this wallet from InferNear account "alice".']);
  const now = new Date('2026-11-13T00:00:00Z');
  const siwe = (statement?: string) => walletProofMessage(evm.kind === 'evm' ? evm.address : '0x', 'abcdef1234567890', 'https://app.test', 8453, now, statement);
  assert.ok(siwe().includes(`\n\n${KEY_STATEMENT}\n\n`));
  assert.ok(siwe(ACCOUNT_STATEMENTS.create('alice')).includes('\n\nCreate InferNear account "alice".\n\n'));
  assert.equal(JSON.parse(nearProofMessage('n', 'bob.near', now)).statement, KEY_STATEMENT);
  assert.deepEqual(JSON.parse(nearProofMessage('n', 'bob.near', now, ACCOUNT_STATEMENTS.signIn)),
    { statement: 'Sign in to InferNear.', account_id: 'bob.near', nonce: 'n', expires_at: 1794528300 });
});

test('handles follow the relay rule', () => {
  for (const handle of ['abc', 'alice', 'bob-near_1', 'a'.repeat(20), '0x1']) assert.equal(validHandle(handle), true, handle);
  for (const handle of ['ab', 'a'.repeat(21), 'Alice', '-alice', 'alice-', 'al ice', 'admin', 'near', 'me', '']) assert.equal(validHandle(handle), false, handle);
});

test('account calls sign the right statement, send the right body, and map relay answers', async () => {
  const calls: { path: string; body: any; statement: string }[] = [];
  let answer: (path: string) => unknown = () => ({ account: rawAccount });
  const proof = async (_session: Session, statement: string): Promise<WalletProof> => ({ message: `signed:${statement}`, signature: '0xsig' });
  const client = accountClient({ proof, post: async <T>(path: string, body: unknown) => { calls.push({ path, body, statement: (body as any).message.slice(7) }); return answer(path) as T; } });

  assert.deepEqual(await client.accountMe(evm), account);
  answer = () => ({ account: null });
  assert.equal(await client.accountMe(near), null);
  answer = () => ({ account: rawAccount });
  assert.deepEqual(await client.createAccount(evm, 'alice'), account);
  answer = () => ({ ticket: 'ilt_x.y', expires_at: 1794500600 });
  const link = await client.startLink(evm, 'alice');
  assert.deepEqual(link, { ticket: 'ilt_x.y', handle: 'alice', expiresAt: 1794500600 });
  answer = () => ({ account: { ...rawAccount, wallets: [evm.user, near.user] } });
  assert.deepEqual((await client.finishLink(near, link)).wallets, [evm.user, near.user]);
  assert.deepEqual((await client.unlinkWallet(near, 'alice')).handle, 'alice');
  assert.deepEqual(calls.map(c => [c.path, c.statement, c.body.handle, c.body.ticket]), [
    ['/accounts/me', 'Sign in to InferNear.', undefined, undefined],
    ['/accounts/me', 'Sign in to InferNear.', undefined, undefined],
    ['/accounts', 'Create InferNear account "alice".', 'alice', undefined],
    ['/accounts/link/start', 'Add a wallet to InferNear account "alice".', 'alice', undefined],
    ['/accounts/link', 'Link this wallet to InferNear account "alice".', undefined, 'ilt_x.y'],
    ['/accounts/unlink', 'Unlink this wallet from InferNear account "alice".', 'alice', undefined]]);

  // A bad handle is refused before any signature is asked for.
  const before = calls.length;
  await assert.rejects(client.createAccount(evm, 'Admin'), (e: DataError) => e.code === 'invalid_handle');
  assert.equal(calls.length, before);
  // The wallet already has an account: the relay returns it and the caller adopts it.
  answer = () => { throw new DataError('account_exists', 'This wallet already has an account', { error: {}, account: rawAccount }); };
  assert.deepEqual(await client.createAccount(evm, 'other'), account);
  for (const code of ['handle_taken', 'invalid_ticket', 'wallet_linked', 'too_many_wallets', 'last_wallet', 'accounts_disabled']) {
    answer = () => { throw new DataError(code, code); };
    await assert.rejects(client.createAccount(evm, 'alice'), (e: DataError) => e.code === code);
  }
  answer = () => ({ account: { uid: 1 } });
  await assert.rejects(client.accountMe(evm), (e: DataError) => e.code === 'account');
  answer = () => ({ ticket: 7 });
  await assert.rejects(client.startLink(evm, 'alice'), (e: DataError) => e.code === 'account');
});

test('the browser cache shows an account only to a wallet listed in it, and survives a broken store', () => {
  const store = memory(), cache = accountCache(store);
  assert.equal(cache.read(evm.user), null);
  cache.write({ ...account, wallets: [evm.user, near.user] });
  assert.deepEqual(cache.read(near.user)?.handle, 'alice');
  assert.deepEqual(cache.read(evm.user)?.wallets, [evm.user, near.user]);
  // An entry copied under another wallet's key is ignored: that wallet is not in the account.
  store.setItem('infernear.account.near:mainnet:mallory.near', store.getItem(`infernear.account.${evm.user}`)!);
  assert.equal(cache.read('near:mainnet:mallory.near'), null);
  cache.write(account, near.user);
  assert.equal(cache.read(near.user), null); assert.deepEqual(cache.read(evm.user)?.wallets, [evm.user]);
  cache.forget(evm.user); assert.equal(cache.read(evm.user), null);
  store.setItem(`infernear.account.${evm.user}`, '{ not json');
  assert.equal(cache.read(evm.user), null);
  const broken = accountCache({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
  assert.equal(broken.read(evm.user), null); broken.write(account); broken.forget(evm.user);
  assert.equal(accountCache(undefined).read(evm.user), null);
});

test('a pending link outlives a wallet switch in this tab, then expires, is used or is cancelled', () => {
  let now = 1794500000_000;
  const store = memory(), link = { ticket: 'ilt_x.y', handle: 'alice', expiresAt: 1794500600 };
  const pending = pendingLink(store, () => now);
  assert.equal(pending.get(), null);
  pending.set(link);
  // A fresh instance (the page after a redirect wallet returns) reads it from the tab's storage.
  assert.deepEqual(pendingLink(store, () => now).get(), link);
  now = 1794500600_000;
  assert.equal(pending.get(), null); assert.equal(store.map.size, 0);
  now = 1794500000_000; pending.set(link); pending.clear();
  assert.equal(pendingLink(store, () => now).get(), null);
  store.setItem('infernear.pending-link', '{ not json');
  assert.equal(pendingLink(store, () => now).get(), null);
  const none = pendingLink(undefined, () => now); none.set(link);
  assert.deepEqual(none.get(), link);
});
