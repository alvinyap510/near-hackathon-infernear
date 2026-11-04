export type Account = { credited: bigint; spent: bigint; available: bigint; key_epoch: number };
export type Receipt = {
  inference_id: string; chat_id: string; model: string;
  prompt_tokens: number; completion_tokens: number;
  in_price_nano: string; out_price_nano: string;
  source: 'signed_usage' | 'reservation';
};
export interface Connector {
  account(user: string): Promise<Account>;
  debitedAmount(id: string): Promise<bigint | null>;
  debit(user: string, amount: bigint, receipt: Receipt): Promise<void>;
  bumpKeyEpoch(user: string): Promise<{ key_epoch: number; tx_hash: string }>;
  postCredits(vault: string, paid: bigint, entries: [string, bigint][]): Promise<void>;
  storageBalance(): Promise<{ amount: string; storage_usage: number }>;
}
export type Report = (event: string, details: Record<string, unknown>) => void;
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message); this.status = status; this.code = code;
  }
}
export class InsufficientCredit extends Error {}
// Dependency messages/stacks may contain bodies, RPC credentials and URL queries.
// Report only fixed classifications, never an error's message, name, cause or URL.
export function reportError(report: Report, event: string, error: unknown, details: Record<string, unknown> = {}): void {
  const classification = error instanceof HttpError ? 'http_error'
    : error instanceof InsufficientCredit ? 'insufficient_credit'
    : error instanceof SyntaxError ? 'invalid_json'
    : error instanceof Error ? 'dependency_error' : 'unknown_error';
  report(event, { ...details, error: classification, ...(error instanceof HttpError ? { status: error.status } : {}) });
}
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();
  async run<T>(action: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await action(); } finally { release(); }
  }
}
export const costMicro = (input: number, output: number, inNano: bigint, outNano: bigint): bigint =>
  (BigInt(input) * inNano + BigInt(output) * outNano + 999n) / 1000n;
export const min = (a: bigint, b: bigint): bigint => a < b ? a : b;
