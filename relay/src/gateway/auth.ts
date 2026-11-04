import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyMessage, type Hex } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { HttpError } from '../types.ts';

export type KeyPayload = { user: string; epoch: number; exp: number };
const unauthorized = () => new HttpError(401, 'invalid_api_key', 'Bad, expired or revoked credentials');

export class Auth {
  private nonces = new Map<string, number>();
  private secret: string;
  private origin: URL;
  private chainId: number;
  private now: () => number;
  constructor(secret: string, publicUrl: string, chainId: number, now = Date.now) {
    this.secret = secret; this.origin = new URL(publicUrl); this.chainId = chainId; this.now = now;
  }
  nonce(): string {
    for (const [nonce, expiry] of this.nonces) if (expiry <= this.now()) this.nonces.delete(nonce);
    const nonce = randomBytes(24).toString('hex');
    this.nonces.set(nonce, this.now() + 300_000);
    return nonce;
  }
  async walletProof(body: { message?: unknown; signature?: unknown }): Promise<string> {
    try {
      if (typeof body.message !== 'string' || typeof body.signature !== 'string') throw unauthorized();
      const message = parseSiweMessage(body.message);
      const nonce = message.nonce;
      if (!nonce || (this.nonces.get(nonce) ?? 0) <= this.now() || !message.address ||
          !message.expirationTime || message.chainId !== this.chainId ||
          !message.uri || new URL(message.uri).origin !== this.origin.origin ||
          !validateSiweMessage({ message, domain: this.origin.host, nonce, time: new Date(this.now()) })) throw unauthorized();
      if (!await verifyMessage({ address: message.address, message: body.message, signature: body.signature as Hex })) throw unauthorized();
      // Delete after verification, atomically: concurrent proof replays cannot both win.
      if (!this.nonces.delete(nonce)) throw unauthorized();
      return `eip155:${this.chainId}:${message.address.toLowerCase()}`;
    } catch { throw unauthorized(); }
  }
  issue(user: string, epoch: number): { key: string; key_epoch: number; expires_at: number } {
    const exp = Math.floor(this.now() / 1000) + 30 * 24 * 3600;
    const payload = Buffer.from(JSON.stringify({ user, epoch, exp })).toString('base64url');
    return { key: `inf_${payload}.${this.mac(payload).toString('base64url')}`, key_epoch: epoch, expires_at: exp };
  }
  parse(header: string | undefined): KeyPayload {
    try {
      const match = /^Bearer inf_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header ?? '');
      if (!match) throw unauthorized();
      const mac = Buffer.from(match[2], 'base64url');
      const expected = this.mac(match[1]);
      if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw unauthorized();
      const payload: KeyPayload = JSON.parse(Buffer.from(match[1], 'base64url').toString());
      if (typeof payload.user !== 'string' || !Number.isSafeInteger(payload.epoch) || payload.epoch < 0 ||
          !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(this.now() / 1000)) throw unauthorized();
      return payload;
    } catch { throw unauthorized(); }
  }
  private mac(payload: string): Buffer { return createHmac('sha256', this.secret).update(payload).digest(); }
}
