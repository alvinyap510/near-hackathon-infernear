import type { Receipt } from './types.ts';

/** USDC has 6 decimals, so 1 base unit = 1 micro-USD in v1 (docs/interfaces.md). */
export const USDC_DECIMALS = 6;

/** Format token base units by their own decimals (truncates, never passes through Number). */
export function formatAmount(amount: bigint, decimals: 6 | 18, digits: number = decimals): string {
  const abs = amount < 0n ? -amount : amount;
  const unit = 10n ** BigInt(decimals);
  const whole = (abs / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % unit).toString().padStart(decimals, '0').padEnd(digits, '0').slice(0, digits);
  return `${amount < 0n ? '−' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
}
/** Connector credits are micro-USD; this never prices cbETH or PT amounts. */
export function formatUsd(micro: bigint, digits = 2): string {
  const formatted = formatAmount(micro, USDC_DECIMALS, digits);
  return formatted.startsWith('−') ? `−$${formatted.slice(1)}` : `$${formatted}`;
}
export function parseAmount(input: string, decimals: 6 | 18): bigint | null {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(input.trim().replace(/,/g, ''));
  if (!match || (match[2]?.length ?? 0) > decimals) return null;
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((match[2] ?? '').padEnd(decimals, '0') || '0');
}
export const parseUsdc = (input: string): bigint | null => parseAmount(input, USDC_DECIMALS);

/** Formats nano-USD per token as dollars per million tokens. */
export function formatPerMillion(nanoPerToken: bigint): string {
  // nano-USD × 1e6 tokens = micro-USD × 1e3
  return `${formatUsd(nanoPerToken * 1000n)} / M`;
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Combined token cost, rounded once to micro-USD, as the relay computes it. */
export function tokenCost(promptTokens: number, completionTokens: number, inPriceNano: bigint, outPriceNano: bigint): bigint {
  return ceilDiv(BigInt(promptTokens) * inPriceNano + BigInt(completionTokens) * outPriceNano, 1000n);
}

export function signedUsageCost(receipt: Receipt): bigint | null {
  return receipt.source === 'signed_usage'
    ? tokenCost(receipt.promptTokens, receipt.completionTokens, receipt.inPriceNano, receipt.outPriceNano)
    : null;
}

/** A reservation receipt charges the full reservation; signed usage is capped at it. */
export function expectedDebit(receipt: Receipt, reservation: bigint): bigint {
  const signed = signedUsageCost(receipt);
  return signed === null || signed > reservation ? reservation : signed;
}

export const shortHex = (hex: string, head = 6, tail = 4) =>
  hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
