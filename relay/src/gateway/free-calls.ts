import { MAX_ANONYMOUS_ENTRIES } from './expiring-map.ts';

type Usage = { used: number; held: number };
export type FreeHold = { user: string };
export type FreeStatus = { per_user: number; used: number; remaining: number };

export function freeCallLimit(value: string | undefined, name: string): number {
  const parsed = value === undefined ? 0 : Number(value);
  if (value?.trim() === '' || !Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${name}`);
  return parsed;
}

/** Quota only: no money, connector calls or prompts. All mutations are synchronous;
 * callers hold the existing user mutex, and different users cannot interleave an await here. */
export class FreeCalls {
  readonly enabled: boolean;
  private perUser: number;
  private perDay: number;
  private now: () => number;
  private users = new Map<string, Usage>();
  private day = -1;
  private used = 0;
  private held = 0;
  constructor(perUser: number, perDay: number, now: () => number) {
    this.perUser = perUser; this.perDay = perDay; this.now = now;
    this.enabled = perUser > 0 && perDay > 0;
  }
  private rollover(): void {
    const day = Math.floor(this.now() / 86_400_000);
    if (day !== this.day) { this.day = day; this.used = 0; }
    // In-flight calls still hold today's budget after midnight. Completion spends
    // the current day's total, so late replies cannot bypass the 300/day bound.
  }
  status(user: string): FreeStatus {
    if (!this.enabled) return { per_user: 0, used: 0, remaining: 0 };
    this.rollover();
    const usage = this.users.get(user);
    const capacity = usage !== undefined || this.users.size < MAX_ANONYMOUS_ENTRIES;
    return { per_user: this.perUser, used: usage?.used ?? 0,
      remaining: capacity ? Math.max(0, Math.min(this.perUser - (usage?.used ?? 0) - (usage?.held ?? 0), this.perDay - this.used - this.held)) : 0 };
  }
  hold(user: string): FreeHold | undefined {
    if (this.status(user).remaining === 0) return undefined;
    let usage = this.users.get(user);
    if (!usage) { usage = { used: 0, held: 0 }; this.users.set(user, usage); }
    usage.held++; this.held++;
    return { user };
  }
  settle(hold: FreeHold, completed: boolean): void {
    this.rollover();
    const usage = this.users.get(hold.user)!;
    usage.held--; this.held--;
    if (completed) { usage.used++; this.used++; }
    // Forgiven first attempts need no retained entry. Never evict a live hold or
    // a consumed counter: forgetting it would grant the same wallet another trial.
    if (usage.used === 0 && usage.held === 0) this.users.delete(hold.user);
  }
}
