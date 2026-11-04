import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbi, parseTransaction, zeroAddress, type Hex } from 'viem';
import { KeyPair, decodeSignedTransaction } from 'near-api-js';
import { evmPorts } from '../src/adapters/evm.ts';
import { nearConnector } from '../src/adapters/near.ts';
import type { Receipt } from '../src/types.ts';

const address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const usdc = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const holder = '0x1111111111111111111111111111111111111111';
const hash = ('0x' + '11'.repeat(32)) as Hex;
const vaultAbi = parseAbi(['function skim()', 'function unpaid() view returns (uint256)', 'function paidTotal() view returns (uint256)', 'function yieldCredited(address) view returns (uint256)', 'function yieldToken() view returns (address)']);

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
  const fake = await rpc((method, params) => {
    calls.push({ method, params });
    if (method === 'block') return { header: { hash: '11111111111111111111111111111111', height: 10 } };
    if (method === 'query') {
      if (params.request_type === 'call_function') {
        assert.equal(params.finality, 'final');
        const value = params.method_name === 'account' ? accountValue : '7';
        return { result: [...Buffer.from(JSON.stringify(value))], logs: [], block_height: 10, block_hash: '11111111111111111111111111111111' };
      }
      if (params.request_type === 'view_account') return { amount: '1000000000000000000000000', locked: '0', storage_usage: 1000, code_hash: '11111111111111111111111111111111', block_height: 10, block_hash: '11111111111111111111111111111111' };
      if (params.request_type === 'view_access_key') return { nonce: 10, permission: 'FullAccess', block_hash: '11111111111111111111111111111111', block_height: 10 };
    }
    if (method === 'send_tx') {
      const transaction = decodeSignedTransaction(Buffer.from(params.signed_tx_base64, 'base64')).transaction;
      const call = transaction.actions[0].functionCall!;
      signed.push({ signer: transaction.signerId, method: call.methodName, args: JSON.parse(Buffer.from(call.args).toString()), deposit: call.deposit });
      return { final_execution_status: 'FINAL', status: { SuccessValue: Buffer.from(call.methodName === 'bump_key_epoch' ? '2' : '').toString('base64') },
        transaction: { hash: 'fixture-tx', signer_id: transaction.signerId, public_key: key.getPublicKey().toString(), nonce: 11, receiver_id: 'connector.near', actions: [], signature: '' }, receipts_outcome: [], transaction_outcome: { id: 'fixture-tx', outcome: { logs: [], receipt_ids: [], gas_burnt: 0, tokens_burnt: '0', executor_id: transaction.signerId, status: { SuccessValue: '' } }, proof: [], block_hash: '11111111111111111111111111111111' } };
    }
    throw new Error('Unhandled fake NEAR method ' + method);
  }); t.after(fake.close);
  const connector = await nearConnector({ rpc: fake.url, contract: 'connector.near', gatewayAccount: 'gateway.near', gatewayKey: key.toString(), keeperAccount: 'keeper.near', keeperKey: key.toString() });
  assert.deepEqual(await connector.account('fixture-user'), { credited: 100n, spent: 7n, available: 93n, key_epoch: 1 });
  assert.equal(await connector.debitedAmount('fixture-id'), 7n);
  assert.equal((await connector.storageBalance()).storage_usage, 1000);
  const receipt: Receipt = { inference_id: 'fixture-id', chat_id: 'fixture-chat', model: 'fixture/tee', prompt_tokens: 5, completion_tokens: 2, in_price_nano: '1', out_price_nano: '2', source: 'reservation' };
  await connector.debit('fixture-user', 7n, receipt);
  assert.deepEqual(await connector.bumpKeyEpoch('fixture-user'), { key_epoch: 2, tx_hash: 'fixture-tx' });
  await connector.postCredits('fixture-vault', 100n, [['fixture-user', 100n]]);
  assert.deepEqual(signed.map(tx => tx.signer), ['gateway.near', 'gateway.near', 'keeper.near']);
  assert.ok(signed.every(tx => tx.deposit === 0n));
  assert.deepEqual(signed[0].args.receipt, receipt);
  assert.deepEqual(signed[2].args.entries, [['fixture-user', '100']]);
});

test('real EVM adapter reads every holder at one finalized block and 1Click sends only above minimum', async t => {
  let treasury = 100_000n;
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
  const ports = evmPorts({ rpc: fake.url, chainId: 8453, key: ('0x' + '12'.repeat(32)) as Hex, usdc, addresses: [address], fromBlock: 90n,
    oneClickUrl: `http://127.0.0.1:${(oneClick.address() as import('node:net').AddressInfo).port}`, originAsset: 'fixture-origin', destinationAsset: 'fixture-destination', recipient: 'treasury.near', slippageBps: 100 });
  await ports.vaults[0].skim();
  const snapshot = await ports.vaults[0].snapshot();
  assert.deepEqual(snapshot.entries, [[`eip155:8453:${holder}`, 100n]]);
  assert.equal(snapshot.block, 100n); assert.equal(snapshot.unpaid, 0n); assert.equal(snapshot.paid, 100n);
  assert.ok(reads.every(read => read.block === '0x64'));
  assert.equal(scans[0].fromBlock, '0x5a'); assert.equal(scans[0].toBlock, '0x64');
  const dry = await ports.bridge.tick();
  assert.equal(dry.dry, true); assert.equal(quotes[0].dry, true);
  assert.equal(transactions.length, 1); // Only the skim, no treasury transfer.
  treasury = 200_000n;
  assert.equal((await ports.bridge.tick()).status, 'deposit_broadcast');
  assert.equal(quotes[1].dry, false); assert.equal(quotes[1].recipientType, 'DESTINATION_CHAIN');
  assert.equal(transactions.length, 2);
  const sent = parseTransaction(transactions[1]);
  assert.equal(decodeFunctionData({ abi: erc20Abi, data: sent.data! }).functionName, 'transfer');
  treasury = 0n;
  assert.equal((await ports.bridge.tick()).status, 'PROCESSING');
  swapStatus = 'SUCCESS'; assert.equal((await ports.bridge.tick()).status, 'SUCCESS');
  assert.equal((await ports.bridge.tick()).status, 'empty_treasury');
  assert.equal(transactions.length, 2);
});
