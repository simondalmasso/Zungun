import { snapshotExactRecord } from '../../canary/zep-core-canary/vendor/zep-core/src/validation.js';
import {
  PILOT_PROCESSOR_ID,
  PILOT_RECEIPT_SCHEMA,
  type PilotProcessingReceipt,
  type StoredMessage,
} from './model.js';

const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'receiptId',
  'messageId',
  'messageCommitment',
  'finalStatus',
  'acknowledgedAtMs',
  'processorId',
] as const);
const DOMAIN = 'zungun-pilot-processing-receipt-v0';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    const chunk = bytes.subarray(offset, Math.min(offset + 8_192, bytes.length));
    for (const value of chunk) binary += String.fromCharCode(value);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmac(signingKey: Uint8Array, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    signingKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${DOMAIN}\u0000${body}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function canonicalReceiptBody(
  messageId: string,
  messageCommitment: string,
  acknowledgedAtMs: number,
): string {
  return JSON.stringify([
    PILOT_RECEIPT_SCHEMA,
    messageId,
    messageCommitment,
    'ACKNOWLEDGED',
    acknowledgedAtMs,
    PILOT_PROCESSOR_ID,
  ]);
}

async function constantTimeTextEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(left)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function issueProcessingReceipt(
  record: StoredMessage,
  acknowledgedAtMs: number,
  signingKey: Uint8Array,
): Promise<PilotProcessingReceipt> {
  const body = canonicalReceiptBody(record.messageId, record.messageCommitment, acknowledgedAtMs);
  const receiptId = `zpr0_${await hmac(signingKey, body)}`;
  return Object.freeze({
    schemaVersion: PILOT_RECEIPT_SCHEMA,
    receiptId,
    messageId: record.messageId,
    messageCommitment: record.messageCommitment,
    finalStatus: 'ACKNOWLEDGED',
    acknowledgedAtMs,
    processorId: PILOT_PROCESSOR_ID,
  });
}

export async function verifyProcessingReceipt(
  value: unknown,
  signingKey: Uint8Array,
  expected: Pick<StoredMessage, 'messageId' | 'messageCommitment'>,
): Promise<PilotProcessingReceipt> {
  let record: Record<string, unknown>;
  try {
    record = snapshotExactRecord(value, RECEIPT_KEYS, 'PilotProcessingReceipt');
  } catch {
    throw new Error('INVALID_PROCESSING_RECEIPT');
  }
  if (
    record.schemaVersion !== PILOT_RECEIPT_SCHEMA
    || record.finalStatus !== 'ACKNOWLEDGED'
    || record.processorId !== PILOT_PROCESSOR_ID
    || record.messageId !== expected.messageId
    || record.messageCommitment !== expected.messageCommitment
    || typeof record.acknowledgedAtMs !== 'number'
    || !Number.isSafeInteger(record.acknowledgedAtMs)
    || record.acknowledgedAtMs < 0
    || typeof record.receiptId !== 'string'
  ) throw new Error('INVALID_PROCESSING_RECEIPT');

  const body = canonicalReceiptBody(
    record.messageId,
    record.messageCommitment,
    record.acknowledgedAtMs,
  );
  const expectedId = `zpr0_${await hmac(signingKey, body)}`;
  if (!(await constantTimeTextEqual(record.receiptId, expectedId))) {
    throw new Error('INVALID_PROCESSING_RECEIPT');
  }
  return Object.freeze({
    schemaVersion: PILOT_RECEIPT_SCHEMA,
    receiptId: record.receiptId,
    messageId: record.messageId,
    messageCommitment: record.messageCommitment,
    finalStatus: 'ACKNOWLEDGED',
    acknowledgedAtMs: record.acknowledgedAtMs,
    processorId: PILOT_PROCESSOR_ID,
  });
}

export async function authorizeBearer(header: string | null, expectedToken: string): Promise<boolean> {
  if (header === null || header.length > 4_096 || !header.startsWith('Bearer ')) return false;
  const candidate = header.slice('Bearer '.length);
  if (candidate.length < 1) return false;
  return constantTimeTextEqual(candidate, expectedToken);
}
