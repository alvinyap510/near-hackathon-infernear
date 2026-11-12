import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HttpError, reportError, type Report } from '../types.ts';
import { ExpiringMap } from './expiring-map.ts';
import { Gateway } from './ledger.ts';
import type { SignedRequests } from './signed.ts';
import { Meter } from './meter.ts';
import { endToEndHeaders } from './upstream.ts';

// Bound untrusted buffered envelopes in the process that also settles credits.
export const MAX_BODY_BYTES = 1_048_576;

export function createRelayServer(gateway: Gateway, options: { publicUrl: string; report: Report; now?: () => number; allowedOrigin?: string; signedRequests?: SignedRequests; clientIpHeader?: string }) {
  const now = options.now ?? Date.now;
  const ipLimits = new ExpiringMap<{ count: number }>(60_000, now);
  const origin = new URL(options.publicUrl).origin;
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  };
  const body = async (req: IncomingMessage) => {
    const tooLarge = () => new HttpError(413, 'body_too_large', 'Request body exceeds 1 MiB');
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) { req.pause(); throw tooLarge(); }
    const chunks: Buffer[] = [];
    let bytes = 0;
    // Leaving this iterator must not destroy the socket before the 413 is sent.
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { req.pause(); throw tooLarge(); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  };
  const limitIp = (req: IncomingMessage) => {
    // Behind a tunnel every socket is the proxy's; only a configured header names the client.
    const forwarded = options.clientIpHeader ? req.headers[options.clientIpHeader.toLowerCase()] : undefined;
    const ip = typeof forwarded === 'string' && forwarded ? forwarded : req.socket.remoteAddress ?? '';
    let window = ipLimits.get(ip);
    if (!window) { window = { count: 0 }; ipLimits.set(ip, window); }
    if (window.count >= 30) throw new HttpError(429, 'read_rate_limit', 'Limit: 30 requests per minute per IP');
    window.count += 1;
  };
  const pipe = async (source: IncomingMessage, res: ServerResponse, onBytes: (chunk: Buffer) => void) => {
    for await (const bytes of source) {
      const chunk = Buffer.from(bytes); onBytes(chunk);
      if (!res.destroyed && !res.writableEnded && !res.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            res.off('drain', done); res.off('close', done);
            source.off('error', failed); source.off('close', closed);
          };
          const done = () => { cleanup(); resolve(); };
          const failed = (error: Error) => { cleanup(); reject(error); };
          const closed = () => { if (source.readableEnded) done(); else failed(new HttpError(502, 'upstream_closed', 'Upstream response closed')); };
          res.once('drain', done); res.once('close', done);
          source.once('error', failed); source.once('close', closed);
        });
      }
    }
  };
  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', options.allowedOrigin ?? origin);
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'Authorization, Content-Type, X-Signing-Algo, X-Client-Pub-Key, X-Model-Pub-Key, X-Encryption-Version, X-Encrypt-All-Fields, x-no-aliasing');
    res.setHeader('access-control-expose-headers', 'Inference-Id');
    try {
      const url = new URL(req.url ?? '/', origin);
      const path = url.pathname;
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && path === '/auth/nonce') { json(res, 200, { nonce: gateway.auth.nonce() }); return; }
      if (req.method === 'POST' && (path === '/keys' || path === '/keys/revoke')) {
        let proof;
        const raw = await body(req);
        try { proof = JSON.parse(raw.toString()); } catch { throw new HttpError(400, 'invalid_json', 'Expected wallet proof JSON'); }
        const user = await gateway.auth.walletProof(proof);
        json(res, 200, path === '/keys' ? await gateway.issue(user) : await gateway.revoke(user)); return;
      }
      if (req.method === 'GET' && path === '/v1/models') {
        json(res, 200, { object: 'list', data: (await gateway.upstream.models()).map(model => model.public) }); return;
      }
      if (req.method === 'GET' && (path.startsWith('/v1/model/') || path === '/v1/attestation/report' || path.startsWith('/v1/signature/'))) {
        if (req.headers.authorization) await gateway.authenticate(req.headers.authorization);
        else limitIp(req);
        const upstream = await gateway.upstream.request(path.slice(3) + url.search, 'GET', req.headers);
        res.writeHead(upstream.statusCode ?? 502, endToEndHeaders(upstream.headers));
        await pipe(upstream, res, () => {}); res.end(); return;
      }
      if (req.method === 'POST' && (path === '/rhea/withdraw' || path === '/intents/execute')) {
        // These gas-paying routes always use the shared socket-IP bucket, even with an API key.
        limitIp(req);
        const raw = await body(req);
        let value: unknown;
        try { value = JSON.parse(raw.toString()); } catch { throw new HttpError(400, 'invalid_json', 'Expected signed request JSON'); }
        if (!options.signedRequests) throw new HttpError(503, 'service_unavailable', 'Signed routes unavailable');
        json(res, 200, path === '/rhea/withdraw' ? await options.signedRequests.withdraw(value) : await options.signedRequests.execute(value)); return;
      }
      if (req.method === 'POST' && path === '/v1/chat/completions') {
        gateway.auth.parse(req.headers.authorization);
        const raw = await body(req);
        const reservation = await gateway.admit(raw, req.headers);
        const meter = new Meter(reservation.streaming);
        let status = 0;
        let id: string | undefined;
        try {
          const upstream = await gateway.upstream.request('/chat/completions' + url.search, 'POST', req.headers, raw);
          status = upstream.statusCode ?? 502;
          id = typeof upstream.headers['inference-id'] === 'string' ? upstream.headers['inference-id'] : undefined;
          res.writeHead(status, endToEndHeaders(upstream.headers));
          await pipe(upstream, res, bytes => meter.push(bytes));
        } finally {
          try { meter.finish(); }
          catch (error) { meter.usage = undefined; reportError(options.report, 'meter_error', error); }
          finally { await gateway.complete(reservation, status, id, meter); }
        }
        res.end(); return;
      }
      throw new HttpError(404, 'not_found', 'Route not found');
    } catch (error) {
      reportError(options.report, 'request_error', error);
      if (res.headersSent) { res.destroy(); return; }
      const failure = error instanceof HttpError ? error : new HttpError(503, 'service_unavailable', 'Relay dependency unavailable');
      if (!req.complete) { res.shouldKeepAlive = false; res.setHeader('connection', 'close'); }
      json(res, failure.status, { error: { message: failure.message, type: 'invalid_request_error', code: failure.code } });
    }
  });
}
