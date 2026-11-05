import { Account as NearAccount, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { InsufficientCredit, Mutex, type Connector, type Receipt } from '../types.ts';

import type { VaultPort, NearBalance } from '../keeper/keeper.ts';
import type { SignedOperations, SignedIntent } from '../gateway/signed.ts';

export async function nearConnector(config: { rpc: string; contract: string; gatewayAccount: string; gatewayKey: string; keeperAccount: string; keeperKey: string; relayAccount: string; relayKey: string; rheaVault: string; intents: string }): Promise<Connector & SignedOperations & { rhea: VaultPort; balances(): Promise<NearBalance[]> }> {
  const provider = new JsonRpcProvider({ url: config.rpc });
  const gateway = new NearAccount(config.gatewayAccount, provider, config.gatewayKey as KeyPairString);
  const keeper = new NearAccount(config.keeperAccount, provider, config.keeperKey as KeyPairString);
  const relay = new NearAccount(config.relayAccount, provider, config.relayKey as KeyPairString);
  const locks = new Map<string, Mutex>();
  const lockFor = (account: NearAccount) => {
    let lock = locks.get(account.accountId);
    if (!lock) { lock = new Mutex(); locks.set(account.accountId, lock); }
    return lock;
  };
  const view = (method: string, args: Record<string, unknown>) => provider.callFunction<any>({ contractId: config.contract, method, args, blockQuery: { finality: 'final' } });
  const call = (account: NearAccount, methodName: string, args: Record<string, unknown>, contractId = config.contract) => lockFor(account).run(async () => {
    try {
      const outcome = await account.callFunctionRaw({ contractId, methodName, args, gas: 300_000_000_000_000n, deposit: 0n, waitUntil: 'FINAL' });
      const status = outcome.status;
      if (typeof status !== 'object' || !('SuccessValue' in status)) throw new Error(JSON.stringify(status));
      const text = Buffer.from(status.SuccessValue, 'base64').toString();
      if (!outcome.transaction) throw new Error('Missing transaction outcome');
      return { value: text ? JSON.parse(text) : undefined, tx_hash: outcome.transaction.hash };
    } catch (error) {
      if (/insufficient credit/.test(String(error))) throw new InsufficientCredit('insufficient_credit');
      throw error;
    }
  });
  return {
    async withdraw(message: string, signature: string) {
      const result = await call(relay, 'request_withdraw', { message, signature }, config.rheaVault);
      return { tx_hash: result.tx_hash };
    },
    async executeIntents(signed: SignedIntent[]) {
      const result = await call(relay, 'execute_intents', { signed }, config.intents);
      return { tx_hash: result.tx_hash };
    },
    rhea: {
      id: `near:mainnet:${config.rheaVault}`, kind: 'rhea',
      async skim() { await call(relay, 'run', {}, config.rheaVault); },
      async snapshot() {
        const state = await provider.callFunctionRaw({ contractId: config.rheaVault, method: 'busy', args: {}, blockQuery: { finality: 'final' } });
        const block = state.block_height;
        const read = (method: string, args: Record<string, unknown> = {}) => provider.callFunction<any>({ contractId: config.rheaVault, method, args, blockQuery: { blockId: block } });
        const busy = JSON.parse(Buffer.from(state.result).toString()) as boolean;
        const [unpaid, paid] = await Promise.all([read('unpaid'), read('paid_total')]);
        const entries: [string, bigint][] = [];
        if (!busy && BigInt(unpaid) === 0n) {
          for (let from = 0;; from += 100) {
            const holders = await read('holders', { from, limit: 100 }) as string[];
            for (const user of holders) {
              const position = await read('position', { user });
              entries.push([user, BigInt(position.yield_credited)]);
            }
            if (holders.length < 100) break;
          }
        }
        return { block: BigInt(block), busy, unpaid: BigInt(unpaid), paid: BigInt(paid), rate: 10n ** 18n, entries };
      },
    },
    async balances() {
      return Promise.all([...new Set([config.relayAccount, config.rheaVault])].map(async account => {
        const state = await provider.viewAccount({ accountId: account, blockQuery: { finality: 'final' } });
        // NEAR storage locks 1e19 yocto per byte; report the spendable gas/storage headroom.
        const free = BigInt(state.amount) - BigInt(state.storage_usage) * 10n ** 19n;
        return { account, free: free > 0n ? free : 0n };
      }));
    },
    async account(user) {
      const value = await view('account', { user });
      return { credited: BigInt(value.credited), spent: BigInt(value.spent), available: BigInt(value.available), key_epoch: value.key_epoch };
    },
    async debitedAmount(id) { const value = await view('debited_amount', { inference_id: id }); return value === null ? null : BigInt(value); },
    async debit(user: string, amount: bigint, receipt: Receipt) { await call(gateway, 'debit', { user, amount_micro: String(amount), receipt }); },
    async bumpKeyEpoch(user) { const result = await call(gateway, 'bump_key_epoch', { user }); return { key_epoch: result.value, tx_hash: result.tx_hash }; },
    async postCredits(vault, paid, rate, sourceBlock, entries) { await call(keeper, 'post_credits', { vault, paid_cum: String(paid), rate: String(rate), source_block: Number(sourceBlock), entries: entries.map(([user, amount]) => [user, String(amount)]) }); },
    async storageBalance() {
      const state = await provider.viewAccount({ accountId: config.contract, blockQuery: { finality: 'final' } });
      return { amount: String(state.amount), storage_usage: state.storage_usage };
    },
  };
}
