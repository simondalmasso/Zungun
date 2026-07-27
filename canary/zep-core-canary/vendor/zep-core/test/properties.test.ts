import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_TRANSITIONS,
  DELIVERY_STATES,
  DeliveryStateMachine,
  applySendResult,
  InMemoryMessageStore,
  ZepError,
  reassembleFragments,
  selectRoute,
  validateMessage,
  verifyEndRecipientReceipt,
  type DeliveryState,
  type Fragment,
  type LogicalMessage,
  type Receipt,
} from '../src/index.js';
import { capability, message, routeRequirements, testReceiptVerifier } from './helpers.js';

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof ZepError && error.code === code);
}


function receiptFor(messageValue: LogicalMessage, recipientId: string, atMs: number, receiptId: string): Receipt {
  return {
    receiptId,
    messageId: messageValue.messageId,
    messageCommitment: messageValue.messageCommitment,
    recipientId,
    receiptKind: 'END_RECIPIENT_ACKNOWLEDGED',
    observedAtMs: atMs,
    adapterId: 'A',
    authenticated: true,
  };
}

function recordVerifiedAck(machine: DeliveryStateMachine, messageValue: LogicalMessage, recipientId: string, atMs: number, receiptId: string): { newlyAcknowledged: boolean; allAcknowledged: boolean } {
  return machine.recordVerifiedRecipientAcknowledgement(
    verifyEndRecipientReceipt(messageValue, receiptFor(messageValue, recipientId, atMs, receiptId), testReceiptVerifier),
  );
}

function reach(machine: DeliveryStateMachine, messageValue: LogicalMessage, target: DeliveryState): void {
  const paths: Record<DeliveryState, DeliveryState[]> = {
    QUEUED: [],
    ELIGIBLE: ['ELIGIBLE'],
    SENDING: ['ELIGIBLE', 'SENDING'],
    ACCEPTED: ['ELIGIBLE', 'SENDING', 'ACCEPTED'],
    TEMPORARILY_UNAVAILABLE: ['ELIGIBLE', 'TEMPORARILY_UNAVAILABLE'],
    UNKNOWN: ['ELIGIBLE', 'SENDING', 'UNKNOWN'],
    ACKNOWLEDGED: ['ELIGIBLE', 'SENDING', 'ACKNOWLEDGED'],
    PERMANENTLY_REJECTED: ['ELIGIBLE', 'PERMANENTLY_REJECTED'],
    EXPIRED: ['EXPIRED'],
    FAILED: ['FAILED'],
  };
  let atMs = 1;
  for (const step of paths[target]) {
    if (step === 'ACKNOWLEDGED') recordVerifiedAck(machine, messageValue, 'recipient-1', atMs, 'R');
    machine.transition(step, { atMs: atMs++ });
  }
}

test('property: every declared transition is accepted and every undeclared transition is rejected', () => {
  for (const from of DELIVERY_STATES) {
    for (const to of DELIVERY_STATES) {
      const messageValue = validateMessage(message({ messageId: `m-${from}-${to}`, createdAtMs: 0, expiresAtMs: 1_000_000 }), 0);
      const machine = new DeliveryStateMachine(messageValue);
      reach(machine, messageValue, from);
      const allowed = ALLOWED_TRANSITIONS[from].includes(to);
      if (to === 'ACKNOWLEDGED' && allowed) recordVerifiedAck(machine, messageValue, 'recipient-1', 99, `R-${from}`);
      if (allowed) assert.doesNotThrow(() => machine.transition(to, { atMs: 100 }));
      else expectCode(() => machine.transition(to, { atMs: 100 }), 'INVALID_STATE_TRANSITION');
    }
  }
});

test('property: arbitrary contiguous fragment partitions reassemble exactly', () => {
  for (let length = 1; length <= 128; length++) {
    const payload = Uint8Array.from({ length }, (_, i) => (i * 31 + length) % 256);
    for (let parts = 1; parts <= Math.min(10, length); parts++) {
      const fragments: Fragment[] = [];
      let offset = 0;
      for (let index = 0; index < parts; index++) {
        const remaining = length - offset;
        const slots = parts - index;
        const size = Math.ceil(remaining / slots);
        fragments.push({
          messageId: `m-${length}-${parts}`,
          messageCommitment: `c-${length}-${parts}`,
          fragmentIndex: index,
          fragmentCount: parts,
          byteOffset: offset,
          fragmentPayload: payload.slice(offset, offset + size),
          authenticated: true,
          expiresAtMs: 10_000,
        });
        offset += size;
      }
      const shuffled = [...fragments].sort((a, b) => (a.fragmentIndex * 17 % parts) - (b.fragmentIndex * 17 % parts));
      assert.deepEqual(reassembleFragments(shuffled, 1), payload);
    }
  }
});

test('property: deduplication never overwrites commitment or payload', () => {
  for (let i = 0; i < 500; i++) {
    const store = new InMemoryMessageStore();
    const first = validateMessage(message({ messageId: `m-${i}`, messageCommitment: `c-${i}`, payload: Uint8Array.of(i % 256) }), 2000);
    store.observe(first, 'first');
    store.observe(first, 'duplicate');
    expectCode(() => store.observe(validateMessage(message({ messageId: `m-${i}`, messageCommitment: `other-${i}`, payload: Uint8Array.of((i + 1) % 256) }), 2000), 'conflict'), 'DUPLICATE_CONFLICT');
    assert.equal(store.get(`m-${i}`)?.message.messageCommitment, `c-${i}`);
    assert.deepEqual(store.get(`m-${i}`)?.message.payload, Uint8Array.of(i % 256));
  }
});

test('property: route tie-breaking is deterministic by adapterId', () => {
  const p = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;
  const m = validateMessage(message(), 2000);
  for (let i = 0; i < 100; i++) {
    const routes = [capability({ adapterId: 'B' }), capability({ adapterId: 'A' })];
    if (i % 2) routes.reverse();
    assert.equal(selectRoute(m, routeRequirements(), routes, p, 2000).adapterId, 'A');
  }
});

test('property: all recipients are required regardless of acknowledgement order', () => {
  const recipients = ['r1', 'r2', 'r3', 'r4'];
  for (let rotation = 0; rotation < recipients.length; rotation++) {
    const order = [...recipients.slice(rotation), ...recipients.slice(0, rotation)];
    const messageValue = validateMessage(message({ messageId: `m-ack-${rotation}`, recipientIds: recipients, createdAtMs: 0, expiresAtMs: 10000 }), 0);
    const machine = new DeliveryStateMachine(messageValue);
    order.forEach((recipientId, index) => {
      const result = recordVerifiedAck(machine, messageValue, recipientId, 100 + index, `R-${recipientId}`);
      assert.equal(result.allAcknowledged, index === order.length - 1);
    });
    assert.deepEqual(machine.pendingRecipientIds(), []);
  }
});

test('property: no strict-boolean bypass can alter permanent rejection semantics', () => {
  const truthyNonBooleans: unknown[] = ['yes', 1, -1, [], {}, new Boolean(true), 'false'];
  for (const candidate of truthyNonBooleans) {
    const messageValue = validateMessage(message(), 1000);
    const machine = new DeliveryStateMachine(messageValue);
    machine.transition('ELIGIBLE', { atMs: 1100 });
    assert.throws(() => applySendResult(machine, messageValue, { kind: 'permanentlyRejected', reasonCode: 'NO' }, {
      atMs: 1200,
      attemptId: 'property-truthy',
      capability: capability(),
      alternativeEligibleRouteExists: candidate as never,
    }), (error: unknown) => error instanceof ZepError && error.code === 'CORRUPT_RECORD');
    assert.equal(machine.current(), 'ELIGIBLE');
  }
});

