import { DataError } from './errors.ts';
import type { Address, SessionInput } from './types.ts';
export function evmAddress(input: SessionInput): Address {
  if (typeof input === 'string') return input;
  if (input.kind !== 'evm') throw new DataError('wallet_kind', 'This action requires an EVM wallet.');
  return input.address;
}
export const emptyPosition = () => ({ principal: 0n, shares: 0n, yieldCredited: 0n, walletBalance: 0n, allowance: 0n });
