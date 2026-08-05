import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyExecutionReceipt, verifyExecutionReceiptBinding } from '../packages/security/src/receipts.js';
import { BASE_TIME, declareEnvelopeScope, makeEnvelope, withReceiver } from './helpers.js';

const acknowledgedEffect = (outcome: 'EFFECT_APPLIED' | 'NO_EFFECT' | 'REJECTED', at: number) => ({
  outcome,
  applicationAcknowledged: true,
  applicationReference: `erp:${outcome.toLowerCase()}`,
  workOrderStatus: outcome === 'EFFECT_APPLIED' ? 'CLOSED' : 'OPEN',
  result: { outcome },
  occurredAtMs: at,
} as const);

test('accept persists operation in real SQLite database', () => withReceiver(({ receiver }) => {
  const result = receiver.accept(makeEnvelope(), BASE_TIME + 1);
  assert.equal(result.duplicate, false);
  assert.equal(receiver.listOperationsPage().total, 1);
}));

test('duplicate delivery is deterministic and records duplicate evidence', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  const first = receiver.accept(envelope, BASE_TIME + 1);
  const second = receiver.accept(envelope, BASE_TIME + 2);
  assert.equal(second.duplicate, true);
  assert.equal(second.envelopeCommitment, first.envelopeCommitment);
  const detail = receiver.getOperation(envelope.operationId) as any;
  assert.ok(detail.evidence.some((item: any) => item.kind === 'DUPLICATE'));
}));

test('identity reuse with changed commitment fails closed', () => withReceiver(({ receiver }) => {
  receiver.accept(makeEnvelope(), BASE_TIME + 1);
  assert.throws(
    () => receiver.accept(makeEnvelope({ messageCommitment: 'sha256:other' }), BASE_TIME + 2),
    /DUPLICATE_CONFLICT/,
  );
}));

test('replay nonce across operations fails', () => withReceiver(({ receiver }) => {
  const first = makeEnvelope();
  receiver.accept(first, BASE_TIME + 1);
  const second = makeEnvelope({
    operationId: 'op_other',
    idempotencyKey: 'idem_other',
    replayNonce: first.replayNonce,
  });
  assert.throws(() => receiver.accept(second, BASE_TIME + 2), /REPLAY_DETECTED/);
}));

test('transactional claim issues increasing fencing token and rejects stale token', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  receiver.accept(envelope, BASE_TIME + 1);
  const first = receiver.claim(envelope.operationId, 'worker_a', BASE_TIME + 2, 1_000);
  const second = receiver.claim(envelope.operationId, 'worker_b', BASE_TIME + 2_000, 1_000);
  assert.ok(second.fencingToken > first.fencingToken);
  assert.throws(
    () => receiver.recordEffect(second.operationId, second.attemptId, first.fencingToken, acknowledgedEffect('EFFECT_APPLIED', BASE_TIME + 2_001)),
    /LEASE_LOST/,
  );
}));

test('transport acceptance without application acknowledgement remains unknown and unsigned', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  receiver.accept(envelope, BASE_TIME + 1);
  const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
  const result = receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, {
    outcome: 'EFFECT_APPLIED',
    applicationAcknowledged: false,
    applicationReference: 'timeout-after-apply',
    workOrderStatus: 'CLOSED_UNCONFIRMED',
    result: { transportAccepted: true },
    occurredAtMs: BASE_TIME + 3,
  });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.receipt, null);
  assert.equal(receiver.reconcile(envelope.operationId, 'reviewer', 'insufficient evidence', BASE_TIME + 4).verdict, 'UNKNOWN');
}));

test('application acknowledgement creates a receipt bound to operation and scope', () => withReceiver(({ receiver, provider }) => {
  const envelope = makeEnvelope();
  receiver.accept(envelope, BASE_TIME + 1);
  const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
  const result = receiver.recordEffect(
    envelope.operationId,
    claim.attemptId,
    claim.fencingToken,
    acknowledgedEffect('EFFECT_APPLIED', BASE_TIME + 3),
  );
  assert.equal(result.state, 'COMPLETED');
  assert.ok(result.receipt);
  assert.equal(verifyExecutionReceipt(result.receipt!, provider, BASE_TIME + 4), true);
  assert.equal(verifyExecutionReceiptBinding(result.receipt!, provider, BASE_TIME + 4, {
    operationId: envelope.operationId,
    messageCommitment: envelope.messageCommitment,
    receiverId: 'receiver_test',
    scopeType: envelope.scopeType,
    scopeId: envelope.scopeId,
    replayNonce: envelope.replayNonce,
    allowedOutcomes: ['EFFECT_APPLIED'],
  }), true);
  assert.equal(verifyExecutionReceiptBinding(result.receipt!, provider, BASE_TIME + 4, {
    operationId: 'op_wrong',
    messageCommitment: envelope.messageCommitment,
    receiverId: 'receiver_test',
    scopeType: envelope.scopeType,
    scopeId: envelope.scopeId,
    replayNonce: envelope.replayNonce,
  }), false);
}));

test('reconciliation review never writes application acknowledgement and is idempotent without facts', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  receiver.accept(envelope, BASE_TIME + 1);
  const first = receiver.reconcile(envelope.operationId, 'reviewer', 'review', BASE_TIME + 2);
  const second = receiver.reconcile(envelope.operationId, 'reviewer', 'repeat', BASE_TIME + 3);
  assert.equal(second.proofHash, first.proofHash);
  const detail = receiver.getOperation(envelope.operationId) as any;
  assert.equal(detail.reviews.length, 1);
  assert.equal(detail.evidence.some((item: any) => item.source === 'RECONCILER' && item.kind === 'APPLICATION_ACK'), false);
  assert.equal(detail.evidence.some((item: any) => item.kind === 'RECONCILIATION_REVIEW'), true);
}));

test('manual resolution cannot elevate unknown beyond current evidence', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  receiver.accept(envelope, BASE_TIME + 1);
  const proof = receiver.reconcile(envelope.operationId, 'reviewer', 'initial', BASE_TIME + 2);
  assert.throws(() => receiver.manualResolve(envelope.operationId, 'reviewer', {
    targetVerdict: 'EFFECT_CONFIRMED',
    rationale: 'operator believes it probably happened',
    referencedFactIds: proof.evidenceFactIds,
    previousProofHash: proof.proofHash,
    nowMs: BASE_TIME + 3,
  }), /UNSUPPORTED_BY_EVIDENCE/);
  const resolution = receiver.manualResolve(envelope.operationId, 'reviewer', {
    targetVerdict: 'UNKNOWN',
    rationale: 'retain ambiguity pending application evidence',
    referencedFactIds: proof.evidenceFactIds,
    previousProofHash: proof.proofHash,
    nowMs: BASE_TIME + 4,
  });
  assert.equal(resolution.targetVerdict, 'UNKNOWN');
}));

test('declared scope reports silent devices and missing operations', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  receiver.declareScope({
    scopeType: envelope.scopeType,
    scopeId: envelope.scopeId,
    declarationVersion: 1,
    expectedReportingDeviceIds: ['device_17', 'silent_device'],
    expectedOperationIds: [envelope.operationId, 'op_missing'],
    expectedOperationCount: 2,
    declaredAtMs: BASE_TIME - 1,
    provenance: 'dispatch-manifest:v1',
    previousManifestHash: null,
  }, 'admin');
  receiver.accept(envelope, BASE_TIME + 1);
  const certificate = receiver.completeness(envelope.scopeType, envelope.scopeId, BASE_TIME + 2);
  assert.equal(certificate.completeWithinDeclaredScope, false);
  assert.deepEqual(certificate.missingReportingDeviceIds, ['silent_device']);
  assert.deepEqual(certificate.missingOperationIds, ['op_missing']);
}));

test('bounded completeness becomes true only after declared terminal proof', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  declareEnvelopeScope(receiver, envelope);
  receiver.accept(envelope, BASE_TIME + 1);
  const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
  receiver.recordEffect(
    envelope.operationId,
    claim.attemptId,
    claim.fencingToken,
    acknowledgedEffect('NO_EFFECT', BASE_TIME + 3),
  );
  const certificate = receiver.completeness(envelope.scopeType, envelope.scopeId, BASE_TIME + 4);
  assert.equal(certificate.completeWithinDeclaredScope, true);
  assert.equal(certificate.terminalOperations, 1);
}));

test('backend-driven pagination returns global total and next offset', () => withReceiver(({ receiver }) => {
  for (let index = 1; index <= 3; index += 1) {
    receiver.accept(makeEnvelope({
      operationId: `op_page_${index}`,
      idempotencyKey: `idem_page_${index}`,
      messageId: `msg_page_${index}`,
      replayNonce: `nonce_page_${index}`,
      workOrderId: `WO-PAGE-${index}`,
    }), BASE_TIME + index);
  }
  const first = receiver.listOperationsPage({ limit: 2, offset: 0 });
  assert.equal(first.total, 3);
  assert.equal(first.items.length, 2);
  assert.equal(first.nextOffset, 2);
  const second = receiver.listOperationsPage({ limit: 2, offset: first.nextOffset! });
  assert.equal(second.total, 3);
  assert.equal(second.items.length, 1);
  assert.equal(second.nextOffset, null);
}));
