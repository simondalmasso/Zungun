// PROVENANCE: RECONSTRUCTED_FROM_ORDER; WO-2841 adapted to the exact historical oracle.
import {
  DeliveryStateMachine,
  validateMessage,
  verifyEndRecipientReceipt,
  type LogicalMessageInput,
} from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';
import { buildExecutionProof } from './execution-proof.js';
import { computeMessageCommitment } from './message.js';
import { createDemoReceiptVerifier, verifyDemoReceiptReferenceIntegrity } from './receipts.js';
import { ReferenceReceiver } from './reference-receiver.js';
import type { ExecutionEvidence, ExecutionProof } from './types.js';

const T0 = 1_800_000_000_000;

export function createWo2841Message() {
  const withoutCommitment: Omit<LogicalMessageInput, 'messageCommitment'> = {
    zepVersion: '0.1',
    messageId: 'MSG-DEMO-WO-2841-001',
    conversationId: 'CASE-DEMO-2841',
    senderId: 'DEV-DEMO-017',
    recipientIds: ['BACKEND-DEMO-001'],
    createdAtMs: T0,
    expiresAtMs: T0 + 86_400_000,
    priority: 3,
    contentType: 'application/vnd.zungun.work-order+json',
    payload: new TextEncoder().encode(JSON.stringify({ workOrderId: 'WO-2841', action: 'CLOSE', technicianId: 'FIELD-017' })),
    receiptPolicy: 'END_RECIPIENT_ACK',
    extensions: {
      dataClassification: 'FICTIONAL_DEMO_ONLY',
      operationId: 'OP-DEMO-WO-2841-001',
    },
  };
  return validateMessage({ ...withoutCommitment, messageCommitment: computeMessageCommitment(withoutCommitment) }, T0);
}

export function runWo2841Demo(): ExecutionProof {
  const message = createWo2841Message();
  const machine = new DeliveryStateMachine(message);
  machine.transition('ELIGIBLE', { atMs: T0 + 1_000, reasonCode: 'CONNECTIVITY_AVAILABLE' });
  machine.transition('SENDING', { atMs: T0 + 2_000, attemptId: 'ATTEMPT_1', adapterId: 'REFERENCE_RECEIVER' });
  const receiver = new ReferenceReceiver();
  const first = receiver.apply('OP-DEMO-WO-2841-001', message, T0 + 3_000);
  machine.transition('UNKNOWN', { atMs: T0 + 4_000, reasonCode: 'RESPONSE_LOST', evidenceReference: 'EV-004' });
  const status = receiver.status('OP-DEMO-WO-2841-001');
  if (status === null) throw new Error('reference status missing');
  verifyDemoReceiptReferenceIntegrity(message, status.receiptReference);
  const verifiedToken = verifyEndRecipientReceipt(
    message,
    status.receiptReference.receipt,
    createDemoReceiptVerifier(status.receiptReference),
  );
  machine.recordVerifiedRecipientAcknowledgement(verifiedToken);
  machine.transition('ACKNOWLEDGED', {
    atMs: T0 + 8_000,
    reasonCode: 'STATUS_QUERY_CONFIRMED',
    evidenceReference: status.receiptReference.receipt.receiptId,
  });
  if (receiver.effectCount() !== 1 || !first.effectApplied || machine.current() !== 'ACKNOWLEDGED') {
    throw new Error('reference effect invariant failed');
  }
  const evidence: ExecutionEvidence[] = [
    { sequence: 1, atMs: T0, source: 'DEVICE', kind: 'OPERATION_CAPTURED', detail: 'Work-order closure persisted with stable identity.', reference: 'EV-001' },
    { sequence: 2, atMs: T0 + 2_000, source: 'DEVICE', kind: 'SEND_ATTEMPT', detail: 'The device sent the critical operation.', reference: 'EV-002' },
    { sequence: 3, atMs: T0 + 3_000, source: 'BACKEND', kind: 'EFFECT_APPLIED', detail: 'Reference receiver applied the simulated effect once.', reference: 'EV-003' },
    { sequence: 4, atMs: T0 + 4_000, source: 'DEVICE', kind: 'UNKNOWN', detail: 'The response was lost; success or failure was not assumed.', reference: 'EV-004' },
    { sequence: 5, atMs: T0 + 5_000, source: 'ERP', kind: 'WORK_ORDER_CLOSED', detail: 'ERP projection shows WO-2841 closed.', reference: 'EV-005' },
    { sequence: 6, atMs: T0 + 6_000, source: 'RECEIVER', kind: 'STATUS_QUERY', detail: 'Receiver status was queried by stable operation identity.', reference: 'EV-006' },
    { sequence: 7, atMs: T0 + 7_000, source: 'RECEIVER', kind: 'APPLICATION_ACK', detail: 'Demo reference was authenticated only after explicit oracle verification.', reference: status.receiptReference.receipt.receiptId },
    { sequence: 8, atMs: T0 + 8_000, source: 'RECONCILER', kind: 'EFFECT_CONFIRMED', detail: 'Evidence converged; retry would risk duplication.', reference: 'CASE-DEMO-2841' },
  ];
  return buildExecutionProof(message, status.receiptReference, evidence);
}
