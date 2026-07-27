import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DeliveryStateMachine,
  InMemoryMessageStore,
  ZepError,
  applySendResult,
  authorizeUnknownRetry,
  effectiveNow,
  reassembleFragments,
  resolveAcceptedTimeout,
  selectRoute,
  validateMessage,
  validateReceipt,
  type Fragment,
  type LogicalMessage,
  type Receipt,
} from '../src/index.js';
import { capability, message, routeRequirements, testReceiptVerifier } from './helpers.js';

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof ZepError && error.code === code);
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    receiptId: 'receipt-1',
    messageId: '00000000000000000000000000000001',
    messageCommitment: 'mc:test:0001',
    recipientId: 'recipient-1',
    receiptKind: 'END_RECIPIENT_ACKNOWLEDGED',
    observedAtMs: 3000,
    adapterId: 'BLE_DIRECT',
    authenticated: true,
    ...overrides,
  };
}

function machineFor(m: LogicalMessage): DeliveryStateMachine {
  return new DeliveryStateMachine(m);
}

const policy = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;

test('ZEP-SEM-001 valid minimal message', () => {
  const validated = validateMessage(message(), 2000);
  const machine = machineFor(validated);
  assert.equal(machine.current(), 'QUEUED');
  machine.transition('ELIGIBLE', { atMs: 2000 });
  assert.equal(machine.current(), 'ELIGIBLE');
});

test('ZEP-SEM-002 expiration is terminal', () => {
  const m = validateMessage(message(), 2000);
  const machine = machineFor(m);
  assert.equal(machine.current(61000), 'EXPIRED');
  expectCode(() => machine.transition('ELIGIBLE', { atMs: 62000 }), 'INVALID_STATE_TRANSITION');
});

test('ZEP-SEM-003 exact duplicate is idempotent', () => {
  const store = new InMemoryMessageStore();
  const validated = validateMessage(message(), 2000);
  assert.equal(store.observe(validated, 'obs-1').inserted, true);
  const second = store.observe(validated, 'obs-2');
  assert.equal(second.inserted, false);
  assert.equal(store.count(), 1);
  assert.equal(second.observation.evidenceReferences.length, 2);
});

test('ZEP-SEM-004 conflicting duplicate is rejected', () => {
  const store = new InMemoryMessageStore();
  const first = validateMessage(message(), 2000);
  store.observe(first, 'obs-1');
  expectCode(() => store.observe(validateMessage(message({ messageCommitment: 'mc:test:DIFFERENT' }), 2000), 'obs-2'), 'DUPLICATE_CONFLICT');
  assert.equal(store.get(first.messageId)?.message.messageCommitment, 'mc:test:0001');
});

test('ZEP-SEM-005 safe three-fragment reassembly', () => {
  const fragments: Fragment[] = [
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 3, byteOffset: 0, fragmentPayload: new TextEncoder().encode('abc'), authenticated: true, expiresAtMs: 100 },
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 1, fragmentCount: 3, byteOffset: 3, fragmentPayload: new TextEncoder().encode('def'), authenticated: true, expiresAtMs: 100 },
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 2, fragmentCount: 3, byteOffset: 6, fragmentPayload: new TextEncoder().encode('ghi'), authenticated: true, expiresAtMs: 100 },
  ];
  assert.equal(new TextDecoder().decode(reassembleFragments(fragments, 50)), 'abcdefghi');
});

test('ZEP-SEM-006 overlapping or mixed fragment set is rejected', () => {
  const fragments: Fragment[] = [
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 3, byteOffset: 0, fragmentPayload: new Uint8Array([1, 2, 3, 4]), authenticated: true, expiresAtMs: 100 },
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 1, fragmentCount: 3, byteOffset: 3, fragmentPayload: new Uint8Array([5, 6, 7]), authenticated: true, expiresAtMs: 100 },
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 2, fragmentCount: 3, byteOffset: 6, fragmentPayload: new Uint8Array([8, 9, 10]), authenticated: true, expiresAtMs: 100 },
  ];
  expectCode(() => reassembleFragments(fragments, 50), 'FRAGMENT_SET_MISMATCH');
});

test('ZEP-SEM-007 transport acceptance is not delivery', () => {
  const m = validateMessage(message(), 1200);
  const machine = machineFor(m);
  machine.transition('ELIGIBLE', { atMs: 1500 });
  machine.transition('SENDING', { atMs: 1600 });
  applySendResult(machine, m, { kind: 'accepted', externalReference: 'ref-7', acceptedAtMs: 1700 }, { atMs: 1700, attemptId: 'a1', capability: capability(), alternativeEligibleRouteExists: false, receiptVerifier: testReceiptVerifier });
  assert.equal(machine.current(), 'ACCEPTED');
  assert.notEqual(machine.current(), 'ACKNOWLEDGED');
});

test('ZEP-SEM-008 invalid receipt binding', () => {
  const m = validateMessage(message({ messageCommitment: 'mc:test:0008' }), 2000);
  expectCode(() => validateReceipt(m, receipt({ messageCommitment: 'mc:test:OTHER' })), 'RECEIPT_INVALID');
});

test('ZEP-SEM-009 unknown outcome requires duplicate-safe policy', () => {
  const m = validateMessage(message(), 1200);
  const machine = machineFor(m);
  machine.transition('ELIGIBLE', { atMs: 1500 });
  machine.transition('SENDING', { atMs: 1600 });
  const unsafe = capability({ duplicateSafe: false });
  applySendResult(machine, m, { kind: 'unknown', reasonCode: 'CONNECTION_LOST_AFTER_SUBMIT' }, { atMs: 1700, attemptId: 'a1', capability: unsafe, alternativeEligibleRouteExists: false });
  assert.equal(machine.current(), 'UNKNOWN');
  expectCode(() => authorizeUnknownRetry(unsafe, false), 'OUTCOME_UNKNOWN');
});

test('ZEP-SEM-010 SMS optional route remains policy-gated', () => {
  const m = validateMessage(message(), 2000);
  const sms = capability({ adapterId: 'SMS', maximumPayloadBytes: 140 });
  expectCode(() => selectRoute(m, routeRequirements(), [sms], { ...policy, disabledAdapterIds: new Set(['SMS']) }, 2000), 'POLICY_BLOCKED');
  expectCode(() => selectRoute(m, routeRequirements({ fragmentBytes: 141 }), [sms], policy, 2000), 'CAPABILITY_MISMATCH');
});

test('ZEP-SEM-011 one route rejection does not kill the logical message', () => {
  const m = validateMessage(message(), 1200);
  const machine = machineFor(m);
  machine.transition('ELIGIBLE', { atMs: 1500 });
  machine.transition('SENDING', { atMs: 1600 });
  applySendResult(machine, m, { kind: 'permanentlyRejected', reasonCode: 'ROUTE_NOT_SUPPORTED' }, { atMs: 1700, attemptId: 'a1', capability: capability({ adapterId: 'A' }), alternativeEligibleRouteExists: true });
  assert.equal(machine.current(), 'ELIGIBLE');
  assert.equal(machine.history().at(-1)?.reasonCode, 'ROUTE_NOT_SUPPORTED');
});

test('ZEP-SEM-012 receipt policy NONE is rejected before persistence', () => {
  expectCode(() => validateMessage({ ...message(), receiptPolicy: 'NONE' as never }, 2000), 'UNSUPPORTED_RECEIPT_POLICY');
});

test('ZEP-SEM-013 accepted timeout cannot blind retry', () => {
  const m = validateMessage(message(), 1200);
  const machine = machineFor(m);
  machine.transition('ELIGIBLE', { atMs: 1500 });
  machine.transition('SENDING', { atMs: 1600 });
  machine.transition('ACCEPTED', { atMs: 1700 });
  resolveAcceptedTimeout(machine, 5000);
  assert.equal(machine.current(), 'UNKNOWN');
  assert.equal(machine.history().some((entry) => entry.toState === 'TEMPORARILY_UNAVAILABLE'), false);
  expectCode(() => authorizeUnknownRetry(capability({ duplicateSafe: false }), false), 'OUTCOME_UNKNOWN');
});

test('ZEP-SEM-014 expiry equality and backward-clock safety', () => {
  const now = effectiveNow(60999, 61000);
  assert.equal(now, 61000);
  assert.equal(effectiveNow(now, 60000), 61000);
  const m = validateMessage(message(), 2000);
  const machine = machineFor(m);
  assert.equal(machine.current(now), 'EXPIRED');
  assert.equal(machine.current(60000), 'EXPIRED');
});
