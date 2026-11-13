import { createServer, type IncomingHttpHeaders } from 'node:http';
import { readFileSync } from 'node:fs';
import { setImmediate as turn } from 'node:timers/promises';
import type { Accounts } from '../src/gateway/accounts.ts';
import { Auth, type NearKeyLookup } from '../src/gateway/auth.ts';
import { Gateway } from '../src/gateway/ledger.ts';
import { createRelayServer } from '../src/gateway/server.ts';
import { SignedRequests, type SignedOperations } from '../src/gateway/signed.ts';
import { Upstream } from '../src/gateway/upstream.ts';
import { InsufficientCredit, type Account, type Connector, type Receipt } from '../src/types.ts';

export const USER = 'eip155:8453:0x1111111111111111111111111111111111111111';
export const VAULT = 'eip155:8453:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));
export const e2ee = { 'content-type': 'application/json', 'x-encryption-version': '3', 'x-signing-algo': 'ed25519', 'x-client-pub-key': 'aa'.repeat(32), 'x-model-pub-key': 'bb'.repeat(32), 'x-encrypt-all-fields': 'true', 'x-no-aliasing': 'true' };

export class FakeConnector implements Connector {
  accounts = new Map<string, Account>();
  amounts = new Map<string, bigint>();
  receipts = new Map<string, Receipt>();
  vaults = new Map<string, { paid: bigint; posted: Map<string, bigint>; remainders: Map<string, bigint> }>();
  accountOverride?: Account;
  beforeFailures = 0;
  landThenThrow = false;
  hiddenDebits = 0;
  debitCalls = 0;
  accountCalls = 0;
  debitReads = 0;
  storageCalls = 0;
  bumpWait?: Promise<void>;
  postCalls = 0;
  posts: { vault: string; paid: bigint; rate: bigint; sourceBlock: bigint; entries: [string, bigint][] }[] = [];
  seed(user = USER, credit = 1_000_000n) { this.accounts.set(user, { credited: credit, spent: 0n, available: credit, key_epoch: 0 }); }
  async account(user: string): Promise<Account> { this.accountCalls++; return { ...(this.accountOverride ?? this.accounts.get(user) ?? { credited: 0n, spent: 0n, available: 0n, key_epoch: 0 }) }; }
  async debitedAmount(id: string) { this.debitReads++; if (this.hiddenDebits > 0) { this.hiddenDebits--; return null; } return this.amounts.get(id) ?? null; }
  async debit(user: string, amount: bigint, receipt: Receipt) {
    this.debitCalls++;
    if (this.beforeFailures-- > 0) throw new Error('fixture RPC failure before broadcast');
    if (this.amounts.has(receipt.inference_id)) return;
    const account = this.accounts.get(user)!;
    if (amount > account.available) throw new InsufficientCredit('fixture insufficient credit');
    account.spent += amount; account.available -= amount;
    this.amounts.set(receipt.inference_id, amount); this.receipts.set(receipt.inference_id, receipt);
    if (this.landThenThrow) { this.landThenThrow = false; throw new Error('fixture timeout after landed debit'); }
  }
  async bumpKeyEpoch(user: string) {
    await this.bumpWait;
    if (!this.accounts.has(user)) this.seed(user, 0n);
    return { key_epoch: ++this.accounts.get(user)!.key_epoch, tx_hash: 'fixture-near-transaction' };
  }
  async postCredits(vault: string, paid: bigint, rate: bigint, sourceBlock: bigint, entries: [string, bigint][]) {
    this.postCalls++;
    this.posts.push({ vault, paid, rate, sourceBlock, entries });
    const previous = this.vaults.get(vault) ?? { paid: 0n, posted: new Map<string, bigint>(), remainders: new Map<string, bigint>() };
    const next = { paid: previous.paid > paid ? previous.paid : paid, posted: new Map(previous.posted), remainders: new Map(previous.remainders) };
    const deltas = new Map<string, bigint>();
    for (const [user, cumulative] of entries) {
      const prior = next.posted.get(user) ?? 0n;
      if (cumulative < prior) throw new Error('negative credit delta');
      deltas.set(user, (deltas.get(user) ?? 0n) + cumulative - prior);
      next.posted.set(user, cumulative);
    }
    if ([...next.posted.values()].reduce((a, b) => a + b, 0n) > next.paid) throw new Error('posting exceeds paid_cum');
    for (const [user, delta] of deltas) {
      if (!this.accounts.has(user)) this.seed(user, 0n);
      const account = this.accounts.get(user)!; const x = (next.remainders.get(user) ?? 0n) + delta * rate;
      const credit = x / (10n ** 18n); next.remainders.set(user, x % (10n ** 18n));
      account.credited += credit; account.available += credit;
    }
    this.vaults.set(vault, next);
  }
  async posted(vault: string) { const state = this.vaults.get(vault); return { paid: state?.paid ?? 0n, total: [...(state?.posted.values() ?? [])].reduce((sum, amount) => sum + amount, 0n) }; }
  async storageBalance() { this.storageCalls++; return { amount: '1000000000000000000000000', storage_usage: 1000 }; }
}

export async function harness(options: { nearKey?: NearKeyLookup; now?: () => number; seed?: boolean; deadlineMs?: number; signedOperations?: Omit<SignedOperations, 'withdrawable'> & Partial<SignedOperations>; clientIpHeader?: string; retryMs?: number; sponsoredPerDay?: number; maxTokens?: number; freeCallsPerUser?: number; freeCallsPerDay?: number; accounts?: Accounts } = {}) {
  const connector = new FakeConnector();
  if (options.seed !== false) connector.seed();
  const events: { event: string; details: Record<string, unknown> }[] = [];
  const requests: { path: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];
  let status = 200;
  let responseBody: Buffer = fixture('response.json');
  let headerId: string | undefined = 'fixture-inference';
  let contentType = 'application/json';
  let wait: Promise<void> | undefined;
  let headersWait: Promise<void> | undefined;
  let serial = 0;
  const upstreamServer = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', 'https://upstream.invalid');
    res.setHeader('access-control-expose-headers', 'fixture-only');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
    if (req.url === '/v1/model/list') { res.setHeader('content-type', 'application/json'); res.end(fixture('models.json')); return; }
    if (!req.url?.startsWith('/v1/chat/completions')) { res.setHeader('content-type', 'application/json'); res.end('{ "fixture": "unchanged" }\n'); return; }
    const id = headerId?.replace('{n}', String(++serial));
    const bytes = responseBody;
    await headersWait;
    res.writeHead(status, { 'content-type': contentType, ...(id ? { 'inference-id': id } : {}) });
    if (wait) {
      // A completion id is observable before a delayed final usage frame.
      if (contentType === 'text/event-stream') res.write('data: {"id":"chatcmpl-delayed"}\n\n');
      await wait;
    }
    const middle = Math.floor(bytes.length / 2);
    res.write(bytes.subarray(0, middle)); await turn(); res.end(bytes.subarray(middle));
  });
  await new Promise<void>(resolve => upstreamServer.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (upstreamServer.address() as import('node:net').AddressInfo).port;
  const publicUrl = 'http://relay.test';
  const auth = new Auth('fixture-test-secret', publicUrl, 8453, options.now, options.nearKey);
  const gateway = new Gateway({ auth, connector, upstream: new Upstream(`http://127.0.0.1:${upstreamPort}/v1`, 'fixture-upstream-key', options.now, options.deadlineMs), maxTokens: options.maxTokens ?? 100, freeCallsPerUser: options.freeCallsPerUser, freeCallsPerDay: options.freeCallsPerDay, accounts: options.accounts, report: (event, details) => events.push({ event, details }), now: options.now, retryMs: options.retryMs ?? 0 });
  const server = createRelayServer(gateway, { publicUrl, now: options.now, report: (event, details) => events.push({ event, details }), allowedOrigin: 'https://dashboard.test', clientIpHeader: options.clientIpHeader, sponsoredPerDay: options.sponsoredPerDay, accounts: options.accounts,
    signedRequests: options.signedOperations ? new SignedRequests({ async withdrawable() { return { principal: 10n ** 12n, nonce: 0 }; }, ...options.signedOperations }, { vault: 'vault.near', intents: 'intents.near', chainId: 8453 }, options.now) : undefined });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const key = auth.issue(USER, 0).key;
  return { connector, gateway, auth, events, requests, base, key,
    headers: { ...e2ee, authorization: `Bearer ${key}` },
    respond(options: { body?: Buffer; status?: number; id?: string | null; stream?: boolean; wait?: Promise<void>; headersWait?: Promise<void> }) {
      if (options.body) responseBody = options.body;
      if (options.status !== undefined) status = options.status;
      if (options.id !== undefined) headerId = options.id ?? undefined;
      if (options.stream) contentType = 'text/event-stream';
      wait = options.wait;
      headersWait = options.headersWait;
    },
    async close() { server.closeAllConnections(); upstreamServer.closeAllConnections(); await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstreamServer.close(() => resolve()))]); },
  };
}
export async function eventually(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await turn(); }
  throw new Error('fixture condition did not settle');
}
export async function settle(gateway: Gateway, user = USER) {
  await eventually(async () => { await gateway.retryDebits(); return gateway.state(user).pending === 0; });
}
