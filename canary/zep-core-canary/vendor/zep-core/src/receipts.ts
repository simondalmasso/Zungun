import { fail } from './errors.js';
import { assertValidatedMessage } from './message.js';
import {
  requireBoolean,
  requireEnum,
  requireEpochMs,
  requireOpaqueId,
  requireOptionalOpaqueId,
  snapshotExactRecord,
} from './validation.js';
import type {
  LogicalMessage,
  Receipt,
  ReceiptKind,
  ReceiptVerifier,
  VerifiedEndRecipientReceipt,
} from './types.js';

const RECEIPT_KINDS: readonly ReceiptKind[] = [
  'TRANSPORT_ACCEPTED',
  'NEXT_HOP_STORED',
  'END_RECIPIENT_ACKNOWLEDGED',
];

const verifiedReceiptObjects = new WeakSet<object>();
const verifiedReceiptMessages = new WeakMap<object, LogicalMessage>();

export function validateReceiptShape(receipt: Receipt): Receipt {
  let record: Record<string, unknown>;
  try {
    record = snapshotExactRecord(receipt, ['receiptId', 'messageId', 'messageCommitment', 'recipientId', 'receiptKind', 'observedAtMs', 'adapterId', 'externalReference', 'authenticated'], 'Receipt');
  } catch {
    fail('RECEIPT_INVALID', 'Receipt must be a supported plain data object');
  }
  const receiptId = requireOpaqueId(record.receiptId, 'receiptId');
  const messageId = requireOpaqueId(record.messageId, 'messageId');
  const messageCommitment = requireOpaqueId(record.messageCommitment, 'messageCommitment');
  const recipientId = requireOpaqueId(record.recipientId, 'recipientId');
  const receiptKind = requireEnum(record.receiptKind, 'receiptKind', RECEIPT_KINDS);
  const observedAtMs = requireEpochMs(record.observedAtMs, 'observedAtMs');
  const adapterId = requireOpaqueId(record.adapterId, 'adapterId');
  const externalReference = requireOptionalOpaqueId(record.externalReference, 'externalReference');
  const authenticated = requireBoolean(record.authenticated, 'authenticated');
  return Object.freeze({ receiptId, messageId, messageCommitment, recipientId, receiptKind, observedAtMs, adapterId, ...(externalReference === undefined ? {} : { externalReference }), authenticated });
}

export function validateReceipt(message: LogicalMessage, receipt: Receipt): Receipt {
  assertValidatedMessage(message);
  const validated = validateReceiptShape(receipt);
  if (!validated.authenticated) fail('AUTHENTICATION_FAILED', 'Receipt declares no authentication proof');
  if (
    validated.messageId !== message.messageId ||
    validated.messageCommitment !== message.messageCommitment ||
    !message.recipientIds.includes(validated.recipientId)
  ) fail('RECEIPT_INVALID', 'Receipt is not bound to this logical delivery');
  if (validated.observedAtMs < message.createdAtMs) fail('RECEIPT_INVALID', 'Receipt cannot predate message creation');
  if (validated.observedAtMs >= message.expiresAtMs) fail('EXPIRED', 'Receipt must be observed strictly before message expiration');
  return validated;
}

export function verifyEndRecipientReceipt(
  message: LogicalMessage,
  receipt: Receipt,
  verifier: ReceiptVerifier,
): VerifiedEndRecipientReceipt {
  let verify: ReceiptVerifier['verify'];
  try {
    verify = typeof verifier === 'object' && verifier !== null ? verifier.verify : undefined as never;
  } catch {
    fail('AUTHENTICATION_FAILED', 'ReceiptVerifier cannot be inspected safely');
  }
  if (typeof verify !== 'function') fail('AUTHENTICATION_FAILED', 'A ReceiptVerifier is required');
  const validated = validateReceipt(message, receipt);
  if (validated.receiptKind !== 'END_RECIPIENT_ACKNOWLEDGED') fail('RECEIPT_INVALID', 'Only an end-recipient receipt can acknowledge delivery');
  let accepted = false;
  try {
    accepted = verify.call(verifier, message, validated) === true;
  } catch {
    fail('AUTHENTICATION_FAILED', 'Receipt verifier failed');
  }
  if (!accepted) fail('AUTHENTICATION_FAILED', 'Receipt verifier rejected the authentication proof');
  const verified: VerifiedEndRecipientReceipt = Object.freeze({ receipt: validated });
  verifiedReceiptObjects.add(verified as object);
  verifiedReceiptMessages.set(verified as object, message);
  return verified;
}

export function assertVerifiedEndRecipientReceipt(
  value: VerifiedEndRecipientReceipt,
  expectedMessage?: LogicalMessage,
): Receipt {
  if (typeof value !== 'object' || value === null || !verifiedReceiptObjects.has(value as object)) {
    fail('RECEIPT_INVALID', 'Verified receipt token is missing or forged');
  }
  if (expectedMessage !== undefined) {
    assertValidatedMessage(expectedMessage);
    if (verifiedReceiptMessages.get(value as object) !== expectedMessage) {
      fail('RECEIPT_INVALID', 'Verified receipt token belongs to another LogicalMessage instance');
    }
  }
  return value.receipt;
}

export function provesEndRecipientAcknowledgement(
  message: LogicalMessage,
  receipt: Receipt,
  verifier: ReceiptVerifier,
): boolean {
  verifyEndRecipientReceipt(message, receipt, verifier);
  return true;
}
