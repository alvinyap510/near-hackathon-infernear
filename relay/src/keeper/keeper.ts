import { reportError, type Connector, type Report } from '../types.ts';

export type VaultKind = 'aave' | 'rate' | 'pendle' | 'rhea' | 'topup';
// `work` names why a transaction is needed, decided from free reads; absent means none is.
export type VaultSnapshot = { block: bigint; unpaid: bigint; paid: bigint; rate: bigint; busy?: boolean; entries: [string, bigint][]; work?: string | null };
export interface VaultPort {
  id: string;
  kind: VaultKind;
  // The only transaction: EVM skim(), or the Rhea vault's run(). Sent only for snapshot().work.
  skim(): Promise<void>;
  // Reads only; never sends a transaction.
  snapshot(): Promise<VaultSnapshot>;
}
export interface BridgePort { tick(): Promise<Record<string, unknown>> }
export type NearBalance = { account: string; free: bigint };
export class RateUnavailable extends Error {
  reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}

// Entries per post_credits call: about 110 bytes each at most, well inside NEAR's 16 KiB log limit.
const POST_BATCH = 100;

export class Keeper {
  private vaults: VaultPort[];
  private connector: Connector;
  private bridge: BridgePort;
  private report: Report;
  private monitor?: { balances(): Promise<NearBalance[]>; minimum: bigint };
  private now: () => number;
  private sent = new Map<string, { work: string; repeats: number; next: number }>();
  constructor(vaults: VaultPort[], connector: Connector, bridge: BridgePort, report: Report,
    monitor?: { balances(): Promise<NearBalance[]>; minimum: bigint }, now: () => number = Date.now) {
    this.vaults = vaults; this.connector = connector; this.bridge = bridge; this.report = report; this.monitor = monitor; this.now = now;
  }
  // Every transaction costs gas, even one that fails. Send once per distinct piece of work;
  // if the same work is still there afterwards, wait 1, 2, 4... minutes (at most 6 hours) before retrying.
  private async send(key: string, work: string, transaction: () => Promise<void>): Promise<boolean> {
    const last = this.sent.get(key), now = this.now();
    const repeated = last?.work === work;
    if (repeated && now < last!.next) return false;
    const repeats = repeated ? last!.repeats + 1 : 0;
    this.sent.set(key, { work, repeats, next: now + Math.min(60_000 * 2 ** repeats, 21_600_000) });
    await transaction();
    return true;
  }
  // One pass of free reads per vault. A transaction is sent only when those reads show work for it.
  // With `only`, the pass covers that kind of vault alone and skips the bridge and the monitors.
  async tick(only?: VaultKind): Promise<void> {
    for (const vault of this.vaults) {
      if (only && vault.kind !== only) continue;
      try {
        const snapshot = await vault.snapshot();
        if (snapshot.unpaid !== 0n || snapshot.busy) {
          this.report('posting_skipped', { vault: vault.id, reason: snapshot.busy ? 'vault_busy' : 'unpaid_yield', block: String(snapshot.block) });
        } else {
          // Cumulative entries only grow, so an equal total means the connector already has every one.
          const total = snapshot.entries.reduce((sum, [, amount]) => sum + amount, 0n);
          // A rejected post waits 1, 2, 4... minutes whatever the amounts become; the delay ends once a post lands.
          if (total === (await this.connector.posted(vault.id)).total) this.sent.delete(`post:${vault.id}`);
          else if (await this.send(`post:${vault.id}`, 'post', async () => {
            // The connector logs every entry it is given and NEAR caps a transaction's logs at 16 KiB,
            // so a long holder list is posted in batches. Entries are cumulative: a batch that already
            // landed is a no-op if the rest are retried.
            for (let from = 0; from < snapshot.entries.length; from += POST_BATCH)
              await this.connector.postCredits(vault.id, snapshot.paid, snapshot.rate, snapshot.block, snapshot.entries.slice(from, from + POST_BATCH));
          })) {
            this.sent.delete(`post:${vault.id}`);
            this.report('credits_posted', { vault: vault.id, kind: vault.kind, paid_cum: String(snapshot.paid), rate: String(snapshot.rate), source_block: String(snapshot.block), holders: snapshot.entries.length });
          }
        }
        if (!snapshot.work || snapshot.busy) this.sent.delete(`work:${vault.id}`);
        else if (await this.send(`work:${vault.id}`, snapshot.work, () => vault.skim()))
          this.report('vault_transaction', { vault: vault.id, kind: vault.kind, work: snapshot.work });
      } catch (error) {
        if (error instanceof RateUnavailable) this.report('posting_skipped', { vault: vault.id, reason: error.reason });
        else reportError(this.report, 'keeper_retry', error, { vault: vault.id });
      }
    }
    if (only) return;
    try { this.report('bridge', await this.bridge.tick()); }
    catch (error) { reportError(this.report, 'bridge_retry', error); }
    try { this.report('connector_storage', await this.connector.storageBalance()); }
    catch (error) { reportError(this.report, 'storage_monitor_retry', error); }
    if (this.monitor) {
      try {
        for (const balance of await this.monitor.balances()) {
          this.report(balance.free < this.monitor.minimum ? 'low_near_balance' : 'near_balance', { account: balance.account, free_yocto: String(balance.free) });
        }
      } catch (error) { reportError(this.report, 'balance_monitor_retry', error); }
    }
  }
}
