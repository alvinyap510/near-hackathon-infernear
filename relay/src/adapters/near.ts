import { Account as NearAccount, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { InsufficientCredit, Mutex, type Connector, type Receipt } from '../types.ts';

export async function nearConnector(config: { rpc: string; contract: string; gatewayAccount: string; gatewayKey: string; keeperAccount: string; keeperKey: string }): Promise<Connector> {
  const provider = new JsonRpcProvider({ url: config.rpc });
  const gateway = new NearAccount(config.gatewayAccount, provider, config.gatewayKey as KeyPairString);
  const keeper = new NearAccount(config.keeperAccount, provider, config.keeperKey as KeyPairString);
  const gatewayLock = new Mutex(), keeperLock = new Mutex();
  const view = (method: string, args: Record<string, unknown>) => provider.callFunction<any>({ contractId: config.contract, method, args, blockQuery: { finality: 'final' } });
  const call = (account: NearAccount, lock: Mutex, methodName: string, args: Record<string, unknown>) => lock.run(async () => {
    try {
      const outcome = await account.callFunctionRaw({ contractId: config.contract, methodName, args, gas: 300_000_000_000_000n, deposit: 0n, waitUntil: 'FINAL' });
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
    async account(user) {
      const value = await view('account', { user });
      return { credited: BigInt(value.credited), spent: BigInt(value.spent), available: BigInt(value.available), key_epoch: value.key_epoch };
    },
    async debitedAmount(id) { const value = await view('debited_amount', { inference_id: id }); return value === null ? null : BigInt(value); },
    async debit(user: string, amount: bigint, receipt: Receipt) { await call(gateway, gatewayLock, 'debit', { user, amount_micro: String(amount), receipt }); },
    async bumpKeyEpoch(user) { const result = await call(gateway, gatewayLock, 'bump_key_epoch', { user }); return { key_epoch: result.value, tx_hash: result.tx_hash }; },
    async postCredits(vault, paid, entries) { await call(keeper, keeperLock, 'post_credits', { vault, paid_cum: String(paid), entries: entries.map(([user, amount]) => [user, String(amount)]) }); },
    async storageBalance() {
      const state = await provider.viewAccount({ accountId: config.contract, blockQuery: { finality: 'final' } });
      return { amount: String(state.amount), storage_usage: state.storage_usage };
    },
  };
}
