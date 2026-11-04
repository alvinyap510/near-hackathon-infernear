import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { HttpError } from '../types.ts';

export type Model = { id: string; inNano: bigint; outNano: bigint; public: Record<string, unknown> };
const hopHeaders = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'content-length']);
export function endToEndHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const connection = new Set(String(headers.connection ?? '').toLowerCase().split(',').map(s => s.trim()));
  return Object.fromEntries(Object.entries(headers).filter(([key, value]) => value !== undefined && !hopHeaders.has(key) && !connection.has(key) && !key.startsWith('access-control-'))) as Record<string, string | string[]>;
}

export class Upstream {
  private base: string;
  private key: string;
  private cached?: { expires: number; models: Model[] };
  private loading?: Promise<Model[]>;
  private now: () => number;
  private deadlineMs: number;
  constructor(base: string, key: string, now = Date.now, deadlineMs = 120_000) {
    this.base = base.replace(/\/$/, ''); this.key = key; this.now = now; this.deadlineMs = deadlineMs;
  }
  request(path: string, method: string, headers: IncomingHttpHeaders = {}, body?: Buffer): Promise<IncomingMessage> {
    // Construct only relative paths, so neither headers nor a caller-controlled URL can redirect credentials.
    const url = new URL(this.base + path);
    const forward = endToEndHeaders(headers);
    forward.authorization = `Bearer ${this.key}`;
    forward['accept-encoding'] = 'identity';
    if (body) forward['content-length'] = String(body.length);
    return new Promise((resolve, reject) => {
      let response: IncomingMessage | undefined;
      const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers: forward }, incoming => {
        response = incoming;
        incoming.once('end', () => clearTimeout(timer));
        incoming.once('close', () => clearTimeout(timer));
        resolve(incoming);
      });
      // A total deadline, not an inactivity timer: a trickling stream is bounded too.
      const timer = setTimeout(() => {
        const error = new HttpError(504, 'upstream_timeout', 'Upstream response deadline exceeded');
        response?.destroy(error);
        request.destroy(error);
      }, this.deadlineMs);
      request.on('error', error => { clearTimeout(timer); reject(error); });
      request.end(body);
    });
  }
  async models(): Promise<Model[]> {
    if (this.cached && this.cached.expires > this.now()) return this.cached.models;
    if (this.loading) return this.loading;
    this.loading = this.loadModels();
    try { return await this.loading; } finally { this.loading = undefined; }
  }
  private async loadModels(): Promise<Model[]> {
    const response = await this.request('/model/list', 'GET');
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(Buffer.from(chunk));
    if (response.statusCode !== 200) throw new HttpError(502, 'upstream_catalog', 'Model catalog unavailable');
    const catalog = JSON.parse(Buffer.concat(chunks).toString());
    const models: Model[] = [];
    for (const row of catalog.models) {
      const meta = row.metadata;
      if (meta.providerType !== 'vllm' || meta.attestationSupported !== true ||
          !meta.architecture?.inputModalities?.includes('text') || !meta.architecture?.outputModalities?.includes('text') ||
          // Chat models list features (tools, reasoning…); NEAR's privacy filter and reranker list none.
          !Array.isArray(meta.supportedFeatures) || meta.supportedFeatures.length === 0) continue;
      const price = (value: { amount: number; scale: number; currency: string }) => {
        if (value.scale !== 9 || value.currency !== 'USD' || !Number.isSafeInteger(value.amount) || value.amount < 0) throw new Error('Unsupported catalog price');
        return BigInt(value.amount);
      };
      models.push({ id: row.modelId, inNano: price(row.inputCostPerToken), outNano: price(row.outputCostPerToken),
        public: { id: row.modelId, object: 'model', created: 0, owned_by: meta.ownedBy,
          inputCostPerToken: row.inputCostPerToken, outputCostPerToken: row.outputCostPerToken } });
    }
    this.cached = { expires: this.now() + 300_000, models };
    return models;
  }
}
