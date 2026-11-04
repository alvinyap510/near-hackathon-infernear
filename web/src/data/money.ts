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

/**
 * Cost of signed usage at the receipt's price snapshot, in micro-USD:
 * ceil(tokens × nano_per_token / 1000) per token kind (docs/interfaces.md).
 * Null for a `billing` receipt, which has no token counts to recompute.
 */
export function signedUsageCost(receipt: Receipt): bigint | null {
  if (receipt.source !== 'signed_usage') return null;
  if (receipt.promptTokens === null || receipt.completionTokens === null) return null;
  return (
    ceilDiv(BigInt(receipt.promptTokens) * receipt.inPriceNano, 1000n) +
    ceilDiv(BigInt(receipt.completionTokens) * receipt.outPriceNano, 1000n)
  );
}

export const shortHex = (hex: string, head = 6, tail = 4) =>
  hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head)}…${hex.slice(-tail)}`;
