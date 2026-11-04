import type { Receipt } from './types.ts';

/** USDC has 6 decimals, so 1 base unit = 1 micro-USD in v1 (docs/interfaces.md). */
export const USDC_DECIMALS = 6;
const UNIT = 10n ** BigInt(USDC_DECIMALS);

/** Formats micro-USD as dollars; `digits` is how many decimals to show (rounds down). */
export function formatUsd(micro: bigint, digits = 2): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / UNIT;
  const frac = (abs % UNIT).toString().padStart(USDC_DECIMALS, '0').slice(0, digits);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}$${grouped}${digits > 0 ? `.${frac}` : ''}`;
}

/** Parses a user-typed USDC amount into base units; null if it isn't a valid amount. */
export function parseUsdc(input: string): bigint | null {
  const trimmed = input.trim().replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(trimmed);
  if (!match) return null;
  const frac = match[2] ?? '';
  if (frac.length > USDC_DECIMALS) return null;
  return BigInt(match[1]) * UNIT + BigInt(frac.padEnd(USDC_DECIMALS, '0') || '0');
}

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
