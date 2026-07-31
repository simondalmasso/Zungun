import type { LogicalMessage } from '../../canary/zep-core-canary/vendor/zep-core/src/types.js';

export const PILOT_RECEIPT_SCHEMA = 'zungun.processing-receipt.v0' as const;
export const PILOT_PROCESSOR_ID = 'zungun-d1-pilot-processor-v0' as const;
export const PILOT_MAX_BODY_BYTES = 65_536;
export const PILOT_MAX_PAYLOAD_BYTES = 48_000;

export type PilotMessageStatus = 'STORED' | 'ACKNOWLEDGED';

export interface StoredMessage {
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly zepVersion: '0.1';
  readonly conversationId: string;
  readonly senderId: string;
  readonly recipientIds: readonly string[];
  readonly contentType: string;
  readonly payload: Uint8Array;
  readonly payloadSha256: string;
  readonly priority: 0 | 1 | 2 | 3;
  readonly receiptPolicy: 'END_RECIPIENT_ACK';
  readonly extensionsJson: string | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly status: PilotMessageStatus;
  readonly storedAtMs: number;
  readonly acknowledgedAtMs: number | null;
  readonly processingReceiptId: string | null;
  readonly processingReceiptJson: string | null;
}

export interface PilotProcessingReceipt {
  readonly schemaVersion: typeof PILOT_RECEIPT_SCHEMA;
  readonly receiptId: string;
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly finalStatus: 'ACKNOWLEDGED';
  readonly acknowledgedAtMs: number;
  readonly processorId: typeof PILOT_PROCESSOR_ID;
}

export interface CreateResult {
  readonly record: StoredMessage;
  readonly created: boolean;
}

export interface AcknowledgeResult {
  readonly record: StoredMessage;
  readonly transitioned: boolean;
}

export interface MessageRepository {
  createOrGet(candidate: StoredMessage): Promise<CreateResult>;
  get(messageId: string): Promise<StoredMessage | null>;
  getOrCreateReceiptSigningKey(createdAtMs: number): Promise<Uint8Array>;
  acknowledge(
    messageId: string,
    messageCommitment: string,
    acknowledgedAtMs: number,
    processingReceiptId: string,
    processingReceiptJson: string,
  ): Promise<AcknowledgeResult | null>;
}

export interface StoredMessageProcessor {
  process(record: StoredMessage, nowMs: number): Promise<void>;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('UNSUPPORTED_JSON');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function storedFromMessage(message: LogicalMessage, payloadSha256: string, storedAtMs: number): StoredMessage {
  return Object.freeze({
    messageId: message.messageId,
    messageCommitment: message.messageCommitment,
    zepVersion: message.zepVersion,
    conversationId: message.conversationId,
    senderId: message.senderId,
    recipientIds: Object.freeze([...message.recipientIds]),
    contentType: message.contentType,
    payload: message.payload,
    payloadSha256,
    priority: message.priority,
    receiptPolicy: message.receiptPolicy,
    extensionsJson: message.extensions === undefined ? null : canonicalJson(message.extensions),
    createdAtMs: message.createdAtMs,
    expiresAtMs: message.expiresAtMs,
    status: 'STORED',
    storedAtMs,
    acknowledgedAtMs: null,
    processingReceiptId: null,
    processingReceiptJson: null,
  });
}

export function sameImmutableMessage(left: StoredMessage, right: StoredMessage): boolean {
  return left.messageId === right.messageId
    && left.messageCommitment === right.messageCommitment
    && left.zepVersion === right.zepVersion
    && left.conversationId === right.conversationId
    && left.senderId === right.senderId
    && JSON.stringify(left.recipientIds) === JSON.stringify(right.recipientIds)
    && left.contentType === right.contentType
    && left.payloadSha256 === right.payloadSha256
    && left.payload.byteLength === right.payload.byteLength
    && left.payload.every((value, index) => value === right.payload[index])
    && left.priority === right.priority
    && left.receiptPolicy === right.receiptPolicy
    && left.extensionsJson === right.extensionsJson
    && left.createdAtMs === right.createdAtMs
    && left.expiresAtMs === right.expiresAtMs;
}

export function cloneStored(record: StoredMessage): StoredMessage {
  return Object.freeze({
    ...record,
    recipientIds: Object.freeze([...record.recipientIds]),
    payload: record.payload.slice(),
  });
}
