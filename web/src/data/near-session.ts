import { Buffer } from 'buffer';
import { actionCreators } from '@near-js/transactions';
import type { LiveConfig } from '../config.ts';
import { DataError, readAmount } from './errors.ts';
import { nearProofMessage, nearProofNonce } from './proof.ts';
import type { NearView } from './rhea.ts';
import type { Wallets } from './wallets.ts';
import type { NearWalletProof, Session, TxResult } from './types.ts';
type NearSession = Extract<Session, { kind: 'near' }>;
export function nearSessionData(settings: LiveConfig, ports: { wallets: Wallets; view: NearView; relay<T>(path: string): Promise<T>; origin(): string; now(): Date }) {
  const owner = (session: NearSession) => {
    if (session.kind !== 'near') throw new DataError('wallet_kind', 'This action requires a NEAR wallet.');
    return `near:mainnet:${session.accountId}`;
  };
  const send = async (session: NearSession, receiverId: string, methodName: string, args: Record<string, unknown>): Promise<TxResult> => {
    const check=ports.wallets.operation(),wallet = await ports.wallets.nearWallet(session.accountId);check();
    const result = await wallet.signAndSendTransaction({ signerId: session.accountId, receiverId,
      actions: [actionCreators.functionCall(methodName, args, 100_000_000_000_000n, 1n)] });
    if (!result) throw new DataError('wallet_redirect', 'Return from your wallet and refresh the vault position.');
    if (typeof result.status === 'object' && 'Failure' in result.status || result.receipts_outcome?.some(r => typeof r.outcome.status === 'object' && 'Failure' in r.outcome.status))
      throw new DataError('transaction_reverted', 'The NEAR transaction failed.');
    return { txHash: result.transaction.hash };
  };
  return {
    async walletProof(session: NearSession, statement?: string): Promise<NearWalletProof> {
      const check=ports.wallets.operation(),wallet = await ports.wallets.nearWallet(session.accountId);check();
      if (!wallet.signMessage) throw new DataError('wallet_proof', 'This wallet does not support NEP-413 message signing.');
      const { nonce } = await ports.relay<{ nonce: string }>('/auth/nonce');
      const message = nearProofMessage(nonce, session.accountId, ports.now(), statement), bytes = await nearProofNonce(nonce);
      const recipient = new URL(ports.origin()).host;
      check();const signed = await wallet.signMessage({ message, nonce: Buffer.from(bytes), recipient });
      check();if (!signed) throw new DataError('wallet_redirect', 'Return from your wallet and request a fresh proof.');
      if (signed.accountId !== session.accountId) throw new DataError('wallet_account', 'The wallet signed with a different NEAR account.');
      return { near: { account_id: signed.accountId, public_key: signed.publicKey, signature: signed.signature,
        message, nonce: Buffer.from(bytes).toString('base64'), recipient } };
    },
    async rheaDepositNear(session: NearSession, assets: bigint): Promise<TxResult> {
      const check=ports.wallets.operation(),user = owner(session);
      if (assets < 1_000_000n) throw new DataError('amount', 'The minimum Rhea deposit is 1 USDC.');
      if(settings.rheaStatusNote)throw new DataError('paused',settings.rheaStatusNote);
      const coverage=readAmount(await ports.view('coverage',{},settings.rheaVaultAccount));check();
      if(coverage<10n**18n)throw new DataError('deficit','Rhea deposits are unavailable while coverage is below 100%.');
      const balance = readAmount(await ports.view('ft_balance_of', { account_id: session.accountId }, settings.nearUsdcAccount));
      if (assets > balance) throw new DataError('balance', 'That is more USDC than the wallet holds.');
      check();return send(session, settings.nearUsdcAccount, 'ft_transfer_call', { receiver_id: settings.rheaVaultAccount, amount: String(assets), msg: JSON.stringify({ user }) });
    },
    async rheaWithdrawNear(session: NearSession, assets: bigint): Promise<TxResult> {
      const check=ports.wallets.operation(),user = owner(session);
      if (assets <= 0n) throw new DataError('amount', 'Enter an amount above zero.');
      const position = await ports.view<{ principal: string }>('position', { user }, settings.rheaVaultAccount);
      if (assets > readAmount(position.principal)) throw new DataError('balance', 'That is more than your principal claim.');
      check();return send(session, settings.rheaVaultAccount, 'withdraw', { amount: String(assets) });
    },
  };
}
