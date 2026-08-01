import type { LogicalMessageInput } from '../../canary/zep-core-canary/vendor/zep-core/src/types.js';
import {
  PILOT_MAX_BODY_BYTES,
  PILOT_MAX_PAYLOAD_BYTES,
  SYNC_MAX_ACK_ENVELOPE_ITEMS,
  SYNC_MAX_OUTGOING_ENVELOPE_ITEMS,
  SYNC_MAX_PULL_ITEMS,
  SYNC_MAX_RESPONSE_BYTES,
  SYNC_MIN_RESPONSE_BYTES,
  canonicalJson,
  type MailboxDelivery,
  type MessageRepository,
} from './model.js';

const SYNC_KEYS = Object.freeze([
  'syncVersion',
  'requestId',
  'mailboxId',
  'cursor',
  'maxResponseBytes',
  'pullLimit',
  'outgoingMessages',
  'ackMessages',
] as const);
const MESSAGE_KEYS = Object.freeze([
  'zepVersion', 'messageId', 'conversationId', 'senderId', 'recipientIds',
  'createdAtMs', 'expiresAtMs', 'priority', 'contentType', 'payloadBase64',
  'receiptPolicy', 'messageCommitment', 'extensions',
] as const);
const MESSAGE_REQUIRED_KEYS = Object.freeze(MESSAGE_KEYS.filter((key) => key !== 'extensions'));
const ACK_KEYS = Object.freeze(['messageId', 'messageCommitment'] as const);
const CURSOR_PATTERN = /^sb0_[A-Za-z0-9_-]{32}$/;
const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'content-type': 'application/json; charset=utf-8',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

export class HttpProblem extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export class ItemProblem extends Error {
  constructor(readonly code: ItemErrorCode) { super(code); }
}

export type ItemErrorCode = 'MALFORMED_ITEM' | 'EXPIRED' | 'DUPLICATE_CONFLICT' | 'QUOTA_EXCEEDED' | 'PAYLOAD_TOO_LARGE';

export interface SyncEnvelope {
  readonly syncVersion: '0.1';
  readonly requestId: string;
  readonly mailboxId: string;
  readonly cursor: string | null;
  readonly maxResponseBytes: number;
  readonly pullLimit: number;
  readonly outgoingMessages: readonly unknown[];
  readonly ackMessages: readonly unknown[];
  readonly canonicalRequest: string;
}

interface ItemAccepted {
  readonly index: number;
  readonly status: 'ACCEPTED' | 'ACKNOWLEDGED';
  readonly idempotent: boolean;
}

interface ItemRejected {
  readonly index: number;
  readonly status: 'REJECTED';
  readonly error: {
    readonly code: ItemErrorCode;
    readonly retryable: false;
  };
}

export type ItemResult = ItemAccepted | ItemRejected;

interface SyncResponseBody {
  readonly ok: true;
  readonly syncVersion: '0.1';
  readonly requestId: string;
  readonly mailboxId: string;
  readonly idempotent: boolean;
  readonly outgoingResults: readonly ItemResult[];
  readonly ackResults: readonly ItemResult[];
  readonly pendingMessages: readonly Record<string, unknown>[];
  readonly nextCursor: string;
  readonly hasMore: boolean;
}

function exactRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('NOT_OBJECT');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!allowed.includes(key)) throw new Error('UNSUPPORTED_FIELD');
  return record;
}

function requiredString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error('INVALID_STRING');
  }
  return value;
}

export function contentTypeIsJson(request: Request): boolean {
  const value = request.headers.get('content-type');
  return value !== null && value.split(';', 1)[0]!.trim().toLowerCase() === 'application/json';
}

export async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  let expected: number | undefined;
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared)) throw new HttpProblem(400, 'INVALID_JSON');
    expected = Number(declared);
    if (!Number.isSafeInteger(expected)) throw new HttpProblem(400, 'INVALID_JSON');
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
  if (expected !== undefined && expected !== total) throw new HttpProblem(400, 'INVALID_JSON');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

export function parseJson(bytes: Uint8Array): unknown {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new HttpProblem(400, 'INVALID_JSON'); }
  try { return JSON.parse(text) as unknown; }
  catch { throw new HttpProblem(400, 'INVALID_JSON'); }
}

export function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function rejected(index: number, code: ItemErrorCode): ItemRejected {
  return Object.freeze({ index, status: 'REJECTED', error: Object.freeze({ code, retryable: false }) });
}

export function accepted(index: number, status: 'ACCEPTED' | 'ACKNOWLEDGED', idempotent: boolean): ItemAccepted {
  return Object.freeze({ index, status, idempotent });
}

function strictBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0) throw new ItemProblem('MALFORMED_ITEM');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new ItemProblem('MALFORMED_ITEM');
  }
  let binary: string;
  try { binary = atob(value); } catch { throw new ItemProblem('MALFORMED_ITEM'); }
  if (binary.length > PILOT_MAX_PAYLOAD_BYTES) throw new ItemProblem('PAYLOAD_TOO_LARGE');
  if (btoa(binary) !== value) throw new ItemProblem('MALFORMED_ITEM');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function mapMessageItem(value: unknown): LogicalMessageInput {
  let record: Record<string, unknown>;
  try { record = exactRecord(value, MESSAGE_KEYS); }
  catch { throw new ItemProblem('MALFORMED_ITEM'); }
  for (const key of MESSAGE_REQUIRED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new ItemProblem('MALFORMED_ITEM');
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

export function mapAckItem(value: unknown): { readonly messageId: string; readonly messageCommitment: string } {
  try {
    const record = exactRecord(value, ACK_KEYS);
    if (!Object.prototype.hasOwnProperty.call(record, 'messageId') || !Object.prototype.hasOwnProperty.call(record, 'messageCommitment')) {
      throw new Error('MISSING');
    }
    return Object.freeze({
      messageId: requiredString(record.messageId, 256),
      messageCommitment: requiredString(record.messageCommitment, 256),
    });
  } catch {
    throw new ItemProblem('MALFORMED_ITEM');
  }
}

function placeholderResults(count: number): readonly ItemRejected[] {
  return Object.freeze(Array.from({ length: count }, (_, index) => rejected(index, 'DUPLICATE_CONFLICT')));
}

export function validateEnvelope(parsed: unknown): SyncEnvelope {
  let record: Record<string, unknown>;
  try { record = exactRecord(parsed, SYNC_KEYS); }
  catch { throw new HttpProblem(422, 'INVALID_SYNC_ENVELOPE'); }
  for (const key of SYNC_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) throw new HttpProblem(422, 'INVALID_SYNC_ENVELOPE');
  }
  try {
    if (record.syncVersion !== '0.1') throw new Error('VERSION');
    const requestId = requiredString(record.requestId, 128);
    const mailboxId = requiredString(record.mailboxId, 128);
    if (record.cursor !== null && (typeof record.cursor !== 'string' || !CURSOR_PATTERN.test(record.cursor))) throw new Error('CURSOR');
    if (!Number.isSafeInteger(record.maxResponseBytes)
      || (record.maxResponseBytes as number) < SYNC_MIN_RESPONSE_BYTES
      || (record.maxResponseBytes as number) > SYNC_MAX_RESPONSE_BYTES) throw new Error('MAX_RESPONSE');
    if (!Number.isSafeInteger(record.pullLimit)
      || (record.pullLimit as number) < 0
      || (record.pullLimit as number) > SYNC_MAX_PULL_ITEMS) throw new Error('PULL_LIMIT');
    if (!Array.isArray(record.outgoingMessages) || record.outgoingMessages.length > SYNC_MAX_OUTGOING_ENVELOPE_ITEMS) throw new Error('OUTGOING');
    if (!Array.isArray(record.ackMessages) || record.ackMessages.length > SYNC_MAX_ACK_ENVELOPE_ITEMS) throw new Error('ACKS');
    const envelope: SyncEnvelope = Object.freeze({
      syncVersion: '0.1',
      requestId,
      mailboxId,
      cursor: record.cursor as string | null,
      maxResponseBytes: record.maxResponseBytes as number,
      pullLimit: record.pullLimit as number,
      outgoingMessages: Object.freeze([...record.outgoingMessages]),
      ackMessages: Object.freeze([...record.ackMessages]),
      canonicalRequest: canonicalJson(parsed),
    });
    const budgetProbe: SyncResponseBody = Object.freeze({
      ok: true,
      syncVersion: '0.1',
      requestId,
      mailboxId,
      idempotent: false,
      outgoingResults: placeholderResults(envelope.outgoingMessages.length),
      ackResults: placeholderResults(envelope.ackMessages.length),
      pendingMessages: Object.freeze([]),
      nextCursor: `sb0_${'A'.repeat(32)}`,
      hasMore: false,
    });
    if (encodedBytes(budgetProbe) > envelope.maxResponseBytes) throw new Error('RESPONSE_BUDGET');
    return envelope;
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    throw new HttpProblem(422, 'INVALID_SYNC_ENVELOPE');
  }
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function pendingMessage(delivery: MailboxDelivery): Record<string, unknown> {
  let extensions: unknown = undefined;
  if (delivery.message.extensionsJson !== null) {
    try { extensions = JSON.parse(delivery.message.extensionsJson) as unknown; }
    catch { throw new Error('CORRUPT_STORED_MESSAGE'); }
  }
  return Object.freeze({
    entrySequence: delivery.entrySequence,
    zepVersion: delivery.message.zepVersion,
    messageId: delivery.message.messageId,
    conversationId: delivery.message.conversationId,
    senderId: delivery.message.senderId,
    recipientIds: delivery.message.recipientIds,
    createdAtMs: delivery.message.createdAtMs,
    expiresAtMs: delivery.message.expiresAtMs,
    priority: delivery.message.priority,
    contentType: delivery.message.contentType,
    payloadBase64: bytesToBase64(delivery.message.payload),
    receiptPolicy: delivery.message.receiptPolicy,
    messageCommitment: delivery.message.messageCommitment,
    ...(extensions === undefined ? {} : { extensions }),
  });
}

export function parseResultArray(json: string): readonly ItemResult[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value)) throw new Error('CORRUPT_SYNC_REQUEST');
  return Object.freeze(value as ItemResult[]);
}

export function parseSequenceArray(json: string): readonly number[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value) || !value.every((entry) => Number.isSafeInteger(entry) && entry >= 1)) {
    throw new Error('CORRUPT_SYNC_REQUEST');
  }
  return Object.freeze(value as number[]);
}

export function buildBody(
  requestId: string,
  mailboxId: string,
  outgoingResults: readonly ItemResult[],
  ackResults: readonly ItemResult[],
  deliveries: readonly MailboxDelivery[],
  nextCursor: string,
  hasMore: boolean,
  idempotent: boolean,
): SyncResponseBody {
  return Object.freeze({
    ok: true,
    syncVersion: '0.1',
    requestId,
    mailboxId,
    idempotent,
    outgoingResults,
    ackResults,
    pendingMessages: Object.freeze(deliveries.map(pendingMessage)),
    nextCursor,
    hasMore,
  });
}

export async function createCursor(repository: MessageRepository, mailboxId: string, entrySequence: number, nowMs: number): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = `sb0_${bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
    if (!CURSOR_PATTERN.test(token)) throw new Error('CURSOR_GENERATION_FAILED');
    try {
      await repository.storeCursor(token, mailboxId, entrySequence, nowMs);
      return token;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'D1_CURSOR_CREATE_FAILED') throw error;
    }
  }
  throw new Error('CURSOR_GENERATION_FAILED');
}
