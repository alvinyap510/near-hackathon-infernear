import { base58 } from '@scure/base';
import { hexToBytes, type Hex } from 'viem';
import type { LiveConfig } from '../config.ts';
import { DataError, readAmount } from './errors.ts';
import type { Address, RheaDirection, RheaQuote, RheaTransfer, RheaSwapStatus, TxResult } from './types.ts';

export type NearView = <T>(method: string, args: Record<string, unknown>, contract?: string) => Promise<T>;
export function withdrawalMessage(vault: string, user: string, amount: bigint, nonce: number, expiresAt: number): string {
  return JSON.stringify({ action: 'withdraw', network: 'mainnet', vault, user, amount: String(amount), nonce, expires_at: expiresAt });
}
/** Native verifier encoding: preserve the signed JSON; normalize wallet v=27/28 to 0/1. */
export function intentSignature(signature: Hex): string {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) throw new DataError('wallet_signature', 'Expected a 65-byte wallet signature.');
  if (bytes[64] === 27 || bytes[64] === 28) bytes[64] -= 27;
  if (bytes[64] > 1) throw new DataError('wallet_signature', 'Unsupported wallet recovery id.');
  return `secp256k1:${base58.encode(bytes)}`;
}

type Ports = {
  fetch: typeof fetch;
  now: () => Date;
  nearView: NearView;
  ready(address: Address): Promise<void>;
  sign(address: Address, message: string): Promise<Hex>;
  transfer(address: Address, to: Address, assets: bigint): Promise<TxResult>;
  relay<T>(path: string, body?: unknown): Promise<T>;
};

export function createRheaData(settings: LiveConfig, ports: Ports) {
  const user = (address: Address) => `eip155:${settings.vaultChainId}:${address.toLowerCase()}`;
  const nearAsset = `nep141:${settings.nearUsdcAccount}`;
  const positive = (assets: bigint) => { if (assets <= 0n) throw new DataError('amount', 'Enter an amount above zero.'); };
  const quote = async (address: Address, assets: bigint, direction: RheaDirection, dry: boolean): Promise<RheaQuote> => {
    positive(assets);
    const owner = address.toLowerCase();
    const request = {
      dry, swapType: 'EXACT_INPUT', slippageTolerance: settings.slippageBps,
      originAsset: direction === 'deposit' ? settings.baseUsdcAssetId : nearAsset,
      destinationAsset: direction === 'deposit' ? nearAsset : settings.baseUsdcAssetId,
      depositType: direction === 'deposit' ? 'ORIGIN_CHAIN' : 'INTENTS',
      recipientType: 'DESTINATION_CHAIN', refundType: direction === 'deposit' ? 'ORIGIN_CHAIN' : 'INTENTS',
      amount: String(assets), refundTo: owner, recipient: direction === 'deposit' ? settings.rheaVaultAccount : owner,
      ...(direction === 'deposit' ? { customRecipientMsg: JSON.stringify({ user: user(address) }) } : {}),
      deadline: new Date(ports.now().getTime() + 600_000).toISOString(),
    };
    const response = await ports.fetch(settings.oneClickUrl.replace(/\/$/, '') + '/v0/quote', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    });
    const body = await response.json();
    if (!response.ok) throw new DataError('oneclick', body.message ?? '1Click quote failed.');
    // Binding the quote to the requested route prevents funding a mismatched recipient/token/amount.
    for (const key of ['dry', 'originAsset', 'destinationAsset', 'depositType', 'recipientType', 'refundType', 'amount', 'refundTo', 'recipient', 'customRecipientMsg'] as const)
      if (body.quoteRequest?.[key] !== request[key]) throw new DataError('quote', '1Click returned a different route.');
    const q = body.quote;
    const deadline = q?.deadline ?? body.quoteRequest.deadline;
    if (typeof deadline !== 'string' || !(Date.parse(deadline) > ports.now().getTime())) throw new DataError('quote', '1Click quote has expired.');
    const amountIn = readAmount(q?.amountIn, 'quote');
    if (amountIn !== assets) throw new DataError('quote', '1Click returned a different input amount.');
    const depositAddress = dry ? undefined : q?.depositAddress;
    if (!dry && (typeof depositAddress !== 'string' || !depositAddress)) throw new DataError('quote', '1Click returned no funding address.');
    return { direction, dry, isMock: false, amountIn, amountOut: readAmount(q?.amountOut, 'quote'),
      minAmountOut: readAmount(q?.minAmountOut, 'quote'), etaSeconds: q.timeEstimate, deadline, depositAddress };
  };
  return {
    rheaQuote: (address: Address, assets: bigint, direction: RheaDirection) => quote(address, assets, direction, true),
    async rheaDeposit(address: Address, assets: bigint): Promise<RheaTransfer> {
      positive(assets); await ports.ready(address);
      const funded = await quote(address, assets, 'deposit', false);
      if (!/^0x[0-9a-fA-F]{40}$/.test(funded.depositAddress!)) throw new DataError('quote', 'Expected a Base deposit address.');
      const result = await ports.transfer(address, funded.depositAddress as Address, funded.amountIn);
      return { ...result, quote: funded };
    },
    async rheaWithdraw(address: Address, claim: bigint): Promise<TxResult> {
      positive(claim); await ports.ready(address);
      const nonce = await ports.nearView<number>('nonce', { user: user(address) }, settings.rheaVaultAccount);
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new DataError('near_rpc', 'NEAR returned an invalid nonce.');
      const message = withdrawalMessage(settings.rheaVaultAccount, user(address), claim, nonce, Math.floor(ports.now().getTime() / 1000) + 300);
      const signature = await ports.sign(address, message);
      const result = await ports.relay<{ tx_hash: string }>('/rhea/withdraw', { message, signature });
      return { txHash: result.tx_hash };
    },
    async rheaExit(address: Address, assets: bigint): Promise<RheaTransfer> {
      positive(assets); await ports.ready(address);
      const funded = await quote(address, assets, 'withdraw', false);
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const payload = JSON.stringify({ signer_id: address.toLowerCase(), verifying_contract: settings.intentsAccount,
        deadline: funded.deadline, nonce: btoa(String.fromCharCode(...nonce)),
        intents: [{ intent: 'transfer', receiver_id: funded.depositAddress, tokens: { [nearAsset]: String(funded.amountIn) } }],
      });
      const signature = intentSignature(await ports.sign(address, payload));
      const result = await ports.relay<{ tx_hash: string }>('/intents/execute', { signed: [{ standard: 'erc191', payload, signature }] });
      return { txHash: result.tx_hash, quote: funded };
    },
    async rheaStatus(depositAddress: string): Promise<RheaSwapStatus> {
      const response = await ports.fetch(settings.oneClickUrl.replace(/\/$/, '') + '/v0/status?depositAddress=' + encodeURIComponent(depositAddress));
      const body = await response.json();
      if (!response.ok) throw new DataError('oneclick', body.message ?? '1Click status failed.');
      if (typeof body.status !== 'string') throw new DataError('oneclick', '1Click returned no swap status.');
      return { status: body.status, terminal: ['SUCCESS', 'FAILED', 'REFUNDED'].includes(body.status), isMock: false };
    },
  };
}
