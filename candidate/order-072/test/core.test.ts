// PROVENANCE: RECONSTRUCTED_FROM_ORDER; extension regression tests use the exact historical oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_TRANSITIONS,
  DeliveryStateMachine,
  isExpired,
  verifyEndRecipientReceipt,
} from '../../../canary/zep-core-canary/vendor/zep-core/src/index.js';
import {
  ReferenceReceiver,
  chooseTransport,
  computeMessageCommitment,
  createDemoReceiptVerifier,
  createWo2841Message,
  verifyDemoReceiptReferenceIntegrity,
} from '../src/extensions/index.js';

const message = () => createWo2841Message();

for (let i = 0; i < 10; i += 1) test(`message commitment stable ${i}`, () => {
  const m = message();
  assert.equal(computeMessageCommitment({
    zepVersion: m.zepVersion,
    messageId: m.messageId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    recipientIds: [...m.recipientIds],
    createdAtMs: m.createdAtMs,
    expiresAtMs: m.expiresAtMs,
    priority: m.priority,
    contentType: m.contentType,
    payload: m.payload,
    receiptPolicy: m.receiptPolicy,
    ...(m.extensions === undefined ? {} : { extensions: m.extensions }),
  }), m.messageCommitment);
});

for (let i = 0; i < 10; i += 1) test(`state UNKNOWN preserves ambiguity ${i}`, () => {
  const m = message(); const sm = new DeliveryStateMachine(m);
  sm.transition('ELIGIBLE', { atMs: m.createdAtMs + 1 });
  sm.transition('SENDING', { atMs: m.createdAtMs + 2 });
  sm.transition('UNKNOWN', { atMs: m.createdAtMs + 3 });
  assert.equal(sm.current(), 'UNKNOWN');
  assert.deepEqual(ALLOWED_TRANSITIONS.UNKNOWN, ['ACKNOWLEDGED', 'ELIGIBLE', 'EXPIRED', 'FAILED']);
});

for (let i = 0; i < 5; i += 1) test(`reference receiver idempotent ${i}`, () => {
  const m = message(); const r = new ReferenceReceiver();
  const a = r.apply('OP-DEMO-WO-2841-001', m, m.createdAtMs + 10);
  const b = r.apply('OP-DEMO-WO-2841-001', m, m.createdAtMs + 11);
  assert.equal(a.effectApplied, true); assert.equal(b.duplicate, true); assert.equal(r.effectCount(), 1);
});

for (let i = 0; i < 5; i += 1) test(`demo receipt requires oracle verifier ${i}`, () => {
  const m = message(); const receiver = new ReferenceReceiver();
  const reference = receiver.apply('OP-DEMO-WO-2841-001', m, m.createdAtMs + 10).receiptReference;
  assert.equal(verifyDemoReceiptReferenceIntegrity(m, reference), reference);
  const token = verifyEndRecipientReceipt(m, reference.receipt, createDemoReceiptVerifier(reference));
  const machine = new DeliveryStateMachine(m);
  assert.equal(machine.recordVerifiedRecipientAcknowledgement(token).allAcknowledged, true);
});

for (let i = 0; i < 5; i += 1) test(`routing selects eligible historical transport ${i}`, () => {
  const m = message();
  const p = chooseTransport(m, [
    { id: 'metered', available: true, maxPayloadBytes: 48000, estimatedCompletionDurationMs: 2000, costClass: 'METERED', supportsApplicationAck: true },
    { id: 'low', available: true, maxPayloadBytes: 48000, estimatedCompletionDurationMs: 1000, costClass: 'LOW', supportsApplicationAck: true },
  ], m.createdAtMs + 1);
  assert.equal(p.id, 'low');
});

for (let i = 0; i < 5; i += 1) test(`expiry semantics ${i}`, () => {
  const m = message();
  assert.equal(isExpired(m.expiresAtMs, m.expiresAtMs - 1), false);
  assert.equal(isExpired(m.expiresAtMs, m.expiresAtMs), true);
});
