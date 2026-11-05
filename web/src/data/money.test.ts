import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expectedDebit, formatPerMillion, formatUsd, parseUsdc, signedUsageCost, tokenCost } from './money.ts';
import type { Receipt } from './types.ts';

test('formatUsd rounds down and groups thousands', () => {
  assert.equal(formatUsd(1_000_000_000n), '$1,000.00');
  assert.equal(formatUsd(4_219_999n), '$4.21');
  assert.equal(formatUsd(267n, 6), '$0.000267');
  assert.equal(formatUsd(0n), '$0.00');
});
test('parseUsdc retains base units and rejects excess decimals or exponents', () => {
  assert.equal(parseUsdc('250'), 250_000_000n);
  assert.equal(parseUsdc('1,000.5'), 1_000_500_000n);
  assert.equal(parseUsdc('0.000001'), 1n);
  assert.equal(parseUsdc('9007199254740993.000001'), 9_007_199_254_740_993_000001n);
  for (const invalid of ['0.0000001', '-1', '1e3', '']) assert.equal(parseUsdc(invalid), null);
});
test('formatPerMillion converts nano-USD per token', () => assert.equal(formatPerMillion(300n), '$0.30 / M'));

const receipt: Receipt = {
  inferenceId: 'inf-1', chatId: 'chatcmpl-1', model: 'm', promptTokens: 38, completionTokens: 212,
  inPriceNano: 300n, outPriceNano: 1200n, source: 'signed_usage',
};
test('signed usage rounds the combined cost once, matching the relay', () => {
  assert.equal(signedUsageCost(receipt), 266n);
  assert.equal(tokenCost(1, 1, 1n, 1n), 1n);
});
test('bill check compares the lesser of signed cost and reservation', () => {
  assert.equal(expectedDebit(receipt, 200n), 200n);
  assert.equal(expectedDebit(receipt, 1000n), 266n);
  assert.equal(expectedDebit(receipt, 266n), 266n);
});
test('a reservation receipt charges the reserved maximum and has numeric bound fields', () => {
  const fallback: Receipt = { ...receipt, source: 'reservation', promptTokens: 100, completionTokens: 256 };
  assert.equal(signedUsageCost(fallback), null);
  assert.equal(expectedDebit(fallback, 500n), 500n);
});
test('integer billing never draws beyond the reserved credit amount', () => {
  for (let input = 0; input < 100; input++) {
    const r = { ...receipt, promptTokens: input };
    for (const reserved of [0n, 1n, 100n, 1000n]) {
      const charged = expectedDebit(r, reserved);
      assert(charged <= reserved);
      assert(charged <= signedUsageCost(r)!);
      const available = 2000n;
      assert.equal((available - charged) + charged, available);
    }
  }
});

test('token formatting/parsing keeps 6dp USDC and 18dp LST/PT distinct without floating-point loss', async () => {
  const { formatAmount, parseAmount } = await import('./money.ts');
  assert.equal(formatAmount(1n, 18), '0.000000000000000001');
  assert.equal(formatAmount(1_234_567n, 6, 2), '1.23');
  assert.equal(formatAmount(1_234_567n, 6, 8), '1.23456700');
  assert.equal(formatAmount(-123_456_789_123_456_789n, 18, 8), '−0.12345678');
  assert.equal(parseAmount('9007199254740993.000000000000000001', 18), 9_007_199_254_740_993_000_000_000_000_000_001n);
  assert.equal(parseAmount('0.000000000000000001', 18), 1n);
  assert.equal(parseAmount('0.0000001', 6), null);
  assert.equal(parseAmount('0.0000000000000000001', 18), null);
});
