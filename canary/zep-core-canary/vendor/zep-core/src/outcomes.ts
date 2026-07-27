import { fail } from './errors.js';
import { validateSendResult, validateTransportCapabilities } from './adapters.js';
import { verifyEndRecipientReceipt } from './receipts.js';
import { requireBoolean, requireEpochMs, requireOpaqueId, snapshotExactRecord } from './validation.js';
import type { LogicalMessage, ReceiptVerifier, SendResult, TransportCapabilities } from './types.js';
import { DeliveryStateMachine } from './state-machine.js';


function requireStateMachine(value: unknown): DeliveryStateMachine {
  let valid = false;
  try { valid = value instanceof DeliveryStateMachine; }
  catch { fail('CORRUPT_RECORD', 'DeliveryStateMachine cannot be inspected safely'); }
  if (!valid) fail('CORRUPT_RECORD', 'DeliveryStateMachine instance is required');
  return value as DeliveryStateMachine;
}

function validateReceiptVerifier(value: unknown): ReceiptVerifier | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) fail('AUTHENTICATION_FAILED', 'ReceiptVerifier must be an object');
  let verify: unknown;
  try {
    verify = (value as Record<string, unknown>).verify;
  } catch {
    fail('AUTHENTICATION_FAILED', 'ReceiptVerifier cannot be inspected safely');
  }
  if (typeof verify !== 'function') fail('AUTHENTICATION_FAILED', 'ReceiptVerifier.verify must be a function');
  return value as ReceiptVerifier;
}

export interface OutcomeContext {
  readonly atMs: number;
  readonly attemptId: string;
  readonly capability: TransportCapabilities;
  readonly alternativeEligibleRouteExists: boolean;
  readonly receiptVerifier?: ReceiptVerifier;
}

export function applySendResult(
  machine: DeliveryStateMachine,
  message: LogicalMessage,
  rawResult: SendResult,
  context: OutcomeContext,
): void {
  const validatedMachine = requireStateMachine(machine);
  validatedMachine.assertBoundMessage(message);
  const contextRecord = snapshotExactRecord(
    context,
    ['atMs', 'attemptId', 'capability', 'alternativeEligibleRouteExists', 'receiptVerifier'],
    'OutcomeContext',
  );
  const atMs = requireEpochMs(contextRecord.atMs, 'atMs');
  const attemptId = requireOpaqueId(contextRecord.attemptId, 'attemptId');
  const alternativeEligibleRouteExists = requireBoolean(contextRecord.alternativeEligibleRouteExists, 'alternativeEligibleRouteExists');
  const capability = validateTransportCapabilities(contextRecord.capability as never);
  const receiptVerifier = validateReceiptVerifier(contextRecord.receiptVerifier);
  const result = validateSendResult(rawResult);
  const base = { atMs, attemptId, adapterId: capability.adapterId };
  switch (result.kind) {
    case 'accepted':
      if (result.acceptedAtMs > atMs) fail('INVALID_TIMESTAMP', 'acceptedAtMs cannot be later than observation time');
      validatedMachine.transition('ACCEPTED', { ...base, evidenceReference: result.externalReference ?? null });
      return;
    case 'temporarilyUnavailable':
      validatedMachine.transition('TEMPORARILY_UNAVAILABLE', { ...base, reasonCode: result.reasonCode });
      return;
    case 'permanentlyRejected':
      if (alternativeEligibleRouteExists) {
        validatedMachine.transition('ELIGIBLE', { ...base, reasonCode: result.reasonCode });
      } else {
        validatedMachine.transition('PERMANENTLY_REJECTED', { ...base, reasonCode: result.reasonCode });
      }
      return;
    case 'acknowledged': {
      if (!capability.supportsEndRecipientReceipt) fail('CAPABILITY_MISMATCH', 'Transport does not support end-recipient receipts');
      if (!receiptVerifier) fail('AUTHENTICATION_FAILED', 'Acknowledged outcomes require a ReceiptVerifier');
      const verified = verifyEndRecipientReceipt(message, result.receipt, receiptVerifier);
      if (verified.receipt.observedAtMs > atMs) fail('INVALID_TIMESTAMP', 'Receipt observation cannot be later than outcome observation');
      const acknowledgement = validatedMachine.recordVerifiedRecipientAcknowledgement(verified);
      if (acknowledgement.allAcknowledged) {
        validatedMachine.transition('ACKNOWLEDGED', { ...base, evidenceReference: verified.receipt.receiptId });
      } else if (validatedMachine.current() === 'SENDING') {
        validatedMachine.transition('ACCEPTED', { ...base, reasonCode: 'PARTIAL_RECIPIENT_ACK', evidenceReference: verified.receipt.receiptId });
      }
      return;
    }
    case 'unknown':
      validatedMachine.transition('UNKNOWN', { ...base, reasonCode: result.reasonCode, evidenceReference: result.externalReference ?? null });
  }
}

export function resolveAcceptedTimeout(machine: DeliveryStateMachine, atMs: number, reasonCode = 'END_RECIPIENT_RECEIPT_TIMEOUT'): void {
  requireStateMachine(machine).transition('UNKNOWN', { atMs, reasonCode });
}

export function authorizeUnknownRetry(capability: TransportCapabilities, acceptsDuplicationRisk: boolean): void {
  const validated = validateTransportCapabilities(capability);
  const acceptedRisk = requireBoolean(acceptsDuplicationRisk, 'acceptsDuplicationRisk');
  if (!validated.duplicateSafe && !acceptedRisk) {
    fail('OUTCOME_UNKNOWN', 'Retry requires duplicate-safe transport or explicit duplication-risk policy');
  }
}
