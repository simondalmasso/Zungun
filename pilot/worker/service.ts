import { ZepError } from '../../canary/zep-core-canary/vendor/zep-core/src/errors.js';
import { validateMessage } from '../../canary/zep-core-canary/vendor/zep-core/src/message.js';
import type { LogicalMessageInput } from '../../canary/zep-core-canary/vendor/zep-core/src/types.js';
import { snapshotExactRecord } from '../../canary/zep-core-canary/vendor/zep-core/src/validation.js';
import {
  PILOT_MAX_BODY_BYTES,
  PILOT_MAX_PAYLOAD_BYTES,
  cloneStored,
  storedFromMessage,
  type MessageRepository,
  type PilotProcessingReceipt,
  type StoredMessage,
  type StoredMessageProcessor,
} from './model.js';
import { authorizeBearer, issueProcessingReceipt, verifyProcessingReceipt } from './receipt.js';

const INPUT_KEYS = Object.freeze([
  'zepVersion', 'messageId', 'conversationId', 'senderId', 'recipientIds',
  'createdAtMs', 'expiresAtMs', 'priority', 'contentType', 'payloadBase64',
  'receiptPolicy', 'messageCommitment', 'extensions',
] as const);
const REQUIRED_KEYS = Object.freeze(INPUT_KEYS.filter((key) => key !== 'extensions'));
const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'application/json; charset=utf-8',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

class HttpProblem extends Error {
  constructor(readonly status: number, readonly code: string, readonly allow?: string) { super(code); }
}

function response(body: unknown, status = 200, extra?: Readonly<Record<string, string>>): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extra !== undefined) for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function safeRecord(record: StoredMessage, receipt?: PilotProcessingReceipt): Record<string, unknown> {
  return {
    messageId: record.messageId,
    messageCommitment: record.messageCommitment,
    zepVersion: record.zepVersion,
    conversationId: record.conversationId,
    senderId: record.senderId,
    recipientCount: record.recipientIds.length,
    contentType: record.contentType,
    payloadBytes: record.payload.byteLength,
    createdAtMs: record.createdAtMs,
    expiresAtMs: record.expiresAtMs,
    status: record.status,
    storedAtMs: record.storedAtMs,
    acknowledgedAtMs: record.acknowledgedAtMs,
    ...(receipt === undefined ? {} : { processingReceipt: receipt }),
  };
}

function contentTypeIsJson(request: Request): boolean {
  const value = request.headers.get('content-type');
  return value !== null && value.split(';', 1)[0]!.trim().toLowerCase() === 'application/json';
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  let expected: number | undefined;
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) throw new HttpProblem(400, 'INVALID_CONTENT_LENGTH');
    expected = Number(declared);
    if (!Number.isSafeInteger(expected)) throw new HttpProblem(400, 'INVALID_CONTENT_LENGTH');
    if (expected > PILOT_MAX_BODY_BYTES) throw new HttpProblem(413, 'REQUEST_BODY_TOO_LARGE');
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
      if (total > PILOT_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new HttpProblem(413, 'REQUEST_BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
  if (expected !== undefined && expected !== total) throw new HttpProblem(400, 'CONTENT_LENGTH_MISMATCH');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function parseJson(bytes: Uint8Array): unknown {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new HttpProblem(400, 'INVALID_UTF8'); }
  try { return JSON.parse(text) as unknown; }
  catch { throw new HttpProblem(400, 'INVALID_JSON'); }
}

function strictBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0) throw new HttpProblem(400, 'INVALID_BASE64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new HttpProblem(400, 'INVALID_BASE64');
  }
  let binary: string;
  try { binary = atob(value); } catch { throw new HttpProblem(400, 'INVALID_BASE64'); }
  if (binary.length > PILOT_MAX_PAYLOAD_BYTES) throw new HttpProblem(413, 'PAYLOAD_TOO_LARGE');
  if (btoa(binary) !== value) throw new HttpProblem(400, 'INVALID_BASE64');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function mapInput(parsed: unknown): LogicalMessageInput {
  let record: Record<string, unknown>;
  try { record = snapshotExactRecord(parsed, INPUT_KEYS, 'PilotMessageInput'); }
  catch { throw new HttpProblem(400, 'UNSUPPORTED_FIELD'); }
  for (const key of REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new HttpProblem(400, 'MISSING_FIELD');
  }
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
    payload: strictBase64(record.payloadBase64),
    receiptPolicy: record.receiptPolicy as LogicalMessageInput['receiptPolicy'],
    messageCommitment: record.messageCommitment as string,
    ...(Object.prototype.hasOwnProperty.call(record, 'extensions') ? { extensions: record.extensions } : {}),
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function decodeMessageId(segment: string): string {
  let value: string;
  try { value = decodeURIComponent(segment); } catch { throw new HttpProblem(400, 'INVALID_MESSAGE_ID'); }
  if (value.length < 1 || value.length > 256 || /\s/.test(value)) throw new HttpProblem(400, 'INVALID_MESSAGE_ID');
  return value;
}

function reconstruct(record: StoredMessage): LogicalMessageInput {
  let extensions: unknown = undefined;
  if (record.extensionsJson !== null) {
    try { extensions = JSON.parse(record.extensionsJson) as unknown; }
    catch { throw new Error('CORRUPT_STORED_MESSAGE'); }
  }
  return {
    zepVersion: record.zepVersion,
    messageId: record.messageId,
    conversationId: record.conversationId,
    senderId: record.senderId,
    recipientIds: record.recipientIds,
    createdAtMs: record.createdAtMs,
    expiresAtMs: record.expiresAtMs,
    priority: record.priority,
    contentType: record.contentType,
    payload: record.payload,
    receiptPolicy: record.receiptPolicy,
    messageCommitment: record.messageCommitment,
    ...(extensions === undefined ? {} : { extensions }),
  };
}

export class RevalidatingStoredMessageProcessor implements StoredMessageProcessor {
  async process(record: StoredMessage, nowMs: number): Promise<void> {
    validateMessage(reconstruct(record), nowMs);
    if (await sha256Hex(record.payload) !== record.payloadSha256) throw new Error('CORRUPT_STORED_MESSAGE');
  }
}

export interface PilotServiceOptions {
  readonly now?: () => number;
  readonly processor?: StoredMessageProcessor;
}

export class PilotService {
  private readonly now: () => number;
  private readonly processor: StoredMessageProcessor;

  constructor(
    private readonly repository: MessageRepository,
    private readonly token: string,
    options: PilotServiceOptions = {},
  ) {
    if (typeof token !== 'string' || token.length < 32) throw new Error('PILOT_TOKEN_CONFIGURATION_INVALID');
    this.now = options.now ?? Date.now;
    this.processor = options.processor ?? new RevalidatingStoredMessageProcessor();
  }

  private async existingReceipt(record: StoredMessage): Promise<PilotProcessingReceipt | undefined> {
    if (record.status !== 'ACKNOWLEDGED') return undefined;
    if (record.processingReceiptJson === null || record.processingReceiptId === null) throw new Error('CORRUPT_STORED_MESSAGE');
    let parsed: unknown;
    try { parsed = JSON.parse(record.processingReceiptJson) as unknown; }
    catch { throw new Error('CORRUPT_STORED_MESSAGE'); }
    const signingKey = await this.repository.getOrCreateReceiptSigningKey(record.storedAtMs);
    const verified = await verifyProcessingReceipt(parsed, signingKey, record);
    if (verified.receiptId !== record.processingReceiptId || verified.acknowledgedAtMs !== record.acknowledgedAtMs) {
      throw new Error('CORRUPT_STORED_MESSAGE');
    }
    return verified;
  }

  private async requireAuth(request: Request): Promise<void> {
    if (!(await authorizeBearer(request.headers.get('authorization'), this.token))) {
      throw new HttpProblem(401, 'UNAUTHORIZED');
    }
  }

  private async create(request: Request): Promise<Response> {
    if (!contentTypeIsJson(request)) throw new HttpProblem(415, 'UNSUPPORTED_MEDIA_TYPE');
    const nowMs = this.now();
    const validated = validateMessage(mapInput(parseJson(await readBoundedBody(request))), nowMs);
    if (validated.createdAtMs > nowMs) throw new HttpProblem(422, 'INVALID_TIMESTAMP');
    const candidate = storedFromMessage(validated, await sha256Hex(validated.payload), nowMs);
    let result;
    try { result = await this.repository.createOrGet(candidate); }
    catch (error) {
      if (error instanceof Error && error.message === 'DUPLICATE_CONFLICT') throw new HttpProblem(409, 'DUPLICATE_CONFLICT');
      throw error;
    }
    const receipt = await this.existingReceipt(result.record);
    return response({ ok: true, idempotent: !result.created, result: safeRecord(result.record, receipt) }, result.created ? 201 : 200);
  }

  private async get(messageId: string): Promise<Response> {
    const record = await this.repository.get(messageId);
    if (record === null) throw new HttpProblem(404, 'NOT_FOUND');
    return response({ ok: true, result: safeRecord(record, await this.existingReceipt(record)) });
  }

  private async acknowledge(messageId: string): Promise<Response> {
    const current = await this.repository.get(messageId);
    if (current === null) throw new HttpProblem(404, 'NOT_FOUND');
    const nowMs = this.now();
    if (current.expiresAtMs <= nowMs) throw new HttpProblem(410, 'EXPIRED');
    if (current.status === 'ACKNOWLEDGED') {
      return response({ ok: true, idempotent: true, result: safeRecord(current, await this.existingReceipt(current)) });
    }
    await this.processor.process(cloneStored(current), nowMs);
    const acknowledgedAtMs = this.now();
    if (current.expiresAtMs <= acknowledgedAtMs) throw new HttpProblem(410, 'EXPIRED');
    const signingKey = await this.repository.getOrCreateReceiptSigningKey(acknowledgedAtMs);
    const receipt = await issueProcessingReceipt(current, acknowledgedAtMs, signingKey);
    const result = await this.repository.acknowledge(
      current.messageId,
      current.messageCommitment,
      acknowledgedAtMs,
      receipt.receiptId,
      JSON.stringify(receipt),
    );
    if (result === null) throw new HttpProblem(404, 'NOT_FOUND');
    if (result.record.messageCommitment !== current.messageCommitment) throw new HttpProblem(409, 'DUPLICATE_CONFLICT');
    if (result.record.status !== 'ACKNOWLEDGED') {
      if (result.record.expiresAtMs <= acknowledgedAtMs) throw new HttpProblem(410, 'EXPIRED');
      throw new Error('ACK_TRANSITION_FAILED');
    }
    const authoritative = await this.existingReceipt(result.record);
    if (authoritative === undefined) throw new Error('ACK_RECEIPT_MISSING');
    return response({
      ok: true,
      idempotent: !result.transitioned,
      result: safeRecord(result.record, authoritative),
    });
  }

  async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.search !== '') throw new HttpProblem(404, 'NOT_FOUND');
      await this.requireAuth(request);
      if (url.pathname === '/v0/messages') {
        if (request.method !== 'POST') throw new HttpProblem(405, 'METHOD_NOT_ALLOWED', 'POST');
        return await this.create(request);
      }
      const match = /^\/v0\/messages\/([^/]+)(\/ack)?$/.exec(url.pathname);
      if (match === null) throw new HttpProblem(404, 'NOT_FOUND');
      const messageId = decodeMessageId(match[1]!);
      if (match[2] === '/ack') {
        if (request.method !== 'POST') throw new HttpProblem(405, 'METHOD_NOT_ALLOWED', 'POST');
        if (request.body !== null) {
          const bytes = await readBoundedBody(request);
          if (bytes.byteLength !== 0) throw new HttpProblem(400, 'UNEXPECTED_BODY');
        }
        return await this.acknowledge(messageId);
      }
      if (request.method !== 'GET') throw new HttpProblem(405, 'METHOD_NOT_ALLOWED', 'GET');
      return await this.get(messageId);
    } catch (error) {
      if (error instanceof HttpProblem) {
        return response(
          { ok: false, error: { code: error.code, retryable: false } },
          error.status,
          error.allow === undefined ? undefined : { allow: error.allow },
        );
      }
      if (error instanceof ZepError) {
        const status = error.code === 'EXPIRED' ? 410 : error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 422;
        return response({ ok: false, error: { code: error.code, retryable: error.retryable } }, status);
      }
      return response({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: false } }, 500);
    }
  }
}
