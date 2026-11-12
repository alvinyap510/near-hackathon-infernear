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
