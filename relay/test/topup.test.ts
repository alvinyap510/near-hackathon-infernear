import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseAbi, type Hex } from 'viem';
import { evmPorts } from '../src/adapters/evm.ts';
import { Keeper } from '../src/keeper/keeper.ts';
import { FakeConnector } from './harness.ts';

const topUp = '0x7070707070707070707070707070707070707070';
const usdc = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
const hash = ('0x' + '11'.repeat(32)) as Hex;
const abi = parseAbi(['function paid(address) view returns (uint256)', 'function paidTotal() view returns (uint256)', 'function usdc() view returns (address)',
  'event Paid(address indexed payer, address indexed beneficiary, uint256 amount)']);

async function rpc(handler: (method: string, params: any) => unknown) {
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString());
    try { res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: await handler(body.method, body.params) })); }
    catch (error) { res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: String(error) } })); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, async close() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}

test('bought credits are read from the top-up contract at a finalized block and posted one USD per USDC, with no transaction', async t => {
  const paid: Record<string, bigint> = { [alice]: 5_000_000n, [bob]: 250_000n };
  const sent: unknown[] = [], scans: any[] = [], reads: any[] = [];
  const fake = await rpc((method, params) => {
    if (method === 'eth_getBlockByNumber') { assert.equal(params[0], 'finalized'); return { number: '0x64', timestamp: '0x1388' }; }
    if (method === 'eth_getLogs') {
      scans.push(params[0]);
      // bob paid for alice once and for himself once: the beneficiary earns the credits, not the payer.
      return [[bob, alice, 5_000_000n], [bob, bob, 250_000n]].map(([payer, beneficiary, amount], logIndex) => ({ address: topUp,
        topics: encodeEventTopics({ abi, eventName: 'Paid', args: { payer: payer as Hex, beneficiary: beneficiary as Hex } }), data: encodeAbiParameters([{ type: 'uint256' }], [amount as bigint]),
        blockNumber: '0x64', blockHash: hash, transactionHash: hash, transactionIndex: '0x0', logIndex: '0x' + logIndex.toString(16), removed: false }));
    }
    if (method === 'eth_call') {
      assert.equal(params[0].to.toLowerCase(), topUp); assert.equal(params[1], '0x64');
      const call = decodeFunctionData({ abi, data: params[0].data }); reads.push(call.functionName);
      if (call.functionName === 'usdc') return encodeAbiParameters([{ type: 'address' }], [usdc]);
      if (call.functionName === 'paidTotal') return encodeAbiParameters([{ type: 'uint256' }], [paid[alice] + paid[bob]]);
      return encodeAbiParameters([{ type: 'uint256' }], [paid[(call.args![0] as string).toLowerCase()] ?? 0n]);
    }
    if (method === 'eth_sendRawTransaction') { sent.push(params); return hash; }
    throw new Error('unexpected RPC ' + method);
  }); t.after(fake.close);
  const ports = evmPorts({ rpc: fake.url, chainId: 8453, key: ('0x' + '12'.repeat(32)) as Hex, vaults: [{ kind: 'topup', address: topUp }], fromBlock: 90n,
    oneClickUrl: 'http://unused.invalid', bridgeTokens: [], destinationAsset: 'near-usdc', recipient: 'treasury.near', slippageBps: 100, minYieldMicro: 1n });
  const port = ports.vaults[0];
  assert.equal(port.kind, 'topup'); assert.equal(port.id, `eip155:8453:${topUp}`);
  const snapshot = await port.snapshot();
  assert.deepEqual(scans[0].topics[0], encodeEventTopics({ abi, eventName: 'Paid' })[0]);
  assert.deepEqual(new Map(snapshot.entries), new Map([[`eip155:8453:${alice}`, 5_000_000n], [`eip155:8453:${bob}`, 250_000n]]));
  assert.equal(snapshot.paid, 5_250_000n); assert.equal(snapshot.unpaid, 0n); assert.equal(snapshot.rate, 10n ** 18n);
  assert.equal(snapshot.work, null); // nothing to collect: a purchase is paid when it is made
  const connector = new FakeConnector();
  const keeper = new Keeper([port], connector, ports.bridge, () => {});
  await keeper.tick(); await keeper.tick();
  assert.equal(connector.postCalls, 1);
  assert.equal((await connector.account(`eip155:8453:${alice}`)).credited, 5_000_000n); // micro-USD: $5.00
  assert.equal((await connector.account(`eip155:8453:${bob}`)).credited, 250_000n);
  paid[bob] = 1_250_000n; await keeper.tick();
  assert.equal((await connector.account(`eip155:8453:${bob}`)).credited, 1_250_000n);
  await port.skim();
  assert.equal(sent.length, 0);
});
