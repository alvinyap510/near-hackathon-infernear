import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { verifyMessage, type Hex } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { baseDecode } from 'near-api-js';
import { nearFullAccessKey } from '../adapters/near.ts';
import { HttpError } from '../types.ts';
import { ExpiringMap } from './expiring-map.ts';

export type NearKeyLookup = (accountId: string, publicKey: string) => Promise<boolean>;
export const KEY_STATEMENT = 'Authorize one InferNear API key action.';

export type KeyPayload = { user: string; epoch: number; exp: number };
export type LinkTicket = { uid: string; by: string };
const unauthorized = () => new HttpError(401, 'invalid_api_key', 'Bad, expired or revoked credentials');

export class Auth {
  private nonces: ExpiringMap<true>;
  private tickets: ExpiringMap<true>;
  private secret: string;
  private origin: URL;
  private chainId: number;
  private now: () => number;
  private nearKey: NearKeyLookup;
  // `siteUrl` is the origin whose page asks the wallet to sign: the dashboard, not the API host.
  constructor(secret: string, siteUrl: string, chainId: number, now = Date.now, nearKey: NearKeyLookup = nearFullAccessKey) {
    this.nearKey = nearKey;
    this.secret = secret; this.origin = new URL(siteUrl); this.chainId = chainId; this.now = now;
    this.nonces = new ExpiringMap(300_000, now);
    this.tickets = new ExpiringMap(600_000, now);
  }
  nonce(): string {
    const nonce = randomBytes(24).toString('hex');
    this.nonces.set(nonce, true);
    return nonce;
  }
  // `statement` is what the signature authorises. A proof signed for one action is refused for
  // every other, so a sign-in signature can never be replayed to issue a key or link a wallet.
  async walletProof(value: unknown, statement: string = KEY_STATEMENT): Promise<string> {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw unauthorized();
      const body = value as { near?: unknown; message?: unknown; signature?: unknown };
      if ('near' in body) {
        if (body.message !== undefined || body.signature !== undefined) throw unauthorized();
        return await this.nearProof(body.near, statement);
      }
      if (typeof body.message !== 'string' || typeof body.signature !== 'string') throw unauthorized();
      const message = parseSiweMessage(body.message);
      const nonce = message.nonce;
      if (!nonce || !this.nonces.get(nonce) || !message.address || message.statement !== statement ||
          !message.expirationTime || message.chainId !== this.chainId ||
          !message.uri || new URL(message.uri).origin !== this.origin.origin ||
          !validateSiweMessage({ message, domain: this.origin.host, nonce, time: new Date(this.now()) })) throw unauthorized();
      if (!await verifyMessage({ address: message.address, message: body.message, signature: body.signature as Hex })) throw unauthorized();
      // Delete after verification, atomically: concurrent proof replays cannot both win.
      if (!this.nonces.delete(nonce)) throw unauthorized();
      return `eip155:${this.chainId}:${message.address.toLowerCase()}`;
    } catch { throw unauthorized(); }
  }
  private async nearProof(value: unknown, statement: string): Promise<string> {
    if (!value || typeof value !== 'object') throw unauthorized();
    const { account_id, public_key, signature, message, nonce, recipient, callback_url } = value as Record<string, unknown>;
    if (typeof account_id !== 'string' || account_id.length < 2 || account_id.length > 64 ||
        !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(account_id) || typeof public_key !== 'string' ||
        !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(public_key) || typeof signature !== 'string' || typeof message !== 'string' ||
        typeof nonce !== 'string' || recipient !== this.origin.host) throw unauthorized();
    // NEP-413 signs an optional callback URL. Redirect wallets (MyNearWallet) put the page URL there,
    // extension wallets sign none. When the proof carries one it must be a dashboard URL.
    if (callback_url !== undefined && (typeof callback_url !== 'string' || callback_url.length > 2048 || new URL(callback_url).origin !== this.origin.origin)) throw unauthorized();
    const parsed = JSON.parse(message), time = Math.floor(this.now() / 1000);
    if (parsed.statement !== statement || parsed.account_id !== account_id || typeof parsed.nonce !== 'string' ||
        !Number.isSafeInteger(parsed.expires_at) || parsed.expires_at <= time || parsed.expires_at > time + 300 ||
        JSON.stringify({ statement, account_id, nonce: parsed.nonce, expires_at: parsed.expires_at }) !== message ||
        !this.nonces.get(parsed.nonce)) throw unauthorized();
    const decode = (text: string, length: number) => {
      if (text.length !== Math.ceil(length / 3) * 4) throw unauthorized();
      const bytes = Buffer.from(text, 'base64');
      if (bytes.length !== length || bytes.toString('base64') !== text) throw unauthorized();
      return bytes;
    };
    const nonceBytes = decode(nonce, 32);
    if (!nonceBytes.equals(createHash('sha256').update(parsed.nonce, 'utf8').digest())) throw unauthorized();
    // The fixed base58 length above avoids quadratic decoding of an untrusted body.
    const signatureBytes = decode(signature, 64), key = baseDecode(public_key.slice(8));
    if (key.length !== 32) throw unauthorized();
    const string = (text: string) => { const bytes = Buffer.from(text, 'utf8'), size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); return Buffer.concat([size, bytes]); };
    const tag = Buffer.alloc(4); tag.writeUInt32LE(2147484061);
    const digest = createHash('sha256').update(Buffer.concat([tag, string(message), nonceBytes, string(recipient),
      ...(typeof callback_url === 'string' ? [Buffer.from([1]), string(callback_url)] : [Buffer.from([0])])])).digest();
    const ed25519 = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key]), format: 'der', type: 'spki' });
    if (!verify(null, digest, ed25519, signatureBytes) || !await this.nearKey(account_id, public_key)) throw unauthorized();
    if (parsed.expires_at <= Math.floor(this.now() / 1000) || !this.nonces.get(parsed.nonce) || !this.nonces.delete(parsed.nonce)) throw unauthorized();
    return `near:mainnet:${account_id}`;
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
  // A link ticket carries the consent of a wallet already in the account. It is valid for ten
  // minutes and for one use; the wallet being added must still sign its own proof.
  ticket(uid: string, by: string): { ticket: string; expires_at: number } {
    const exp = Math.floor(this.now() / 1000) + 600, jti = randomBytes(16).toString('hex');
    const payload = Buffer.from(JSON.stringify({ uid, by, exp, jti })).toString('base64url');
    this.tickets.set(jti, true);
    return { ticket: `ilt_${payload}.${this.mac('ticket:' + payload).toString('base64url')}`, expires_at: exp };
  }
  // `redeem` is called once the joining wallet's proof has verified, and consumes the ticket.
  readTicket(value: unknown): LinkTicket & { redeem(): void } {
    const invalid = () => new HttpError(401, 'invalid_ticket', 'Bad, expired or used link ticket');
    try {
      const match = /^ilt_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(typeof value === 'string' ? value : '');
      if (!match) throw invalid();
      const mac = Buffer.from(match[2], 'base64url'), expected = this.mac('ticket:' + match[1]);
      if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw invalid();
      const { uid, by, exp, jti } = JSON.parse(Buffer.from(match[1], 'base64url').toString());
      if (exp <= Math.floor(this.now() / 1000) || !this.tickets.get(jti)) throw invalid();
      return { uid, by, redeem: () => { if (exp <= Math.floor(this.now() / 1000) || !this.tickets.delete(jti)) throw invalid(); } };
    } catch { throw invalid(); }
  }
  private mac(payload: string): Buffer { return createHmac('sha256', this.secret).update(payload).digest(); }
}
