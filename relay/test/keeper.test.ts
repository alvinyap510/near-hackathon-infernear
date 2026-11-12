import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keeper, type VaultPort } from '../src/keeper/keeper.ts';
import { FakeConnector, USER, VAULT, harness, fixture, settle } from './harness.ts';

test('keeper sends a transaction only for reported work, backs off while it repeats, and never reposts unchanged credits', async () => {
  const connector = new FakeConnector();
  const reports: string[] = [];
  let reverts = true, unpaid = 1n, skims = 0, work: string | null = null, clock = 0;
  const vault: VaultPort = { id: VAULT, kind: 'aave', async skim() { skims++; if (reverts) throw new Error('fixture skim reverted'); },
    async snapshot() { return { rate: 10n ** 18n, block: 10n, unpaid, paid: 100n, entries: [[USER, 100n]], work }; } };
  const keeper = new Keeper([vault], connector, { async tick() { return { dry: true, amount: '100000', status: 'below_minimum_quote_only' }; } }, event => reports.push(event), undefined, () => clock);
  // No work reported: reads only, however often the keeper ticks.
  await keeper.tick(); await keeper.tick();
  assert.equal(skims, 0); assert.equal(connector.postCalls, 0); assert.ok(reports.includes('posting_skipped'));
  // Work reported: one transaction. While the same work is still there, wait 1, then 2 minutes.
  work = 'yield';
  await keeper.tick(); assert.equal(skims, 1); assert.ok(reports.includes('keeper_retry'));
  await keeper.tick(); clock = 59_999; await keeper.tick(); assert.equal(skims, 1);
  clock = 60_000; await keeper.tick(); assert.equal(skims, 2);
  clock = 179_999; await keeper.tick(); assert.equal(skims, 2);
  reverts = false; clock = 180_000; await keeper.tick(); assert.equal(skims, 3);
  assert.ok(reports.includes('vault_transaction'));
  // Work done: the delay resets, so the next new work is sent at once.
  work = null; await keeper.tick(); work = 'yield'; await keeper.tick(); assert.equal(skims, 4);
  // Credits post once the vault has paid; an unchanged snapshot is never posted again.
  work = null; unpaid = 0n;
  await keeper.tick(); await keeper.tick(); await keeper.tick();
  assert.equal(skims, 4); assert.equal(connector.postCalls, 1);
  assert.equal((await connector.account(USER)).credited, 100n);
  assert.equal(connector.vaults.get(VAULT)!.paid, 100n);
});

test('a rejected post waits longer each time even as its amounts change, and the delay ends once a post lands', async () => {
  const connector = new FakeConnector();
  let paid = 10n, credited = 11n, clock = 0;
  const vault: VaultPort = { id: VAULT, kind: 'aave', async skim() {}, async snapshot() { return { rate: 10n ** 18n, block: 1n, unpaid: 0n, paid, entries: [[USER, credited]] }; } };
  const keeper = new Keeper([vault], connector, { async tick() { return {}; } }, () => {}, undefined, () => clock);
  await keeper.tick(); await keeper.tick(); assert.equal(connector.postCalls, 1); // exceeds paid_cum: rejected
  paid = 20n; credited = 21n; clock = 59_999; await keeper.tick(); assert.equal(connector.postCalls, 1); // new amounts, same failure: still waiting
  clock = 60_000; await keeper.tick(); assert.equal(connector.postCalls, 2);
  credited = 20n; clock = 179_999; await keeper.tick(); assert.equal(connector.postCalls, 2);
  clock = 180_000; await keeper.tick(); assert.equal(connector.postCalls, 3);
  assert.equal((await connector.account(USER)).credited, 20n);
  paid = 30n; credited = 30n; await keeper.tick(); assert.equal(connector.postCalls, 4); // landed: next post is immediate
});

test('keeper cumulative batches respect independent connector budgets and replay safety', async () => {
  const connector = new FakeConnector();
  const other = 'eip155:8453:0x2222222222222222222222222222222222222222';
  let paid = 50n, first = 30n, second = 20n;
  const errors: Record<string, unknown>[] = [];
  const vault: VaultPort = { id: VAULT, kind: 'aave', async skim() {}, async snapshot() { return { rate: 10n ** 18n, block: 20n, unpaid: 0n, paid, entries: [[USER, first], [other, second]] }; } };
  let clock = 0;
  const keeper = new Keeper([vault], connector, { async tick() { return { dry: true, amount: '0' }; } }, (event, data) => { if (event === 'keeper_retry') errors.push(data); }, undefined, () => clock);
  await keeper.tick(); await keeper.tick();
  assert.equal((await connector.account(USER)).credited, 30n);
  first = 31n; await keeper.tick(); assert.equal(errors.length, 1);
  assert.equal((await connector.account(USER)).credited, 30n);
  paid = 70n; first = 40n; second = 30n; clock += 60_000; await keeper.tick();
  assert.equal((await connector.account(USER)).credited, 40n);
  assert.equal((await connector.account(other)).credited, 30n);
  first = 39n; await keeper.tick(); assert.equal(errors.length, 2);
});

test('fixture smoke: a passive holder receives yield credits and spends them through the API', async t => {
  const h = await harness({ seed: false }); t.after(h.close);
  const vault: VaultPort = { id: VAULT, kind: 'aave', async skim() {}, async snapshot() { return { rate: 10n ** 18n, block: 42n, unpaid: 0n, paid: 1000n, entries: [[USER, 1000n]] }; } };
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

test('priced posting sends native cumulative amounts and source block; remainder carry and replay never reprice history', async () => {
  const connector = new FakeConnector();
  let cumulative = 6n, rate = 10n ** 17n;
  const vault: VaultPort = { id: VAULT, kind: 'rate', async skim() {}, async snapshot() { return { block: 123n, unpaid: 0n, paid: cumulative, rate, entries: [[USER, cumulative]] }; } };
  const keeper = new Keeper([vault], connector, { async tick() { return {}; } }, () => {});
  await keeper.tick(); assert.equal((await connector.account(USER)).credited, 0n);
  assert.deepEqual(connector.posts[0], { vault: VAULT, paid: 6n, rate, sourceBlock: 123n, entries: [[USER, 6n]] });
  rate = 9n * 10n ** 17n; await keeper.tick(); // Same cumulative amount at a different rate is a no-op.
  assert.equal((await connector.account(USER)).credited, 0n);
  cumulative = 12n; rate = 10n ** 17n; await keeper.tick();
  assert.equal((await connector.account(USER)).credited, 1n);
  assert.equal(connector.vaults.get(VAULT)!.remainders.get(USER), 2n * 10n ** 17n);
});

test('Rhea runs only for reported work and never while busy; low relay and vault NEAR balances alert', async () => {
  const connector = new FakeConnector();
  const events: { event: string; details: Record<string, unknown> }[] = [];
  let busy = true, unpaid = 0n, ran = 0, work: string | null = 'queue:1000000:0';
  const vault: VaultPort = { id: 'near:mainnet:vault.near', kind: 'rhea', async skim() { ran++; }, async snapshot() {
    return { busy, unpaid, paid: 10n, rate: 10n ** 18n, block: 223089644n, entries: [[USER, 10n]], work };
  } };
  const keeper = new Keeper([vault], connector, { async tick() { return {}; } }, (event, details) => events.push({ event, details }), {
    minimum: 100n, async balances() { return [{ account: 'relay.near', free: 1n }, { account: 'vault.near', free: 99n }]; },
  });
  await keeper.tick(); assert.equal(connector.postCalls, 0); assert.equal(ran, 0);
  busy = false; unpaid = 1n; await keeper.tick(); assert.equal(connector.postCalls, 0); assert.equal(ran, 1);
  work = null; unpaid = 0n; await keeper.tick(); assert.equal(connector.postCalls, 1); assert.equal(ran, 1);
  assert.equal(connector.posts[0].vault, 'near:mainnet:vault.near');
  assert.equal(connector.posts[0].sourceBlock, 223089644n); assert.equal(connector.posts[0].rate, 10n ** 18n);
  assert.equal(events.filter(e => e.event === 'low_near_balance').length, 6);
  assert.ok(events.some(e => e.details.reason === 'vault_busy'));
});

test('a long holder list is posted in batches of at most 100 entries, each under the same snapshot', async () => {
  const connector = new FakeConnector();
  const users = Array.from({ length: 250 }, (_, i) => `eip155:8453:0x${i.toString(16).padStart(40, '0')}`);
  const vault: VaultPort = { id: VAULT, kind: 'topup', async skim() {}, async snapshot() { return { rate: 10n ** 18n, block: 7n, unpaid: 0n, paid: 250_000_000n, entries: users.map(user => [user, 1_000_000n]) }; } };
  const keeper = new Keeper([vault], connector, { async tick() { return {}; } }, () => {});
  await keeper.tick();
  assert.deepEqual(connector.posts.map(post => post.entries.length), [100, 100, 50]);
  assert.ok(connector.posts.every(post => post.paid === 250_000_000n && post.sourceBlock === 7n && post.rate === 10n ** 18n));
  assert.equal((await connector.account(users[0])).credited, 1_000_000n);
  assert.equal((await connector.account(users[249])).credited, 1_000_000n);
  await keeper.tick(); assert.equal(connector.postCalls, 3); // nothing changed: no repost
});
