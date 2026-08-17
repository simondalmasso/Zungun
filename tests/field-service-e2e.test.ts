import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyExecutionReceipt } from '../packages/security/src/receipts.js';
import { BASE_TIME, declareEnvelopeScope, makeEnvelope, withReceiver } from './helpers.js';

test('field-service completion reaches verified bounded proof through durable receiver', () => withReceiver(({ receiver, provider }) => {
  const envelope = makeEnvelope();
  declareEnvelopeScope(receiver, envelope);
  const persisted = JSON.stringify(envelope);
  const recovered = JSON.parse(persisted);
  const accepted = receiver.accept(recovered, BASE_TIME + 10);
  assert.equal(accepted.state, 'RECEIVER_ACCEPTED');
  const claim = receiver.claim(envelope.operationId, 'field-worker', BASE_TIME + 20, 10_000);
  const completed = receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, {
    outcome: 'EFFECT_APPLIED',
    applicationAcknowledged: true,
    applicationReference: 'erp_work_order_2841_v3',
    workOrderStatus: 'CLOSED',
    result: { closed: true, revision: 3 },
    occurredAtMs: BASE_TIME + 30,
  });
  assert.ok(completed.receipt && verifyExecutionReceipt(completed.receipt, provider, BASE_TIME + 31));
  const duplicate = receiver.accept(recovered, BASE_TIME + 40);
  assert.equal(duplicate.duplicate, true);
  assert.ok(duplicate.receipt);
  const proof = receiver.reconcile(envelope.operationId, 'auditor', 'cross-system evidence complete', BASE_TIME + 50);
  assert.equal(proof.verdict, 'EFFECT_CONFIRMED');
  const certificate = receiver.completeness('SHIFT', 'shift_2026_08_05', BASE_TIME + 60);
  assert.equal(certificate.completeWithinDeclaredScope, true);
}));

test('ack loss preserves explicit unknown until qualifying evidence arrives', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  receiver.accept(envelope, BASE_TIME + 1);
  const claim = receiver.claim(envelope.operationId, 'worker', BASE_TIME + 2, 1_000);
  const result = receiver.recordEffect(envelope.operationId, claim.attemptId, claim.fencingToken, {
    outcome: 'UNKNOWN',
    applicationAcknowledged: false,
    applicationReference: 'ack_timeout',
    workOrderStatus: 'UNKNOWN',
    result: { transportAccepted: true },
    occurredAtMs: BASE_TIME + 3,
  });
  assert.equal(result.receipt, null);
  assert.equal(receiver.reconcile(envelope.operationId, 'auditor', 'insufficient evidence', BASE_TIME + 4).verdict, 'UNKNOWN');
}));

test('bounded completeness reports declared but unreported device', () => withReceiver(({ receiver }) => {
  const envelope = makeEnvelope();
  receiver.declareScope({
    scopeType: envelope.scopeType,
    scopeId: envelope.scopeId,
    declarationVersion: 1,
    expectedReportingDeviceIds: ['device_17', 'device_silent'],
    expectedOperationIds: [envelope.operationId],
    expectedOperationCount: 1,
    declaredAtMs: BASE_TIME - 1,
    provenance: 'dispatch:field-service',
    previousManifestHash: null,
  }, 'admin');
  receiver.accept(envelope, BASE_TIME + 1);
  const certificate = receiver.completeness(envelope.scopeType, envelope.scopeId, BASE_TIME + 2);
  assert.deepEqual(certificate.missingReportingDeviceIds, ['device_silent']);
  assert.equal(certificate.schema, 'zungun.completeness.v2');
  assert.equal(certificate.completeWithinDeclaredScope, false);
}));
