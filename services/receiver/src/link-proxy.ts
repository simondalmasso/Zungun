import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { receiverProxyCapabilities, type ReceiverCapabilitiesV1 } from '../../../packages/link-core/src/capabilities.js';

export interface LinkProxyRoute {
  readonly routeId: string;
  readonly targetOrigin: string;
  readonly pathPrefix: string;
  readonly allowedMethods: readonly ('POST' | 'PUT' | 'PATCH')[];
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly timeoutMs: number;
  readonly allowedRequestHeaders: readonly string[];
}

export interface LinkProxyRequest {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly routeId: string;
  readonly method: 'POST' | 'PUT' | 'PATCH';
  readonly relativePath: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly createdAtMs: number;
}

export interface LinkProxyInvocation {
  readonly url: string;
  readonly method: 'POST' | 'PUT' | 'PATCH';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly timeoutMs: number;
}

export interface LinkProxyInvocationResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface LinkProxyInvoker {
  invoke(input: LinkProxyInvocation): Promise<LinkProxyInvocationResult>;
  query?(route: LinkProxyRoute, idempotencyKey: string): Promise<'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN'>;
}

export interface LinkProxyRecord {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly routeId: string;
  readonly requestSha256: string;
  readonly state: 'PERSISTED' | 'UPSTREAM_ACCEPTED' | 'UPSTREAM_REJECTED' | 'UNKNOWN';
  readonly upstreamStatus: number | null;
  readonly responseSha256: string | null;
  readonly responseBody: string | null;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface LinkProxyStore {
  get(operationId: string): LinkProxyRecord | null;
  getByIdempotencyKey(idempotencyKey: string): LinkProxyRecord | null;
  insert(record: LinkProxyRecord): boolean;
  update(record: LinkProxyRecord): void;
}

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function validToken(value: string): boolean { return /^[A-Za-z0-9._:-]{1,200}$/.test(value); }
function validRelativePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0')) return false;
  try {
    let decoded = path;
    for (let i = 0; i < 2; i += 1) decoded = decodeURIComponent(decoded);
    return !decoded.split('/').includes('..') && !decoded.includes('://') && !decoded.includes('\\') && !decoded.includes('\0');
  } catch { return false; }
}

function validPathPrefix(path: string): boolean {
  return path === '' || (validRelativePath(path) && !path.endsWith('/..'));
}

function validatedRoute(route: LinkProxyRoute): URL {
  if (!validToken(route.routeId)) throw new Error('LINK_PROXY_ROUTE_ID_INVALID');
  if (!Number.isSafeInteger(route.maxRequestBytes) || route.maxRequestBytes < 1 || route.maxRequestBytes > 10_000_000) throw new Error('LINK_PROXY_REQUEST_LIMIT_INVALID');
  if (!Number.isSafeInteger(route.maxResponseBytes) || route.maxResponseBytes < 1 || route.maxResponseBytes > 1_000_000) throw new Error('LINK_PROXY_RESPONSE_LIMIT_INVALID');
  if (!Number.isSafeInteger(route.timeoutMs) || route.timeoutMs < 100 || route.timeoutMs > 120_000) throw new Error('LINK_PROXY_TIMEOUT_INVALID');
  if (!validPathPrefix(route.pathPrefix)) throw new Error('LINK_PROXY_PATH_PREFIX_INVALID');
  const origin = new URL(route.targetOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('LINK_PROXY_TARGET_ORIGIN_INVALID');
  const host = origin.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:') || host.includes('::ffff:') || /^127\./.test(host) || /^169\.254\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('LINK_PROXY_PRIVATE_TARGET_BLOCKED');
  return origin;
}

function safeHeaders(input: Readonly<Record<string, string>>, allowed: readonly string[], idempotencyKey: string): Readonly<Record<string, string>> {
  const entries = Object.entries(input);
  if (entries.length > 32) throw new Error('LINK_PROXY_TOO_MANY_HEADERS');
  if (entries.reduce((sum,[name,value]) => sum + name.length + value.length, 0) > 16_384) throw new Error('LINK_PROXY_HEADERS_TOO_LARGE');
  const allow = new Set(allowed.map((header) => header.toLowerCase()));
  const out: Record<string, string> = { 'idempotency-key': idempotencyKey };
  for (const [rawName, value] of Object.entries(input)) {
    const name = rawName.toLowerCase();
    if (!/^[a-z0-9-]{1,80}$/.test(name)) throw new Error('LINK_PROXY_HEADER_NAME_INVALID');
    if (/\r|\n/.test(value)) throw new Error('LINK_PROXY_HEADER_INJECTION');
    if (name === 'authorization' || name === 'cookie' || name === 'host' || name === 'connection' || name.startsWith('proxy-') || name.startsWith('sec-')) continue;
    if (allow.has(name)) out[name] = value.slice(0, 4096);
  }
  return Object.freeze(out);
}

function requestCommitment(request: LinkProxyRequest): string {
  const headerEntries = Object.entries(request.headers).map(([k,v]) => [k.toLowerCase(), v] as const).sort((a,b) => a[0].localeCompare(b[0]));
  const envelope = JSON.stringify({ operationId: request.operationId, idempotencyKey: request.idempotencyKey, routeId: request.routeId, method: request.method, relativePath: request.relativePath, headers: headerEntries, bodySha256: sha256(request.body) });
  return createHash('sha256').update(envelope).digest('hex');
}

export class SqliteLinkProxyStore implements LinkProxyStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS link_proxy_operations (
        operation_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        route_id TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        state TEXT NOT NULL,
        upstream_status INTEGER,
        response_sha256 TEXT,
        response_body TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        CHECK (state IN ('PERSISTED','UPSTREAM_ACCEPTED','UPSTREAM_REJECTED','UNKNOWN'))
      );
      CREATE INDEX IF NOT EXISTS idx_link_proxy_state ON link_proxy_operations(state, updated_at_ms);
    `);
  }
  private row(value: unknown): LinkProxyRecord | null {
    if (!value) return null; const r = value as any;
    return Object.freeze({ operationId:r.operation_id,idempotencyKey:r.idempotency_key,routeId:r.route_id,requestSha256:r.request_sha256,state:r.state,upstreamStatus:r.upstream_status===null?null:Number(r.upstream_status),responseSha256:r.response_sha256,responseBody:r.response_body,createdAtMs:Number(r.created_at_ms),updatedAtMs:Number(r.updated_at_ms) });
  }
  get(operationId: string) { return this.row(this.db.prepare('SELECT * FROM link_proxy_operations WHERE operation_id=?').get(operationId)); }
  getByIdempotencyKey(idempotencyKey: string) { return this.row(this.db.prepare('SELECT * FROM link_proxy_operations WHERE idempotency_key=?').get(idempotencyKey)); }
  insert(record: LinkProxyRecord): boolean {
    const result = this.db.prepare(`INSERT OR IGNORE INTO link_proxy_operations(operation_id,idempotency_key,route_id,request_sha256,state,upstream_status,response_sha256,response_body,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(record.operationId,record.idempotencyKey,record.routeId,record.requestSha256,record.state,record.upstreamStatus,record.responseSha256,record.responseBody,record.createdAtMs,record.updatedAtMs);
    return Number((result as any).changes ?? 0) === 1;
  }
  update(record: LinkProxyRecord): void {
    this.db.prepare('UPDATE link_proxy_operations SET state=?,upstream_status=?,response_sha256=?,response_body=?,updated_at_ms=? WHERE operation_id=?').run(record.state,record.upstreamStatus,record.responseSha256,record.responseBody,record.updatedAtMs,record.operationId);
  }
}

export class LinkReceiverProxy {
  private readonly routes: ReadonlyMap<string, LinkProxyRoute>;
  constructor(routes: readonly LinkProxyRoute[], private readonly store: LinkProxyStore, private readonly invoker: LinkProxyInvoker) {
    const map = new Map<string, LinkProxyRoute>(); for (const route of routes) { validatedRoute(route); if (map.has(route.routeId)) throw new Error('LINK_PROXY_DUPLICATE_ROUTE'); map.set(route.routeId, Object.freeze({...route})); }
    this.routes = map;
  }

  capabilities(nowMs = Date.now()): ReceiverCapabilitiesV1 { return receiverProxyCapabilities(nowMs); }

  async execute(request: LinkProxyRequest, nowMs = Date.now()): Promise<{ readonly duplicate: boolean; readonly record: LinkProxyRecord }> {
    if (!validToken(request.operationId) || !validToken(request.idempotencyKey)) throw new Error('LINK_PROXY_ID_INVALID');
    if (!validRelativePath(request.relativePath)) throw new Error('LINK_PROXY_PATH_INVALID');
    const route = this.routes.get(request.routeId); if (!route) throw new Error('LINK_PROXY_ROUTE_NOT_FOUND');
    const origin = validatedRoute(route);
    if (!route.allowedMethods.includes(request.method)) throw new Error('LINK_PROXY_METHOD_NOT_ALLOWED');
    if (request.body.byteLength > route.maxRequestBytes) throw new Error('LINK_PROXY_REQUEST_TOO_LARGE');
    const commitment = requestCommitment(request);
    const existing = this.store.get(request.operationId) ?? this.store.getByIdempotencyKey(request.idempotencyKey);
    if (existing) {
      if (existing.operationId !== request.operationId || existing.idempotencyKey !== request.idempotencyKey || existing.requestSha256 !== commitment || existing.routeId !== request.routeId) throw new Error('LINK_PROXY_IDEMPOTENCY_CONFLICT');
      return Object.freeze({ duplicate: true, record: existing });
    }
    const persisted: LinkProxyRecord = Object.freeze({ operationId:request.operationId,idempotencyKey:request.idempotencyKey,routeId:request.routeId,requestSha256:commitment,state:'PERSISTED',upstreamStatus:null,responseSha256:null,responseBody:null,createdAtMs:request.createdAtMs,updatedAtMs:nowMs });
    if (!this.store.insert(persisted)) throw new Error('LINK_PROXY_CONCURRENT_CONFLICT');
    const headers = safeHeaders(request.headers, route.allowedRequestHeaders, request.idempotencyKey);
    const basePath = route.pathPrefix.endsWith('/') ? route.pathPrefix.slice(0,-1) : route.pathPrefix;
    const url = new URL(basePath + request.relativePath, origin); if (url.origin !== origin.origin) throw new Error('LINK_PROXY_TARGET_ESCAPE');
    try {
      const response = await this.invoker.invoke({ url:url.toString(), method:request.method, headers, body:request.body, timeoutMs:route.timeoutMs });
      if (response.status >= 300 && response.status < 400) throw new Error('LINK_PROXY_REDIRECT_REFUSED');
      if (response.body.byteLength > route.maxResponseBytes) throw new Error('LINK_PROXY_RESPONSE_TOO_LARGE');
      const accepted = response.status >= 200 && response.status < 300;
      const record: LinkProxyRecord = Object.freeze({ ...persisted, state: accepted?'UPSTREAM_ACCEPTED':'UPSTREAM_REJECTED', upstreamStatus:response.status, responseSha256:sha256(response.body), responseBody:null, updatedAtMs:nowMs });
      this.store.update(record); return Object.freeze({ duplicate:false, record });
    } catch (error) {
      const record: LinkProxyRecord = Object.freeze({ ...persisted, state:'UNKNOWN', updatedAtMs:nowMs }); this.store.update(record);
      return Object.freeze({ duplicate:false, record });
    }
  }

  async reconcile(operationId: string, nowMs = Date.now()): Promise<LinkProxyRecord | null> {
    const record = this.store.get(operationId); if (!record || record.state !== 'UNKNOWN') return record;
    const route = this.routes.get(record.routeId); if (!route || !this.invoker.query) return record;
    const result = await this.invoker.query(route, record.idempotencyKey);
    if (result === 'UNKNOWN') return record;
    const resolved: LinkProxyRecord = Object.freeze({ ...record, state: result === 'APPLIED' ? 'UPSTREAM_ACCEPTED' : 'UPSTREAM_REJECTED', updatedAtMs:nowMs });
    this.store.update(resolved); return resolved;
  }
}
