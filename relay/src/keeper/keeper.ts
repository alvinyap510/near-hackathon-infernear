import type { Connector, Report } from '../types.ts';

export interface VaultPort {
  id: string;
  skim(): Promise<void>;
  snapshot(): Promise<{ block: bigint; unpaid: bigint; paid: bigint; entries: [string, bigint][] }>;
}
export interface BridgePort {
  tick(): Promise<{ dry: boolean; amount: string; [key: string]: unknown }>;
}

export class Keeper {
  private vaults: VaultPort[];
  private connector: Connector;
  private bridge: BridgePort;
  private report: Report;
  constructor(vaults: VaultPort[], connector: Connector, bridge: BridgePort, report: Report) {
    this.vaults = vaults; this.connector = connector; this.bridge = bridge; this.report = report;
  }
  async tick(): Promise<void> {
    for (const vault of this.vaults) {
      try {
        await vault.skim();
        const snapshot = await vault.snapshot();
        if (snapshot.unpaid !== 0n) { this.report('posting_skipped', { vault: vault.id, reason: 'unpaid_yield', block: String(snapshot.block) }); continue; }
        await this.connector.postCredits(vault.id, snapshot.paid, snapshot.entries);
        this.report('credits_posted', { vault: vault.id, paid_cum: String(snapshot.paid), holders: snapshot.entries.length, block: String(snapshot.block) });
      } catch (error) { this.report('keeper_retry', { vault: vault.id, error: String(error) }); }
    }
    try { this.report('bridge', await this.bridge.tick()); }
    catch (error) { this.report('bridge_retry', { error: String(error) }); }
    try { this.report('connector_storage', await this.connector.storageBalance()); }
    catch (error) { this.report('storage_monitor_retry', { error: String(error) }); }
  }
}
