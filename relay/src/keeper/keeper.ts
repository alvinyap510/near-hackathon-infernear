import { reportError, type Connector, type Report } from '../types.ts';

export type VaultKind = 'aave' | 'rate' | 'pendle' | 'rhea';
export type VaultSnapshot = { block: bigint; unpaid: bigint; paid: bigint; rate: bigint; busy?: boolean; entries: [string, bigint][] };
export interface VaultPort {
  id: string;
  kind: VaultKind;
  // EVM skim(), or the Rhea vault's run().
  skim(): Promise<void>;
  snapshot(): Promise<VaultSnapshot>;
}
export interface BridgePort { tick(): Promise<Record<string, unknown>> }
export type NearBalance = { account: string; free: bigint };
export class RateUnavailable extends Error {
  reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; }
}

export class Keeper {
  private vaults: VaultPort[];
  private connector: Connector;
  private bridge: BridgePort;
  private report: Report;
  private monitor?: { balances(): Promise<NearBalance[]>; minimum: bigint };
  constructor(vaults: VaultPort[], connector: Connector, bridge: BridgePort, report: Report,
    monitor?: { balances(): Promise<NearBalance[]>; minimum: bigint }) {
    this.vaults = vaults; this.connector = connector; this.bridge = bridge; this.report = report; this.monitor = monitor;
  }
  async tick(): Promise<void> {
    for (const vault of this.vaults) {
      try {
        await vault.skim();
        const snapshot = await vault.snapshot();
        if (snapshot.unpaid !== 0n || snapshot.busy) {
          this.report('posting_skipped', { vault: vault.id, reason: snapshot.busy ? 'vault_busy' : 'unpaid_yield', block: String(snapshot.block) }); continue;
        }
        await this.connector.postCredits(vault.id, snapshot.paid, snapshot.rate, snapshot.block, snapshot.entries);
        this.report('credits_posted', { vault: vault.id, kind: vault.kind, paid_cum: String(snapshot.paid), rate: String(snapshot.rate), source_block: String(snapshot.block), holders: snapshot.entries.length });
      } catch (error) {
        if (error instanceof RateUnavailable) this.report('posting_skipped', { vault: vault.id, reason: error.reason });
        else reportError(this.report, 'keeper_retry', error, { vault: vault.id });
      }
    }
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
