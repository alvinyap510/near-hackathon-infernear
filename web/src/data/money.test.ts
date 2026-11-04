import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPerMillion, formatUsd, parseUsdc, signedUsageCost } from './money.ts';
import type { Receipt } from './types.ts';

test('formatUsd rounds down and groups thousands', () => {
  assert.equal(formatUsd(1_000_000_000n), '$1,000.00');
  assert.equal(formatUsd(4_219_999n), '$4.21');
  assert.equal(formatUsd(267n, 6), '$0.000267');
  assert.equal(formatUsd(0n), '$0.00');
});

test('parseUsdc accepts up to 6 decimals and rejects anything else', () => {
  assert.equal(parseUsdc('250'), 250_000_000n);
  assert.equal(parseUsdc('1,000.5'), 1_000_500_000n);
  assert.equal(parseUsdc('0.000001'), 1n);
  assert.equal(parseUsdc('0.0000001'), null);
  assert.equal(parseUsdc('-1'), null);
  assert.equal(parseUsdc('1e3'), null);
  assert.equal(parseUsdc(''), null);
});

test('formatPerMillion converts nano-USD per token', () => {
  assert.equal(formatPerMillion(300n), '$0.30 / M');
});

const receipt: Receipt = {
  inferenceId: 'inf-1',
  chatId: 'chatcmpl-1',
  model: 'm',
  promptTokens: 38,
  completionTokens: 212,
  inPriceNano: 300n,
  outPriceNano: 1200n,
  source: 'signed_usage',
};

test('signedUsageCost ceils each token kind', () => {
  // ceil(38 × 300 / 1000) = 12, ceil(212 × 1200 / 1000) = 255
  assert.equal(signedUsageCost(receipt), 267n);
});

test('signedUsageCost has nothing to recompute for a billing receipt', () => {
  assert.equal(
    signedUsageCost({ ...receipt, source: 'billing', promptTokens: null, completionTokens: null }),
    null,
  );
});
