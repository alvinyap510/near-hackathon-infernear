import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { HttpError, type Report } from '../types.ts';
import { Gateway } from './ledger.ts';
import { Meter } from './meter.ts';
import { endToEndHeaders } from './upstream.ts';

export function createRelayServer(gateway: Gateway, options: { publicUrl: string; report: Report; now?: () => number; allowedOrigin?: string }) {
  const now = options.now ?? Date.now;
  const ipLimits = new Map<string, { count: number; expires: number }>();
  const origin = new URL(options.publicUrl).origin;
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
  };
  const body = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  const pipe = async (source: IncomingMessage, res: ServerResponse, onBytes: (chunk: Buffer) => void) => {
    for await (const bytes of source) {
      const chunk = Buffer.from(bytes); onBytes(chunk);
      if (!res.destroyed && !res.writableEnded && !res.write(chunk)) {
        await new Promise<void>(resolve => {
          const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
          res.once('drain', done); res.once('close', done);
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
        try { proof = JSON.parse((await body(req)).toString()); } catch { throw new HttpError(400, 'invalid_json', 'Expected wallet proof JSON'); }
        const user = await gateway.auth.walletProof(proof);
        json(res, 200, path === '/keys' ? await gateway.issue(user) : await gateway.revoke(user)); return;
      }
      if (req.method === 'GET' && path === '/v1/models') {
        json(res, 200, { object: 'list', data: (await gateway.upstream.models()).map(model => model.public) }); return;
      }
      if (req.method === 'GET' && (path.startsWith('/v1/model/') || path === '/v1/attestation/report' || path.startsWith('/v1/signature/'))) {
        if (req.headers.authorization) await gateway.authenticate(req.headers.authorization);
        else {
          const ip = req.socket.remoteAddress ?? '';
          for (const [address, window] of ipLimits) if (window.expires <= now()) ipLimits.delete(address);
          const window = ipLimits.get(ip) ?? { count: 0, expires: now() + 60_000 };
          if (window.count >= 30) throw new HttpError(429, 'read_rate_limit', 'Anonymous read limit: 30 requests per minute per IP');
          window.count += 1; ipLimits.set(ip, window);
        }
        const upstream = await gateway.upstream.request(path.slice(3) + url.search, 'GET', req.headers);
        res.writeHead(upstream.statusCode ?? 502, endToEndHeaders(upstream.headers));
        await pipe(upstream, res, () => {}); res.end(); return;
      }
      if (req.method === 'POST' && path === '/v1/chat/completions') {
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
          meter.finish();
          await gateway.complete(reservation, status, id, meter);
        }
        res.end(); return;
      }
      throw new HttpError(404, 'not_found', 'Route not found');
    } catch (error) {
      options.report('request_error', { error: String(error) });
      if (res.headersSent) { res.destroy(); return; }
      const failure = error instanceof HttpError ? error : new HttpError(503, 'service_unavailable', 'Relay dependency unavailable');
      json(res, failure.status, { error: { message: failure.message, type: 'invalid_request_error', code: failure.code } });
    }
  });
}
