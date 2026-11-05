import { Keeper } from '../src/keeper/keeper.ts';
import { harness, USER, VAULT, fixture, settle } from '../test/harness.ts';

const h = await harness({ seed: false });
try {
  const keeper = new Keeper([{ id: VAULT, kind: 'aave', async skim() {}, async snapshot() { return { rate: 10n ** 18n, block: 42n, unpaid: 0n, paid: 1000n, entries: [[USER, 1000n]] }; } }],
    h.connector, { async tick() { return { dry: true, amount: '1000', status: 'fixture_quote_below_minimum' }; } },
    (event, details) => console.log(JSON.stringify({ fixture: true, event, ...details })));
  await keeper.tick();
  const response = await fetch(h.base + '/v1/chat/completions', { method: 'POST', headers: h.headers, body: fixture('chat.json') });
  await response.arrayBuffer();
  await settle(h.gateway);
  const account = await h.connector.account(USER);
  if (response.status !== 200 || account.spent !== 13n || account.credited !== 1000n) throw new Error('Fixture smoke failed');
  console.log(JSON.stringify({ fixture: true, status: response.status, credited: String(account.credited), spent: String(account.spent), available: String(account.available) }));
} finally { await h.close(); }
