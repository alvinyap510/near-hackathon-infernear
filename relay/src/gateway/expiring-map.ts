import { HttpError } from '../types.ts';

export const MAX_ANONYMOUS_ENTRIES = 10_000;

// Both anonymous maps have fixed TTLs. Insertion order makes expiry amortized O(1),
// and refusing new entries preserves existing nonce proofs and IP rate limits.
export class ExpiringMap<V> {
  private entries = new Map<string, { value: V; expires: number }>();
  private ttl: number;
  private now: () => number;
  constructor(ttl: number, now = Date.now) { this.ttl = ttl; this.now = now; }
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (entry && entry.expires > this.now()) return entry.value;
    this.entries.delete(key);
    return undefined;
  }
  set(key: string, value: V): void {
    const now = this.now();
    for (const [oldest, entry] of this.entries) {
      if (entry.expires > now) break;
      this.entries.delete(oldest);
    }
    if (!this.entries.has(key) && this.entries.size >= MAX_ANONYMOUS_ENTRIES)
      throw new HttpError(503, 'anonymous_capacity', 'Anonymous request capacity reached; retry later');
    this.entries.set(key, { value, expires: now + this.ttl });
  }
  delete(key: string): boolean { return this.entries.delete(key); }
}
