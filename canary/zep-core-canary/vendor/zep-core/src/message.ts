import { fail } from './errors.js';
import { isExpired, validateEpochMs } from './time.js';
import { normalizeExtensions, requireOpaqueId, requireUint8Array, snapshotExactRecord } from './validation.js';
import type { LogicalMessage, LogicalMessageInput, ReceiptPolicy } from './types.js';

const validatedMessages = new WeakSet<object>();

interface NormalizedMessageInput {
  readonly zepVersion: '0.1';
  readonly messageId: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly recipientIds: readonly string[];
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly priority: 0 | 1 | 2 | 3;
  readonly contentType: string;
  readonly payload: Uint8Array;
  readonly receiptPolicy: ReceiptPolicy;
  readonly messageCommitment: string;
  readonly extensions?: LogicalMessageInput['extensions'];
}

function makeValidatedMessage(message: NormalizedMessageInput): LogicalMessage {
  const payloadSnapshot = message.payload.slice();
  const recipientIds = Object.freeze([...message.recipientIds]);
  const extensions = normalizeExtensions(message.extensions);

  const target: Record<string, unknown> = {
    zepVersion: message.zepVersion,
    messageId: message.messageId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    recipientIds,
    createdAtMs: message.createdAtMs,
    expiresAtMs: message.expiresAtMs,
    priority: message.priority,
    contentType: message.contentType,
    receiptPolicy: message.receiptPolicy,
    messageCommitment: message.messageCommitment,
  };
  Object.defineProperty(target, 'payload', {
    enumerable: true,
    configurable: false,
    get: () => payloadSnapshot.slice(),
  });
  if (extensions !== undefined) {
    Object.defineProperty(target, 'extensions', {
      enumerable: true,
      configurable: false,
      writable: false,
      value: extensions,
    });
  }
  const validated = Object.freeze(target) as unknown as LogicalMessage;
  validatedMessages.add(validated);
  return validated;
}

export function isValidatedMessage(message: unknown): message is LogicalMessage {
  return typeof message === 'object' && message !== null && validatedMessages.has(message);
}

export function assertValidatedMessage(message: LogicalMessage): void {
  if (!isValidatedMessage(message)) fail('CORRUPT_RECORD', 'LogicalMessage must come from validateMessage');
}

export function validateMessage(message: LogicalMessageInput | LogicalMessage, nowMs: number): LogicalMessage {
  validateEpochMs(nowMs, 'nowMs');
  if (isValidatedMessage(message)) {
    if (isExpired(message.expiresAtMs, nowMs)) fail('EXPIRED', 'Message is expired');
    return message;
  }
  const record = snapshotExactRecord(message, [
    'zepVersion', 'messageId', 'conversationId', 'senderId', 'recipientIds', 'createdAtMs',
    'expiresAtMs', 'priority', 'contentType', 'payload', 'receiptPolicy', 'messageCommitment', 'extensions',
  ], 'LogicalMessageInput');
  if (record.zepVersion !== '0.1') fail('INVALID_VERSION', 'Only ZEP 0.1 is supported');
  const messageId = requireOpaqueId(record.messageId, 'messageId');
  const conversationId = requireOpaqueId(record.conversationId, 'conversationId');
  const senderId = requireOpaqueId(record.senderId, 'senderId');
  const messageCommitment = requireOpaqueId(record.messageCommitment, 'messageCommitment');
  if (!Array.isArray(record.recipientIds) || record.recipientIds.length === 0) {
    fail('INVALID_IDENTIFIER', 'At least one recipient is required');
  }
  let recipientValues: unknown[];
  try {
    recipientValues = Array.from(record.recipientIds as readonly unknown[]);
  } catch {
    fail('CORRUPT_RECORD', 'recipientIds cannot be inspected safely');
  }
  const seenRecipients = new Set<string>();
  const recipientIds: string[] = [];
  for (const recipient of recipientValues) {
    const normalized = requireOpaqueId(recipient, 'recipientId');
    if (seenRecipients.has(normalized)) fail('INVALID_IDENTIFIER', 'recipientIds must be unique');
    seenRecipients.add(normalized);
    recipientIds.push(normalized);
  }
  const createdAtMs = validateEpochMs(record.createdAtMs as number, 'createdAtMs');
  const expiresAtMs = validateEpochMs(record.expiresAtMs as number, 'expiresAtMs');
  if (expiresAtMs <= createdAtMs) fail('INVALID_TIMESTAMP', 'expiresAtMs must be greater than createdAtMs');
  if (![0, 1, 2, 3].includes(record.priority as number)) fail('INVALID_PRIORITY', 'Priority must be 0..3');
  const priority = record.priority as 0 | 1 | 2 | 3;
  if (typeof record.contentType !== 'string' || record.contentType.length < 1 || record.contentType.length > 128) {
    fail('UNSUPPORTED_CONTENT_TYPE', 'Invalid content type');
  }
  const contentType = record.contentType;
  const payload = requireUint8Array(record.payload, 'payload').slice();
  if (record.receiptPolicy !== 'END_RECIPIENT_ACK') {
    fail('UNSUPPORTED_RECEIPT_POLICY', 'ZEP 0.1 requires END_RECIPIENT_ACK');
  }
  const receiptPolicy = record.receiptPolicy;
  const extensions = normalizeExtensions(record.extensions);
  if (isExpired(expiresAtMs, nowMs)) fail('EXPIRED', 'Message is expired');
  return makeValidatedMessage({ zepVersion: '0.1', messageId, conversationId, senderId, recipientIds, createdAtMs, expiresAtMs, priority, contentType, payload, receiptPolicy, messageCommitment, ...(extensions === undefined ? {} : { extensions }) });
}

export interface MessageObservation {
  readonly message: LogicalMessage;
  readonly evidenceReferences: readonly string[];
}

export class InMemoryMessageStore {
  private readonly messages = new Map<string, MessageObservation>();

  observe(message: LogicalMessage, evidenceReference: string): { inserted: boolean; observation: MessageObservation } {
    assertValidatedMessage(message);
    const normalizedEvidenceReference = requireOpaqueId(evidenceReference, 'evidenceReference');
    const existing = this.messages.get(message.messageId);
    if (!existing) {
      const observation = Object.freeze({ message, evidenceReferences: Object.freeze([normalizedEvidenceReference]) });
      this.messages.set(message.messageId, observation);
      return { inserted: true, observation };
    }
    if (existing.message.messageCommitment !== message.messageCommitment) {
      fail('DUPLICATE_CONFLICT', 'Same messageId observed with a different commitment');
    }
    const observation = Object.freeze({
      message: existing.message,
      evidenceReferences: Object.freeze([...existing.evidenceReferences, normalizedEvidenceReference]),
    });
    this.messages.set(message.messageId, observation);
    return { inserted: false, observation };
  }

  count(): number { return this.messages.size; }
  get(messageId: string): MessageObservation | undefined {
    const normalizedMessageId = requireOpaqueId(messageId, 'messageId');
    return this.messages.get(normalizedMessageId);
  }
}
