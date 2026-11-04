import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keeper, type VaultPort } from '../src/keeper/keeper.ts';
import { FakeConnector, USER, VAULT, harness, fixture, settle } from './harness.ts';

test('keeper skips unpaid snapshots, reports skim reverts and retries without losing the loop', async () => {
  const connector = new FakeConnector();
  const reports: string[] = [];
  let reverts = true, unpaid = 1n, skims = 0;
  const vault: VaultPort = { id: VAULT, async skim() { skims++; if (reverts) throw new Error('fixture skim reverted'); },
    async snapshot() { return { block: 10n, unpaid, paid: 100n, entries: [[USER, 100n]] }; } };
  const keeper = new Keeper([vault], connector, { async tick() { return { dry: true, amount: '100000', status: 'below_minimum_quote_only' }; } }, event => reports.push(event));
  await keeper.tick(); assert.equal(connector.postCalls, 0); assert.ok(reports.includes('keeper_retry'));
  reverts = false;
  await keeper.tick(); assert.equal(connector.postCalls, 0); assert.ok(reports.includes('posting_skipped'));
  unpaid = 0n;
  await keeper.tick(); await keeper.tick();
  assert.equal(skims, 4);
  assert.equal((await connector.account(USER)).credited, 100n);
  assert.equal(connector.vaults.get(VAULT)!.paid, 100n);
});

test('keeper cumulative batches respect independent connector budgets and replay safety', async () => {
  const connector = new FakeConnector();
  const other = 'eip155:8453:0x2222222222222222222222222222222222222222';
  let paid = 50n, first = 30n, second = 20n;
  const errors: Record<string, unknown>[] = [];
  const vault: VaultPort = { id: VAULT, async skim() {}, async snapshot() { return { block: 20n, unpaid: 0n, paid, entries: [[USER, first], [other, second]] }; } };
  const keeper = new Keeper([vault], connector, { async tick() { return { dry: true, amount: '0' }; } }, (event, data) => { if (event === 'keeper_retry') errors.push(data); });
  await keeper.tick(); await keeper.tick();
  assert.equal((await connector.account(USER)).credited, 30n);
  first = 31n; await keeper.tick(); assert.equal(errors.length, 1);
  assert.equal((await connector.account(USER)).credited, 30n);
  paid = 70n; first = 40n; second = 30n; await keeper.tick();
  assert.equal((await connector.account(USER)).credited, 40n);
  assert.equal((await connector.account(other)).credited, 30n);
  first = 39n; await keeper.tick(); assert.equal(errors.length, 2);
});

test('fixture smoke: a passive holder receives yield credits and spends them through the API', async t => {
  const h = await harness({ seed: false }); t.after(h.close);
  const vault: VaultPort = { id: VAULT, async skim() {}, async snapshot() { return { block: 42n, unpaid: 0n, paid: 1000n, entries: [[USER, 1000n]] }; } };
  const keeper = new Keeper([vault], h.connector, { async tick() { return { dry: true, amount: '1000', status: 'below_minimum_quote_only' }; } }, () => {});
  await keeper.tick();
  const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: fixture('chat.json') });
  assert.equal(response.status, 200); await response.arrayBuffer();
  await settle(h.gateway);
  const account = await h.connector.account(USER);
  assert.equal(account.spent, 13n); assert.equal(account.available, 987n);
  assert.ok(account.spent <= account.credited);
  assert.ok(account.credited <= h.connector.vaults.get(VAULT)!.paid);
});
