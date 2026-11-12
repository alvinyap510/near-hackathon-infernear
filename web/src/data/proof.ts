import { getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';

// ERC-4361: domain and URI name the site the wallet is signing on. Wallets warn when they differ from the page.
export function walletProofMessage(address: `0x${string}`, nonce: string, siteUrl: string, chainId: number, now = new Date()): string {
  const relay = new URL(siteUrl);
  return createSiweMessage({
    address: getAddress(address),
    domain: relay.host,
    uri: relay.origin,
    version: '1',
    chainId,
    nonce,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 5 * 60_000),
    statement: 'Authorize one InferNear API key action.',
  });
}

export const KEY_STATEMENT = 'Authorize one InferNear API key action.';
export function nearProofMessage(nonce: string, accountId: string, now = new Date()): string {
  return JSON.stringify({ statement: KEY_STATEMENT, account_id: accountId, nonce, expires_at: Math.floor(now.getTime() / 1000) + 300 });
}
export async function nearProofNonce(nonce: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce)));
}
