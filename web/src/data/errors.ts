/** A failure the UI shows to the user as-is, with a code it can branch on. */
export class DataError extends Error {
  readonly code: string;
  /** The relay's whole error body, when it carries more than the code and message. */
  readonly body?: unknown;
  constructor(code: string, message: string, body?: unknown) {
    super(message);
    this.code = code;
    this.body = body;
  }
}

/** U128/uint amounts must arrive as decimal strings, never imprecise JSON numbers. */
export function readAmount(value: unknown, code = 'near_rpc'): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new DataError(code, 'Provider returned an invalid integer amount.');
  return BigInt(value);
}
