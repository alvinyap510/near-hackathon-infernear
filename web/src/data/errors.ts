/** A failure the UI shows to the user as-is, with a code it can branch on. */
export class DataError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** U128/uint amounts must arrive as decimal strings, never imprecise JSON numbers. */
export function readAmount(value: unknown, code = 'near_rpc'): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new DataError(code, 'Provider returned an invalid integer amount.');
  return BigInt(value);
}
