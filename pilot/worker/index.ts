import type { D1Database } from './d1-types.js';
import { D1MessageRepository } from './repository.js';
import { PilotService } from './service.js';
import { SyncBurstService } from './sync.js';

export interface Env {
  readonly DB: D1Database;
  readonly ZUNGUN_PILOT_TOKEN: string;
}

const PUBLIC_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'application/json; charset=utf-8',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function publicResponse(body: unknown, status = 200, allow?: string): Response {
  const headers = new Headers(PUBLIC_HEADERS);
  if (allow !== undefined) headers.set('allow', allow);
  return new Response(JSON.stringify(body), { status, headers });
}

export function createPilotService(env: Env): PilotService {
  return new PilotService(new D1MessageRepository(env.DB), env.ZUNGUN_PILOT_TOKEN);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      if (url.search !== '') return Promise.resolve(publicResponse({ ok: false, error: { code: 'NOT_FOUND', retryable: false } }, 404));
      if (request.method !== 'GET') return Promise.resolve(publicResponse({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', retryable: false } }, 405, 'GET'));
      return Promise.resolve(publicResponse({ ok: true, service: 'zungun', version: '0.1', status: 'canary' }));
    }
    if (url.pathname === '/v0/sync' && url.search === '') {
      if (request.method !== 'POST') return Promise.resolve(publicResponse({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', retryable: false } }, 405, 'POST'));
      return new SyncBurstService(new D1MessageRepository(env.DB), env.ZUNGUN_PILOT_TOKEN).handle(request);
    }
    return createPilotService(env).handle(request);
  },
};
