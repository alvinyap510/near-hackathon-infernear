import type { CatalogueVault, VaultKind } from './types.ts';
export const STRATEGIES: Record<VaultKind, Pick<CatalogueVault, 'yieldShape' | 'strategy'>> = {
  aave: { yieldShape: 'Growing balance', strategy: 'Supply USDC to Aave; principal remains redeemable and yield funds inference credits.' },
  rate: { yieldShape: 'Uncapped appreciation', strategy: 'Hold cbETH; its ETH exchange-rate growth funds inference credits.' },
  pendle: { yieldShape: 'Capped appreciation', strategy: 'Hold PT-deJAAA towards maturity; attributed yield funds inference credits.' },
  rhea: { yieldShape: 'Lending interest', strategy: 'Supply native USDC to Rhea Lend on NEAR; yield funds inference credits.' },
};
/** Integer-only percentage display from an on-chain decimal ratio. */
export function decimalPercent(ratio: string): string {
  if (!/^\d+(\.\d+)?$/.test(ratio)) throw new Error('Invalid on-chain rate');
  const [whole, fraction = ''] = ratio.split('.');
  const bps = BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  return `${bps / 100n}.${String(bps % 100n).padStart(2, '0')}%`;
}
