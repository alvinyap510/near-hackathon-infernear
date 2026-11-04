import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Auth, type KeyPayload } from './auth.ts';
import { inferenceId, Meter } from './meter.ts';
import { Upstream, endToEndHeaders, type Model } from './upstream.ts';
import { HttpError, InsufficientCredit, Mutex, costMicro, min, reportError, type Account, type Connector, type Receipt, type Report } from '../types.ts';

type User = { lock: Mutex; floor?: bigint; epoch: number; pendingEpoch?: number; active: number; reservations: Map<string, bigint> };
export type Reservation = { token: string; user: string; amount: bigint; model: Model; inputBound: number; maxTokens: number; streaming: boolean };
type Job = { reservation: Reservation; amount: bigint; receipt: Receipt; stage: 'metered' | 'broadcast'; running: boolean };

export class Gateway {
  readonly auth: Auth;
  readonly upstream: Upstream;
  private connector: Connector;
  private report: Report;
  private cap: number;
  private users = new Map<string, User>();
  private jobs = new Map<string, Job>();
  private broadcasted = new Set<string>();
  constructor(options: { auth: Auth; upstream: Upstream; connector: Connector; maxTokens: number; report: Report }) {
    this.auth = options.auth; this.upstream = options.upstream; this.connector = options.connector;
    this.cap = options.maxTokens; this.report = options.report;
  }
  private user(id: string): User {
    if (!this.users.has(id)) this.users.set(id, { lock: new Mutex(), epoch: 0, active: 0, reservations: new Map() });
    return this.users.get(id)!;
  }
  private observe(state: User, account: Account): void {
    state.epoch = Math.max(state.epoch, account.key_epoch);
    // A late pre-restart debit may first appear after lazy initialization.
    // Once observed, a later stale read must never reopen that spent credit.
    state.floor = state.floor === undefined || account.spent > state.floor ? account.spent : state.floor;
  }
  private checkEpoch(key: KeyPayload, state: User): void {
    if (key.epoch !== state.epoch) throw new HttpError(401, 'revoked_api_key', 'API key revoked');
  }
  async authenticate(header: string | undefined): Promise<KeyPayload> {
    const key = this.auth.parse(header);
    const state = this.user(key.user);
    this.observe(state, await this.connector.account(key.user));
    this.checkEpoch(key, state);
    return key;
  }
  async issue(user: string) {
    const state = this.user(user);
    return state.lock.run(async () => {
      const account = await this.connector.account(user);
      this.observe(state, account);
      if (state.pendingEpoch !== undefined) {
        if (account.key_epoch < state.pendingEpoch) throw new HttpError(503, 'revocation_pending', 'Revocation is not confirmed; retry later');
        state.pendingEpoch = undefined;
      }
      return this.auth.issue(user, state.epoch);
    });
  }
  async revoke(user: string) {
    const state = this.user(user);
    return state.lock.run(async () => {
      this.observe(state, await this.connector.account(user));
      // Advance before awaiting the transaction, so a lagging read cannot revive old keys.
      state.pendingEpoch ??= state.epoch + 1;
      state.epoch = Math.max(state.epoch, state.pendingEpoch);
      const result = await this.connector.bumpKeyEpoch(user);
      if (result.key_epoch < state.epoch) throw new HttpError(503, 'revocation_pending', 'Revocation is not confirmed; retry later');
      state.epoch = Math.max(state.epoch, result.key_epoch);
      state.pendingEpoch = undefined;
      return { key_epoch: state.epoch, tx_hash: result.tx_hash };
    });
  }
  async admit(raw: Buffer, headers: IncomingHttpHeaders): Promise<Reservation> {
    const key = this.auth.parse(headers.authorization);
    let body;
    try { body = JSON.parse(raw.toString()); } catch { throw new HttpError(400, 'invalid_json', 'Expected JSON chat request'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_request', 'Expected chat object');
    const invalid = (message: string): never => { throw new HttpError(400, 'unsupported_parameters', message); };
    const forwarded = endToEndHeaders(headers);
    if (forwarded['x-encryption-version'] !== '3' || !forwarded['x-signing-algo'] ||
        !forwarded['x-client-pub-key'] || !forwarded['x-model-pub-key'] ||
        forwarded['x-encrypt-all-fields'] !== 'true' || forwarded['x-no-aliasing'] !== 'true')
      invalid('E2EE v3 headers required. See relay/README.md and the NEAR AI SDK application-proxy quickstart.');
    if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > this.cap ||
        'max_completion_tokens' in body || (body.n !== undefined && body.n !== 1) ||
        (body.stream !== undefined && typeof body.stream !== 'boolean') ||
        (body.stream === true && body.stream_options?.include_usage !== true)) invalid('Unsupported token limit, n, or streaming parameters');
    if (!Array.isArray(body.messages) || !body.messages.length || body.audio ||
        (body.modalities && (body.modalities.length !== 1 || body.modalities[0] !== 'text')) ||
        body.messages.some((m: any) => !m || (m.content !== null && m.content !== undefined &&
          typeof m.content !== 'string' && (!Array.isArray(m.content) || m.content.some((p: any) => p?.type !== 'text')))))
      invalid('Only text chat and encrypted tool definitions/calls are served');
    const model = (await this.upstream.models()).find(m => m.id === body.model);
    if (!model) throw new HttpError(404, 'model_not_found', 'Model is not a canonical attested TEE text model');
    const inputBound = Math.ceil(raw.length / 2);
    const amount = costMicro(inputBound, body.max_tokens, model.inNano, model.outNano);
    const state = this.user(key.user);
    return state.lock.run(async () => {
      const account = await this.connector.account(key.user);
      this.observe(state, account); this.checkEpoch(key, state);
      if (state.active >= 4) throw new HttpError(429, 'concurrency_limit', 'At most four requests in flight per user');
      const committed = account.spent > state.floor! ? account.spent : state.floor!;
      const reserved = [...state.reservations.values()].reduce((a, b) => a + b, 0n);
      if (amount > account.credited - committed - reserved) throw new HttpError(402, 'insufficient_credit', 'Insufficient available credits');
      const token = randomUUID();
      state.reservations.set(token, amount); state.active += 1;
      return { token, user: key.user, amount, model, inputBound, maxTokens: body.max_tokens, streaming: body.stream === true };
    });
  }
  async complete(reservation: Reservation, status: number, headerId: string | undefined, meter: Meter): Promise<void> {
    const state = this.user(reservation.user);
    await state.lock.run(async () => {
      state.active -= 1;
      const id = status >= 200 && status < 300 ? headerId || (meter.chatId ? inferenceId(meter.chatId) : '') : '';
      if (!id) {
        state.reservations.delete(reservation.token);
        this.report('inference_loss', { user: reservation.user, reason: 'no_completion' });
        return;
      }
      if (this.jobs.has(id) || this.broadcasted.has(id)) {
        state.reservations.delete(reservation.token);
        return;
      }
      const usage = meter.usage;
      const amount = usage ? min(costMicro(usage.prompt_tokens, usage.completion_tokens, reservation.model.inNano, reservation.model.outNano), reservation.amount) : reservation.amount;
      const receipt: Receipt = { inference_id: id, chat_id: meter.chatId, model: reservation.model.id,
        prompt_tokens: usage?.prompt_tokens ?? reservation.inputBound, completion_tokens: usage?.completion_tokens ?? reservation.maxTokens,
        in_price_nano: String(reservation.model.inNano), out_price_nano: String(reservation.model.outNano), source: usage ? 'signed_usage' : 'reservation' };
      this.jobs.set(id, { reservation, amount, receipt, stage: 'metered', running: false });
    });
    // Confirmation is independent of delivery; raw responses do not wait on NEAR.
    void this.retryDebits();
  }
  async retryDebits(): Promise<void> {
    await Promise.all([...this.jobs.values()].map(job => this.retry(job)));
  }
  private async retry(job: Job): Promise<void> {
    if (job.running) return;
    job.running = true;
    const { receipt, reservation, amount } = job;
    const id = receipt.inference_id;
    try {
      const already = await this.connector.debitedAmount(id);
      if (already !== null) {
        await this.user(reservation.user).lock.run(async () => {
          this.user(reservation.user).reservations.delete(reservation.token);
          this.jobs.delete(id);
        });
        this.report('debit_confirmed', { inference_id: id, amount_micro: String(already) });
        return;
      }
      await this.user(reservation.user).lock.run(async () => {
        const state = this.user(reservation.user);
        if (!this.broadcasted.has(id)) {
          state.floor! += amount;
          this.broadcasted.add(id);
        }
        state.reservations.delete(reservation.token);
        job.stage = 'broadcast';
      });
      await this.connector.debit(reservation.user, amount, receipt);
      // Keep the job until a finalized view confirms the id, even if the call returned success.
    } catch (error) {
      if (error instanceof InsufficientCredit) {
        this.jobs.delete(id);
        this.report('inference_loss', { inference_id: id, reason: 'insufficient_credit' });
      } else reportError(this.report, 'debit_retry', error, { inference_id: id, stage: job.stage });
    } finally { job.running = false; }
  }
  // Metadata only, for health/testing; no prompts or request bodies are retained.
  state(user: string) {
    const state = this.user(user);
    return { spent_floor: state.floor ?? 0n, key_epoch: state.epoch, active: state.active,
      reserved: [...state.reservations.values()].reduce((a, b) => a + b, 0n), pending: this.jobs.size };
  }
}
