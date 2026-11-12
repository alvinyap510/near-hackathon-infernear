import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbi, parseTransaction, zeroAddress, type Hex } from 'viem';
import { KeyPair, decodeSignedTransaction } from 'near-api-js';
import { evmPorts } from '../src/adapters/evm.ts';
import { nearConnector } from '../src/adapters/near.ts';
import { Keeper } from '../src/keeper/keeper.ts';
import { FakeConnector } from './harness.ts';
import type { Receipt } from '../src/types.ts';

const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const usdc = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const holder = '0x1111111111111111111111111111111111111111';
const hash = ('0x' + '11'.repeat(32)) as Hex;
const vaultAbi = parseAbi(['function skim()', 'function unpaid() view returns (uint256)', 'function paidTotal() view returns (uint256)', 'function yieldCredited(address) view returns (uint256)', 'function yieldToken() view returns (address)']);

const multicall = '0xca11bde05977b3631167028862be2a173976ca11';
// aggregate3 result for [paidTotal, skim, paidTotal]: what a simulated skim would pay out.
const simulated = (before: bigint, after: bigint) => encodeAbiParameters([{ type: 'tuple[]', components: [{ type: 'bool' }, { type: 'bytes' }] }],
  [[[true, encodeAbiParameters([{ type: 'uint256' }], [before])], [true, '0x'], [true, encodeAbiParameters([{ type: 'uint256' }], [after])]]]);

async function rpc(handler: (method: string, params: any) => unknown | Promise<unknown>) {
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = []; for await (const part of req) parts.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(parts).toString());
    try { res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: await handler(body.method, body.params) })); }
    catch (error) { res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: String(error) } })); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, async close() { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
}

test('real NEAR adapter uses finalized views, distinct signers, numeric receipts and no attached deposit', async t => {
  const signed: any[] = [];
  const key = KeyPair.fromRandom('ed25519');
  const accountValue = { credited: '100', spent: '7', available: '93', key_epoch: 1 };
  const calls: any[] = [];
  let busy = false, unpaid = '0', pendingIn = '0', pendingOut: string | null = null, supplied = '0';
  const fake = await rpc((method, params) => {
    calls.push({ method, params });
    if (method === 'block') return { header: { hash: '11111111111111111111111111111111', height: 10 } };
    if (method === 'query') {
      if (params.request_type === 'call_function') {
        if (params.account_id === 'vault.near') {
          const args = JSON.parse(Buffer.from(params.args_base64, 'base64').toString());
          if (params.method_name === 'busy') assert.equal(params.finality, 'final');
          else assert.equal(params.block_id, 10);
          const values: Record<string, unknown> = { busy, unpaid, paid_total: '101',
            holders: Array.from({ length: args.from === 0 ? 100 : 1 }, (_, i) => 'user-' + (i + (args.from ?? 0))), idle: '1000000',
            position: { principal: '10', yield_credited: '1', pending_in: args.user === 'user-0' ? pendingIn : '0', pending_out: args.user === 'user-0' ? pendingOut : null } };
          return { result: [...Buffer.from(JSON.stringify(values[params.method_name]))], logs: [], block_height: 10, block_hash: '11111111111111111111111111111111' };
        }
        if (params.account_id === 'lend.near') {
          assert.equal(params.method_name, 'get_account'); assert.equal(params.block_id, 10);
          return { result: [...Buffer.from(JSON.stringify({ supplied: [{ token_id: 'usdc.near', balance: supplied }] }))], logs: [], block_height: 10, block_hash: '11111111111111111111111111111111' };
        }
        assert.equal(params.finality, 'final');
        const value = params.method_name === 'account' ? accountValue : params.method_name === 'vault' ? { paid_cum: '100', posted_total: '90' } : '7';
        return { result: [...Buffer.from(JSON.stringify(value))], logs: [], block_height: 10, block_hash: '11111111111111111111111111111111' };
      }
      if (params.request_type === 'view_account') return { amount: '1000000000000000000000000', locked: '0', storage_usage: 1000, code_hash: '11111111111111111111111111111111', block_height: 10, block_hash: '11111111111111111111111111111111' };
      if (params.request_type === 'view_access_key') return { nonce: 10, permission: 'FullAccess', block_hash: '11111111111111111111111111111111', block_height: 10 };
    }
    if (method === 'send_tx') {
      const transaction = decodeSignedTransaction(Buffer.from(params.signed_tx_base64, 'base64')).transaction;
      const call = transaction.actions[0].functionCall!;
      signed.push({ receiver: transaction.receiverId, signer: transaction.signerId, method: call.methodName, args: JSON.parse(Buffer.from(call.args).toString()), deposit: call.deposit });
      return { final_execution_status: 'FINAL', status: { SuccessValue: Buffer.from(call.methodName === 'bump_key_epoch' ? '2' : '').toString('base64') },
        transaction: { hash: 'fixture-tx', signer_id: transaction.signerId, public_key: key.getPublicKey().toString(), nonce: 11, receiver_id: 'connector.near', actions: [], signature: '' }, receipts_outcome: [], transaction_outcome: { id: 'fixture-tx', outcome: { logs: [], receipt_ids: [], gas_burnt: 0, tokens_burnt: '0', executor_id: transaction.signerId, status: { SuccessValue: '' } }, proof: [], block_hash: '11111111111111111111111111111111' } };
    }
    throw new Error('Unhandled fake NEAR method ' + method);
  }); t.after(fake.close);
  const connector = await nearConnector({ rpc: fake.url, contract: 'connector.near', gatewayAccount: 'gateway.near', gatewayKey: key.toString(), keeperAccount: 'keeper.near', keeperKey: key.toString(), relayAccount: 'relay.near', relayKey: key.toString(), rheaVault: 'vault.near', intents: 'intents.near',
    rheaLend: 'lend.near', usdc: 'usdc.near', rheaCushion: 1_000_000n, minYieldMicro: 5n });
  assert.deepEqual(await connector.posted('fixture-vault'), { paid: 100n, total: 90n });
  assert.deepEqual(await connector.account('fixture-user'), { credited: 100n, spent: 7n, available: 93n, key_epoch: 1 });
  assert.equal(await connector.debitedAmount('fixture-id'), 7n);
  assert.equal((await connector.storageBalance()).storage_usage, 1000);
  const receipt: Receipt = { inference_id: 'fixture-id', chat_id: 'fixture-chat', model: 'fixture/tee', prompt_tokens: 5, completion_tokens: 2, in_price_nano: '1', out_price_nano: '2', source: 'reservation' };
  await connector.debit('fixture-user', 7n, receipt);
  assert.deepEqual(await connector.bumpKeyEpoch('fixture-user'), { key_epoch: 2, tx_hash: 'fixture-tx' });
  await connector.postCredits('fixture-vault', 100n, 10n ** 18n, 10n, [['fixture-user', 100n]]);
  assert.deepEqual(signed.map(tx => tx.signer), ['gateway.near', 'gateway.near', 'keeper.near']);
  assert.ok(signed.every(tx => tx.deposit === 0n));
  assert.deepEqual(signed[0].args.receipt, receipt);
  assert.deepEqual(signed[2].args, { vault: 'fixture-vault', paid_cum: '100', rate: '1000000000000000000', source_block: 10, entries: [['fixture-user', '100']] });
  await connector.rhea.skim();
  const snapshot = await connector.rhea.snapshot();
  assert.equal(snapshot.block, 10n); assert.equal(snapshot.rate, 10n ** 18n); assert.equal(snapshot.entries.length, 101);
  assert.deepEqual(snapshot.entries[100], ['user-100', 1n]);
  // 101 holders x 10 principal + 1.0 cushion are covered by 1.0 idle + supplied (12 extra decimals).
  assert.equal(snapshot.work, null);
  supplied = String(1014n * 10n ** 12n); assert.equal((await connector.rhea.snapshot()).work, null); // 4 micro-USD of yield < 5
  supplied = String(1015n * 10n ** 12n); assert.equal((await connector.rhea.snapshot()).work, 'yield');
  pendingIn = '2000000'; assert.equal((await connector.rhea.snapshot()).work, 'queue:2000000:0');
  pendingIn = '0'; pendingOut = '5'; assert.equal((await connector.rhea.snapshot()).work, 'queue:0:1');
  pendingOut = null; supplied = '0';
  busy = true; let settling = await connector.rhea.snapshot(); assert.equal(settling.entries.length, 0); assert.equal(settling.work, null);
  busy = false; unpaid = '1'; settling = await connector.rhea.snapshot(); assert.equal(settling.entries.length, 0); assert.equal(settling.work, 'unpaid:1');
  assert.equal(signed.filter(tx => tx.method === 'run').length, 1); // Snapshots never send a transaction.
  await connector.withdraw('signed-json', '0xfixture-signature');
  await connector.executeIntents([{ standard: 'erc191', payload: 'signed-payload', signature: 'secp256k1:fixture' }]);
  assert.deepEqual(signed.slice(3).map(tx => [tx.signer, tx.receiver, tx.method, tx.deposit]), [
    ['relay.near', 'vault.near', 'run', 0n], ['relay.near', 'vault.near', 'request_withdraw', 0n], ['relay.near', 'intents.near', 'execute_intents', 0n],
  ]);
  assert.deepEqual(signed[4].args, { message: 'signed-json', signature: '0xfixture-signature' });
  assert.deepEqual(signed[5].args, { signed: [{ standard: 'erc191', payload: 'signed-payload', signature: 'secp256k1:fixture' }] });
  // Every account that pays gas is watched, not only the relay and the vault.
  assert.deepEqual((await connector.balances()).map(balance => balance.account), ['relay.near', 'vault.near', 'gateway.near', 'keeper.near']);
  assert.ok((await connector.balances()).every(balance => balance.free === 990_000_000_000_000_000_000_000n));
});

test('Flex2-3: real EVM adapter reads finalized holders and honors the configured bridge minimum', async t => {
  let treasury = 100_000n, payable = 0n, clock = 0;
  const reads: any[] = [], scans: any[] = [], transactions: Hex[] = [];
  let nonce = 0;
  const block = { number: '0x64', hash, parentHash: hash, nonce: '0x0000000000000000', sha3Uncles: hash, logsBloom: '0x' + '00'.repeat(256), transactionsRoot: hash, stateRoot: hash, receiptsRoot: hash,
    miner: address, difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0', timestamp: '0x1', transactions: [], uncles: [], baseFeePerGas: '0x1' };
  const fake = await rpc((method, params) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_getTransactionCount') return '0x' + nonce.toString(16);
    if (method === 'eth_estimateGas') return '0x100000';
    if (method === 'eth_maxPriorityFeePerGas' || method === 'eth_gasPrice') return '0x1';
    if (method === 'eth_getTransactionReceipt') return { transactionHash: hash, transactionIndex: '0x0', blockHash: hash, blockNumber: '0x64', from: holder, to: address, cumulativeGasUsed: '0x1', gasUsed: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', effectiveGasPrice: '0x1', type: '0x2' };
    if (method === 'eth_sendRawTransaction') { transactions.push(params[0]); nonce++; return hash; }
    if (method === 'eth_getLogs') {
      scans.push(params[0]);
      return [{ address, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: zeroAddress, to: holder } }), data: encodeAbiParameters([{ type: 'uint256' }], [100n]), blockNumber: '0x64', blockHash: hash, transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false }];
    }
    if (method === 'eth_call') {
      const target = params[0].to.toLowerCase();
      if (target === multicall) { assert.equal(params[1], 'latest'); return simulated(100n, 100n + payable); }
      if (target === usdc) return encodeAbiParameters([{ type: 'uint256' }], [treasury]);
      const call = decodeFunctionData({ abi: vaultAbi, data: params[0].data });
      reads.push({ ...call, block: params[1] });
      return call.functionName === 'yieldToken' ? encodeAbiParameters([{ type: 'address' }], [usdc]) : encodeAbiParameters([{ type: 'uint256' }], [call.functionName === 'unpaid' ? 0n : 100n]);
    }
    throw new Error('Unhandled fake EVM method ' + method);
  }); t.after(fake.close);
  let swapStatus = 'PROCESSING';
  const quotes: any[] = [];
  const oneClick = createServer(async (req, res) => {
    if (req.method === 'GET') { res.end(JSON.stringify({ status: swapStatus })); return; }
    const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
    const quote = JSON.parse(Buffer.concat(parts).toString()); quotes.push(quote);
    res.end(JSON.stringify({ quote: { amountIn: quote.amount, amountOut: quote.amount, ...(quote.dry ? {} : { depositAddress: address }) } }));
  });
  await new Promise<void>(done => oneClick.listen(0, '127.0.0.1', done));
  t.after(async () => { oneClick.closeAllConnections(); await new Promise<void>(done => oneClick.close(() => done())); });
  const ports = evmPorts({ rpc: fake.url, chainId: 8453, key: ('0x' + '12'.repeat(32)) as Hex, vaults: [{ kind: 'aave', address }], fromBlock: 90n,
    oneClickUrl: `http://127.0.0.1:${(oneClick.address() as import('node:net').AddressInfo).port}`, bridgeTokens: [{ token: usdc, originAsset: 'fixture-origin', minimumBaseUnits: '300000' }], destinationAsset: 'fixture-destination', recipient: 'treasury.near', slippageBps: 100, minYieldMicro: 10_000n, now: () => clock });
  await ports.vaults[0].skim();
  const snapshot = await ports.vaults[0].snapshot();
  assert.deepEqual(snapshot.entries, [[`eip155:8453:${holder}`, 100n]]);
  assert.equal(snapshot.block, 100n); assert.equal(snapshot.unpaid, 0n); assert.equal(snapshot.paid, 100n);
  // A simulated skim decides whether the real one is worth its gas: 9,999 micro-USD is not, 10,000 is.
  assert.equal(snapshot.work, null);
  payable = 9_999n; assert.equal((await ports.vaults[0].snapshot()).work, null);
  payable = 10_000n; assert.equal((await ports.vaults[0].snapshot()).work, 'yield');
  assert.equal(transactions.length, 1); // Snapshots never send a transaction.
  assert.ok(reads.every(read => read.block === '0x64'));
  assert.equal(scans[0].fromBlock, '0x5a'); assert.equal(scans[0].toBlock, '0x64');
  const bridgeTick = async () => ((await ports.bridge.tick()).tokens as Record<string, unknown>[])[0];
  const dry = await bridgeTick();
  assert.equal(dry.dry, true); assert.equal(quotes[0].dry, true);
  assert.equal(transactions.length, 1); // Only the skim, no treasury transfer.
  treasury = 200_000n;
  assert.equal((await bridgeTick()).dry, true);
  assert.equal(transactions.length, 1);
  treasury = 300_000n;
  assert.equal((await bridgeTick()).status, 'deposit_broadcast');
  assert.equal(quotes[2].dry, false); assert.equal(quotes[2].recipientType, 'DESTINATION_CHAIN');
  assert.equal(transactions.length, 2);
  const sent = parseTransaction(transactions[1]);
  assert.equal(decodeFunctionData({ abi: erc20Abi, data: sent.data! }).functionName, 'transfer');
  treasury = 0n;
  assert.equal((await bridgeTick()).status, 'PROCESSING');
  swapStatus = 'SUCCESS'; assert.equal((await bridgeTick()).status, 'SUCCESS');
  assert.equal((await bridgeTick()).status, 'empty_treasury');
  assert.equal(transactions.length, 2);
  // A refunded swap is not retried at once: the next transfer waits an hour, then two after a second refund.
  treasury = 300_000n; swapStatus = 'REFUNDED';
  assert.equal((await bridgeTick()).status, 'deposit_broadcast'); assert.equal((await bridgeTick()).status, 'REFUNDED');
  assert.equal((await bridgeTick()).status, 'waiting_after_failed_swap'); clock += 3_599_999;
  assert.equal((await bridgeTick()).status, 'waiting_after_failed_swap'); assert.equal(transactions.length, 3);
  clock += 1; assert.equal((await bridgeTick()).status, 'deposit_broadcast'); assert.equal((await bridgeTick()).status, 'REFUNDED');
  clock += 3_600_000; assert.equal((await bridgeTick()).status, 'waiting_after_failed_swap');
  clock += 3_600_000; assert.equal((await bridgeTick()).status, 'deposit_broadcast'); assert.equal(transactions.length, 5);
});

test('priced EVM snapshots use one finalized block, heartbeat boundaries and native-token cumulative units', async t => {
  const feed = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const oracle = '0xffffffffffffffffffffffffffffffffffffffff';
  const lst = '0xcccccccccccccccccccccccccccccccccccccccc';
  const pt = '0xdddddddddddddddddddddddddddddddddddddddd';
  const feedAbi = parseAbi(['function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)']);
  const oracleAbi = parseAbi(['function getPtToAssetRate(address market, uint32 duration) view returns (uint256)']);
  let answer = 276_980_158_299n, updatedAt = 3800n, oracleAnswer = 997_201_215_082_272_248n, failed = false;
  const reads: any[] = [];
  const fake = await rpc((method, params) => {
    if (method === 'eth_getBlockByNumber') { assert.equal(params[0], 'finalized'); return { number: '0x64', timestamp: '0x1388' }; }
    if (method === 'eth_getLogs') return [{ address: params[0].address, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: zeroAddress, to: holder } }), data: encodeAbiParameters([{ type: 'uint256' }], [100n]), blockNumber: '0x64', blockHash: hash, transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false }];
    if (method === 'eth_call') {
      const target = params[0].to.toLowerCase();
      if (target === multicall) return simulated(0n, 0n);
      reads.push(params);
      if (target === feed) {
        assert.equal(decodeFunctionData({ abi: feedAbi, data: params[0].data }).functionName, 'latestRoundData');
        if (failed) throw new Error('fixture feed unavailable');
        return encodeAbiParameters([{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }], [1n, answer, 1n, updatedAt, 1n]);
      }
      if (target === oracle) {
        const [market, duration] = decodeFunctionData({ abi: oracleAbi, data: params[0].data }).args!;
        assert.equal(market.toLowerCase(), address); assert.equal(duration, 900);
        return encodeAbiParameters([{ type: 'uint256' }], [oracleAnswer]);
      }
      const call = decodeFunctionData({ abi: vaultAbi, data: params[0].data });
      return call.functionName === 'yieldToken' ? encodeAbiParameters([{ type: 'address' }], [target === lst ? lst : pt])
        : encodeAbiParameters([{ type: 'uint256' }], [call.functionName === 'unpaid' ? 0n : 10n ** 18n]);
    }
    throw new Error('unexpected RPC');
  }); t.after(fake.close);
  const ports = evmPorts({ rpc: fake.url, chainId: 8453, key: ('0x' + '12'.repeat(32)) as Hex, fromBlock: 100n,
    vaults: [{ kind: 'aave', address }, { kind: 'rate', address: lst, feed, heartbeat: 1200 }, { kind: 'pendle', address: pt, oracle, market: address }],
    bridgeTokens: [], oneClickUrl: 'http://unused.invalid', destinationAsset: 'near-usdc', recipient: 'treasury.near', slippageBps: 100, minYieldMicro: 10_000n });
  const [aave, rate, pendle] = ports.vaults;
  assert.equal((await aave.snapshot()).rate, 10n ** 18n);
  const priced = await rate.snapshot();
  assert.equal(priced.rate, 2_769_801_582n); // Drops only feed precision; cumulative token wei are untouched.
  assert.deepEqual(priced.entries, [[`eip155:8453:${holder}`, 10n ** 18n]]);
  assert.equal((await pendle.snapshot()).rate, 997_201n);
  assert.ok(reads.every(read => read[1] === '0x64'));
  const connector = new FakeConnector(), skipped: Record<string, unknown>[] = [];
  // The real snapshot adapter is exercised; only the transaction is a no-op fixture.
  const keeper = new Keeper([{ ...rate, async skim() {} }], connector, ports.bridge,
    (event, details) => { if (event === 'posting_skipped') skipped.push(details); });
  updatedAt = 3799n; await assert.rejects(rate.snapshot(), /stale_feed/); await keeper.tick();
  updatedAt = 5000n;
  for (answer of [0n, -1n]) { await assert.rejects(rate.snapshot(), /nonpositive_feed/); await keeper.tick(); }
  answer = 276_980_158_299n; failed = true;
  await assert.rejects(rate.snapshot(), /feed_read_failed/); await keeper.tick();
  assert.equal(connector.postCalls, 0);
  assert.deepEqual(skipped.map(event => event.reason), ['stale_feed', 'nonpositive_feed', 'nonpositive_feed', 'feed_read_failed']);
  oracleAnswer = 0n; await assert.rejects(pendle.snapshot(), /nonpositive_feed/);
  const held = (await ports.bridge.tick()).tokens as { token: string; status: string }[];
  assert.ok(held.some(entry => entry.token === lst && entry.status === 'held_unconfigured'));
  assert.ok(held.some(entry => entry.token === pt && entry.status === 'held_unconfigured'));
});
