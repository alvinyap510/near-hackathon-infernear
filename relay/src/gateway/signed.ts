import { baseDecode } from 'near-api-js';
import { bytesToHex, verifyMessage, type Address, type Hex } from 'viem';
import { HttpError } from '../types.ts';

export type SignedIntent = { standard: 'erc191'; payload: string; signature: string };
export interface SignedOperations {
  // Free view of what the vault will check: the user's principal and next nonce.
  withdrawable(user: string): Promise<{ principal: bigint; nonce: number }>;
  withdraw(message: string, signature: string): Promise<{ tx_hash: string }>;
  executeIntents(signed: SignedIntent[]): Promise<{ tx_hash: string }>;
}
const invalid = () => new HttpError(400, 'invalid_signed_request', 'Invalid or expired EIP-191 signed request');

export class SignedRequests {
  private operations: SignedOperations;
  private vault: string;
  private intents: string;
  private chainId: number;
  private now: () => number;
  constructor(operations: SignedOperations, config: { vault: string; intents: string; chainId: number }, now = Date.now) {
    this.operations = operations; this.vault = config.vault; this.intents = config.intents; this.chainId = config.chainId; this.now = now;
  }
  // `spend` is called once a request is valid, just before the operator pays for its transaction.
  async withdraw(body: unknown, spend: () => void = () => {}): Promise<{ tx_hash: string }> {
    let message: string, signature: Hex, user: string, amount: bigint, nonce: number;
    try {
      const value = body as { message: string; signature: Hex };
      if (typeof value.message !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value.signature)) throw invalid();
      message = value.message; signature = value.signature;
      const request = JSON.parse(message);
      const prefix = `eip155:${this.chainId}:`;
      if (request.action !== 'withdraw' || request.network !== 'mainnet' || request.vault !== this.vault ||
          typeof request.user !== 'string' || !request.user.startsWith(prefix) || !/^0x[0-9a-f]{40}$/.test(request.user.slice(prefix.length)) ||
          typeof request.amount !== 'string' || !/^[0-9]+$/.test(request.amount) || BigInt(request.amount) === 0n ||
          !Number.isSafeInteger(request.nonce) || request.nonce < 0 || !Number.isSafeInteger(request.expires_at) || request.expires_at * 1000 < this.now() ||
          !await verifyMessage({ address: request.user.slice(prefix.length) as Address, message, signature })) throw invalid();
      user = request.user; amount = BigInt(request.amount); nonce = request.nonce;
    } catch { throw invalid(); }
    // A transaction the vault would reject still costs gas. Read its two state checks first, for free.
    const state = await this.operations.withdrawable(user);
    if (nonce !== state.nonce || amount > state.principal) throw new HttpError(409, 'withdrawal_not_possible', 'Nonce is not current or amount exceeds principal');
    spend();
    // Preserve the exact signed bytes. The vault remains the authority on principal, nonce and busy.
    return this.operations.withdraw(message, signature);
  }
  async execute(body: unknown, spend: () => void = () => {}): Promise<{ tx_hash: string }> {
    let signed: SignedIntent[];
    try {
      const value = body as { signed: SignedIntent[] };
      if (!Array.isArray(value.signed) || value.signed.length === 0) throw invalid();
      signed = [];
      for (const intent of value.signed) {
        if (intent.standard !== 'erc191' || typeof intent.payload !== 'string' || typeof intent.signature !== 'string' || !intent.signature.startsWith('secp256k1:')) throw invalid();
        const encoded = intent.signature.slice('secp256k1:'.length);
        // A 65-byte signature needs at most 89 base58 chars. Bound before the quadratic radix conversion.
        if (encoded.length > 89) throw invalid();
        const signature = baseDecode(encoded);
        if (signature.length !== 65 || signature[64] > 1) throw invalid();
        const payload = JSON.parse(intent.payload);
        const deadline = typeof payload.deadline === 'string' ? Date.parse(payload.deadline) : NaN;
        if (payload.verifying_contract !== this.intents || !/^0x[0-9a-fA-F]{40}$/.test(payload.signer_id) ||
            !Number.isFinite(deadline) || deadline < this.now() ||
            !await verifyMessage({ address: payload.signer_id as Address, message: intent.payload, signature: bytesToHex(signature) })) throw invalid();
        signed.push({ standard: 'erc191', payload: intent.payload, signature: intent.signature });
      }
    } catch { throw invalid(); }
    spend();
    // Verifier checks nonce/key authorization and executes the signed intent, never body-supplied transaction fields.
    return this.operations.executeIntents(signed);
  }
}
