import { getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';

export function walletProofMessage(address: `0x${string}`, nonce: string, relayUrl: string, chainId: number, now = new Date()): string {
  const relay = new URL(relayUrl);
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
