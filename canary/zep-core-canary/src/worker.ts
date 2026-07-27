import { ZepError } from '../vendor/zep-core/src/errors.js';
import { validateMessage } from '../vendor/zep-core/src/message.js';
import type { LogicalMessageInput } from '../vendor/zep-core/src/types.js';

const SOURCE_DELIVERY_ID = 'ZUNGUN-ARQ-ZEP-CORE-IMPLEMENTATION-20260726-006';
const SOURCE_ARCHIVE_SHA256 = 'f1df15fac64354ad51c297e3e4d0fca1c94e3bad01f1c5383bcb1dc367f133ec';
const CANARY_DELIVERY_ID = 'ZUNGUN-ARQ-ZEP-CF-CANARY-IMPLEMENTATION-20260726-001';
const MAX_REQUEST_BODY_BYTES = 65_536;
const MAX_DECODED_PAYLOAD_BYTES = 48_000;

const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'application/json; charset=utf-8',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

const INPUT_KEYS = Object.freeze([
  'zepVersion',
  'messageId',
  'conversationId',
  'senderId',
  'recipientIds',
  'createdAtMs',
  'expiresAtMs',
  'priority',
  'contentType',
  'payloadBase64',
  'receiptPolicy',
  'messageCommitment',
  'extensions',
] as const);

const REQUIRED_INPUT_KEYS = Object.freeze(INPUT_KEYS.filter((key) => key !== 'extensions'));
const INPUT_KEY_SET: ReadonlySet<string> = new Set(INPUT_KEYS);

class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly allow?: string,
  ) {
    super(code);
  }
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: Readonly<Record<string, string>>): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders !== undefined) {
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function exactJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpProblem(400, 'INVALID_JSON_OBJECT');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new HttpProblem(400, 'INVALID_JSON_OBJECT');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!INPUT_KEY_SET.has(key)) throw new HttpProblem(400, 'UNSUPPORTED_FIELD');
  }
  for (const key of REQUIRED_INPUT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new HttpProblem(400, 'MISSING_FIELD');
  }
  return record;
}

function strictBase64ToBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string') throw new HttpProblem(400, 'INVALID_BASE64');
  if (value.length % 4 !== 0) throw new HttpProblem(400, 'INVALID_BASE64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new HttpProblem(400, 'INVALID_BASE64');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new HttpProblem(400, 'INVALID_BASE64');
  }
  if (binary.length > MAX_DECODED_PAYLOAD_BYTES) throw new HttpProblem(413, 'PAYLOAD_TOO_LARGE');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  let canonical = '';
  try {
    canonical = btoa(binary);
  } catch {
    throw new HttpProblem(400, 'INVALID_BASE64');
  }
  if (canonical !== value) throw new HttpProblem(400, 'NON_CANONICAL_BASE64');
  return bytes;
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declaredLength = request.headers.get('content-length');
  let expectedLength: number | undefined;
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength)) throw new HttpProblem(400, 'INVALID_CONTENT_LENGTH');
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength)) throw new HttpProblem(400, 'INVALID_CONTENT_LENGTH');
    if (parsedLength > MAX_REQUEST_BODY_BYTES) throw new HttpProblem(413, 'REQUEST_BODY_TOO_LARGE');
    expectedLength = parsedLength;
  }

  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel('body limit exceeded').catch(() => undefined);
        throw new HttpProblem(413, 'REQUEST_BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }

  if (expectedLength !== undefined && expectedLength !== total) {
    throw new HttpProblem(400, 'CONTENT_LENGTH_MISMATCH');
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpProblem(400, 'INVALID_UTF8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpProblem(400, 'INVALID_JSON');
  }
}

function contentTypeIsJson(request: Request): boolean {
  const raw = request.headers.get('content-type');
  if (raw === null) return false;
  return raw.split(';', 1)[0]!.trim().toLowerCase() === 'application/json';
}

function mapValidationInput(record: Record<string, unknown>): LogicalMessageInput {
  const payload = strictBase64ToBytes(record.payloadBase64);
  return {
    zepVersion: record.zepVersion as LogicalMessageInput['zepVersion'],
    messageId: record.messageId as string,
    conversationId: record.conversationId as string,
    senderId: record.senderId as string,
    recipientIds: record.recipientIds as readonly string[],
    createdAtMs: record.createdAtMs as number,
    expiresAtMs: record.expiresAtMs as number,
    priority: record.priority as LogicalMessageInput['priority'],
    contentType: record.contentType as string,
    payload,
    receiptPolicy: record.receiptPolicy as LogicalMessageInput['receiptPolicy'],
    messageCommitment: record.messageCommitment as string,
    ...(Object.prototype.hasOwnProperty.call(record, 'extensions') ? { extensions: record.extensions } : {}),
  };
}

function validationSuccess(message: ReturnType<typeof validateMessage>): Response {
  return jsonResponse({
    ok: true,
    result: {
      zepVersion: message.zepVersion,
      messageId: message.messageId,
      recipientCount: message.recipientIds.length,
      createdAtMs: message.createdAtMs,
      expiresAtMs: message.expiresAtMs,
      priority: message.priority,
      contentType: message.contentType,
      payloadBytes: message.payload.byteLength,
      receiptPolicy: message.receiptPolicy,
      extensionsPresent: message.extensions !== undefined,
    },
    source: {
      deliveryId: SOURCE_DELIVERY_ID,
      archiveSha256: SOURCE_ARCHIVE_SHA256,
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpProblem) {
    return jsonResponse(
      { ok: false, error: { code: error.code, retryable: false } },
      error.status,
      error.allow === undefined ? undefined : { allow: error.allow },
    );
  }
  if (error instanceof ZepError) {
    const status = error.code === 'EXPIRED' ? 410 : error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 422;
    return jsonResponse({ ok: false, error: { code: error.code, retryable: error.retryable } }, status);
  }
  return jsonResponse({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: false } }, 500);
}

export async function handleRequest(request: Request, now: () => number = Date.now): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.search !== '') throw new HttpProblem(404, 'NOT_FOUND');

    if (url.pathname === '/health') {
      if (request.method !== 'GET') throw new HttpProblem(405, 'METHOD_NOT_ALLOWED', 'GET');
      return jsonResponse({
        ok: true,
        status: 'healthy',
        canary: { deliveryId: CANARY_DELIVERY_ID },
        source: { deliveryId: SOURCE_DELIVERY_ID, archiveSha256: SOURCE_ARCHIVE_SHA256 },
      });
    }

    if (url.pathname === '/v1/messages/validate') {
      if (request.method !== 'POST') throw new HttpProblem(405, 'METHOD_NOT_ALLOWED', 'POST');
      if (!contentTypeIsJson(request)) throw new HttpProblem(415, 'UNSUPPORTED_MEDIA_TYPE');
      const bytes = await readBoundedBody(request);
      const parsed = parseJsonBytes(bytes);
      const record = exactJsonRecord(parsed);
      const validated = validateMessage(mapValidationInput(record), now());
      return validationSuccess(validated);
    }

    throw new HttpProblem(404, 'NOT_FOUND');
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
};
