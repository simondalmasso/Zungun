import assert from 'node:assert/strict';
import test from 'node:test';
import * as core from '../src/index.js';
import { assertExactKeys, requireNullableOpaqueId, requirePlainRecord, snapshotExactRecord } from '../src/validation.js';
import {
  DeliveryStateMachine,
  InMemoryMessageStore,
  ZepError,
  adapterCancel,
  adapterCapabilities,
  adapterReceive,
  adapterSend,
  adapterStatus,
  applySendResult,
  reassembleFragments,
  selectRoute,
  validateCancelResult,
  validateMessage,
  validateReceiveBatch,
  validateReceipt,
  validateSendResult,
  validateTransportCapabilities,
  validateTransportStatus,
  verifyEndRecipientReceipt,
  type Fragment,
  type Receipt,
  type TransportAdapter,
} from '../src/index.js';
import { capability, CompleteTestAdapter, message, routeRequirements, testReceiptVerifier } from './helpers.js';

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof ZepError && error.code === code);
}

function ackReceipt(recipientId: string, observedAtMs: number, receiptId = `receipt-${recipientId}`): Receipt {
  return {
    receiptId,
    messageId: '00000000000000000000000000000001',
    messageCommitment: 'mc:test:0001',
    recipientId,
    receiptKind: 'END_RECIPIENT_ACKNOWLEDGED',
    observedAtMs,
    adapterId: 'BLE_DIRECT',
    authenticated: true,
  };
}

test('ZEP-ADV-001 caller, returned payload and store observer cannot mutate committed content', () => {
  const inputPayload = Uint8Array.of(65, 66, 67);
  const inputExtensions: Record<string, unknown> = { nested: { value: 1 }, list: [{ flag: true }] };
  const validated = validateMessage(message({ payload: inputPayload, extensions: inputExtensions }), 2000);
  inputPayload[0] = 90;
  (inputExtensions.nested as { value: number }).value = 9;
  const exposed = validated.payload;
  exposed[1] = 99;
  assert.deepEqual(validated.payload, Uint8Array.of(65, 66, 67));
  assert.equal((validated.extensions?.nested as Readonly<Record<string, unknown>>).value, 1);
  assert.throws(() => { (validated.extensions?.nested as Record<string, unknown>).value = 2; }, TypeError);

  const store = new InMemoryMessageStore();
  store.observe(validated, 'immutable-1');
  const observedPayload = store.get(validated.messageId)!.message.payload;
  observedPayload[2] = 0;
  assert.deepEqual(store.get(validated.messageId)!.message.payload, Uint8Array.of(65, 66, 67));
});

test('ZEP-ADV-002 global ACK requires every intended recipient', () => {
  const m = validateMessage(message({ recipientIds: ['recipient-1', 'recipient-2'] }), 1200);
  const machine = new DeliveryStateMachine(m);
  machine.transition('ELIGIBLE', { atMs: 1500 });
  machine.transition('SENDING', { atMs: 1600 });
  applySendResult(machine, m, { kind: 'acknowledged', receipt: ackReceipt('recipient-1', 1700) }, { atMs: 1700, attemptId: 'a1', capability: capability(), alternativeEligibleRouteExists: true, receiptVerifier: testReceiptVerifier });
  assert.equal(machine.current(), 'ACCEPTED');
  assert.deepEqual(machine.acknowledgedRecipientIds(), ['recipient-1']);
  assert.deepEqual(machine.pendingRecipientIds(), ['recipient-2']);
  applySendResult(machine, m, { kind: 'acknowledged', receipt: ackReceipt('recipient-2', 1800) }, { atMs: 1800, attemptId: 'a2', capability: capability(), alternativeEligibleRouteExists: false, receiptVerifier: testReceiptVerifier });
  assert.equal(machine.current(), 'ACKNOWLEDGED');
  assert.deepEqual(machine.acknowledgedRecipientIds(), ['recipient-1', 'recipient-2']);
});

test('ZEP-ADV-003 complete TransportAdapter contract is implementable and all result boundaries validate', async () => {
  const adapter: TransportAdapter = new CompleteTestAdapter();
  const caps = await adapterCapabilities(adapter, { nowMs: 2000 });
  const status = await adapterStatus(adapter, { nowMs: 2000 });
  const fragment: Fragment = { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 1, byteOffset: 0, fragmentPayload: Uint8Array.of(1), authenticated: true, expiresAtMs: 5000 };
  const send = await adapterSend(adapter, fragment, { nowMs: 2000, attemptId: 'a1', idempotencyKey: 'i1', deadlineMs: 5000 });
  const receive = await adapterReceive(adapter, null, { nowMs: 2000, limit: 10 });
  const cancel = await adapterCancel(adapter, 'm', 'a1', { nowMs: 2000 });
  assert.equal(caps.adapterId, 'BLE_DIRECT');
  assert.equal(status.availability, 'AVAILABLE');
  assert.equal(send.kind, 'accepted');
  assert.equal(receive.items.length, 0);
  assert.equal(cancel.kind, 'cancelled');
});

test('ZEP-ADV-004 malformed fragments fail at runtime', () => {
  const base: Fragment = { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 1, byteOffset: 0, fragmentPayload: Uint8Array.of(1), authenticated: true, expiresAtMs: 5000 };
  for (const bad of [
    { ...base, fragmentIndex: 0.5 },
    { ...base, fragmentIndex: -1 },
    { ...base, fragmentCount: Number.NaN },
    { ...base, byteOffset: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, expiresAtMs: -1 },
  ]) expectCode(() => reassembleFragments([bad], 1000), bad.expiresAtMs === -1 ? 'INVALID_TIMESTAMP' : 'CORRUPT_RECORD');
});

test('ZEP-ADV-005 malformed receipts, capabilities and adapter outcomes fail at runtime', () => {
  const m = validateMessage(message(), 1000);
  const good = ackReceipt('recipient-1', 2000);
  expectCode(() => validateReceipt(m, { ...good, observedAtMs: -999 }), 'INVALID_TIMESTAMP');
  expectCode(() => validateReceipt(m, { ...good, observedAtMs: 1.5 }), 'INVALID_TIMESTAMP');
  expectCode(() => validateReceipt(m, { ...good, receiptKind: 'FAKE' as never }), 'CORRUPT_RECORD');
  expectCode(() => validateTransportCapabilities({ ...capability(), maximumPayloadBytes: Number.NaN }), 'CORRUPT_RECORD');
  expectCode(() => validateTransportCapabilities({ ...capability(), estimatedCompletionDurationMs: -1 }), 'CORRUPT_RECORD');
  expectCode(() => validateSendResult({ kind: 'accepted', acceptedAtMs: Number.NaN }), 'INVALID_TIMESTAMP');
  expectCode(() => validateSendResult({ kind: 'temporarilyUnavailable', reasonCode: 'TEMP', retryAfterMs: -1 }), 'CORRUPT_RECORD');
  expectCode(() => validateTransportStatus({ adapterId: 'A', observedAtMs: 1.5, availability: 'AVAILABLE', currentEligibility: 'ALLOWED' }), 'INVALID_TIMESTAMP');
  expectCode(() => validateReceiveBatch({ cursor: null, items: [], observedAtMs: -1, hasMore: false }), 'INVALID_TIMESTAMP');
  expectCode(() => validateCancelResult({ kind: 'cancelled', cancelledAtMs: -1 }), 'INVALID_TIMESTAMP');
});

test('ZEP-ADV-006 routes unable to complete strictly before expiry are excluded', () => {
  const m = validateMessage(message({ expiresAtMs: 5000 }), 1000);
  const p = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;
  const fast = capability({ adapterId: 'FAST', estimatedCompletionDurationMs: 999 });
  const equalDeadline = capability({ adapterId: 'EQUAL', estimatedCompletionDurationMs: 1000 });
  assert.equal(selectRoute(m, routeRequirements(), [equalDeadline, fast], p, 4000).adapterId, 'FAST');
  expectCode(() => selectRoute(m, routeRequirements(), [equalDeadline], p, 4000), 'DEADLINE_NOT_FEASIBLE');
  expectCode(() => selectRoute(m, routeRequirements(), [capability({ estimatedCompletionDurationMs: 2 })], p, 4999), 'DEADLINE_NOT_FEASIBLE');
});

test('ZEP-ADV-007 duplicate recipient receipt is idempotent and cannot inflate completion', () => {
  const m = validateMessage(message({ recipientIds: ['recipient-1', 'recipient-2'] }), 1000);
  const machine = new DeliveryStateMachine(m);
  machine.transition('ELIGIBLE', { atMs: 1100 });
  machine.transition('SENDING', { atMs: 1200 });
  const first = ackReceipt('recipient-1', 1300, 'receipt-r1-a');
  applySendResult(machine, m, { kind: 'acknowledged', receipt: first }, { atMs: 1300, attemptId: 'a1', capability: capability(), alternativeEligibleRouteExists: true, receiptVerifier: testReceiptVerifier });
  applySendResult(machine, m, { kind: 'acknowledged', receipt: { ...first, receiptId: 'receipt-r1-b', observedAtMs: 1400 } }, { atMs: 1400, attemptId: 'a2', capability: capability(), alternativeEligibleRouteExists: true, receiptVerifier: testReceiptVerifier });
  assert.equal(machine.current(), 'ACCEPTED');
  assert.equal(machine.acknowledgementHistory().length, 1);
  assert.deepEqual(machine.pendingRecipientIds(), ['recipient-2']);
});


test('ZEP-ADV-008 adapter invocation boundary rejects future and invalid operation outputs', async () => {
  class BadAdapter extends CompleteTestAdapter {
    override async status() { return { adapterId: 'BLE_DIRECT', observedAtMs: 3000, availability: 'AVAILABLE' as const, currentEligibility: 'ALLOWED' as const }; }
  }
  await assert.rejects(() => adapterStatus(new BadAdapter(), { nowMs: 2000 }), (error: unknown) => error instanceof ZepError && error.code === 'INVALID_TIMESTAMP');
  const adapter = new CompleteTestAdapter();
  const fragment: Fragment = { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 1, byteOffset: 0, fragmentPayload: Uint8Array.of(1), authenticated: true, expiresAtMs: 5000 };
  await assert.rejects(() => adapterSend(adapter, fragment, { nowMs: 5000, attemptId: 'a1', idempotencyKey: 'i1', deadlineMs: 5000 }), (error: unknown) => error instanceof ZepError && error.code === 'DEADLINE_NOT_FEASIBLE');
  await assert.rejects(() => adapterReceive(adapter, null, { nowMs: 2000, limit: 0 }), (error: unknown) => error instanceof ZepError && error.code === 'CORRUPT_RECORD');
});


test('ZEP-ADV-009 raw acknowledgement mutation method is absent from the public state machine', () => {
  const machine = new DeliveryStateMachine(validateMessage(message({ messageId: 'm-public-surface', recipientIds: ['recipient-1'] }), 1000));
  assert.equal('recordRecipientAcknowledgement' in (machine as unknown as Record<string, unknown>), false);
});

test('ZEP-ADV-010 forged verified-receipt token cannot mutate acknowledgement state', () => {
  const machine = new DeliveryStateMachine(validateMessage(message({ messageId: 'm-forged-token', recipientIds: ['recipient-1'] }), 1000));
  const forged = { receipt: ackReceipt('recipient-1', 2000) };
  expectCode(() => machine.recordVerifiedRecipientAcknowledgement(forged as never), 'RECEIPT_INVALID');
  assert.deepEqual(machine.acknowledgedRecipientIds(), []);
});

test('ZEP-ADV-011 acknowledged adapter result without verifier is rejected', () => {
  const m = validateMessage(message(), 1000);
  const machine = new DeliveryStateMachine(m);
  machine.transition('ELIGIBLE', { atMs: 1100 });
  machine.transition('SENDING', { atMs: 1200 });
  expectCode(() => applySendResult(machine, m, { kind: 'acknowledged', receipt: ackReceipt('recipient-1', 1300) }, {
    atMs: 1300,
    attemptId: 'a-no-verifier',
    capability: capability(),
    alternativeEligibleRouteExists: false,
  }), 'AUTHENTICATION_FAILED');
  assert.equal(machine.current(), 'SENDING');
});

test('ZEP-ADV-012 receipt verifier rejection prevents final acknowledgement', () => {
  const m = validateMessage(message(), 1000);
  const machine = new DeliveryStateMachine(m);
  machine.transition('ELIGIBLE', { atMs: 1100 });
  machine.transition('SENDING', { atMs: 1200 });
  expectCode(() => applySendResult(machine, m, { kind: 'acknowledged', receipt: ackReceipt('recipient-1', 1300) }, {
    atMs: 1300,
    attemptId: 'a-rejected-proof',
    capability: capability(),
    alternativeEligibleRouteExists: false,
    receiptVerifier: { verify: () => false },
  }), 'AUTHENTICATION_FAILED');
  assert.equal(machine.current(), 'SENDING');
});

test('ZEP-ADV-013 pre-creation receipt is causally invalid', () => {
  const m = validateMessage(message({ createdAtMs: 1000, expiresAtMs: 5000 }), 1000);
  expectCode(() => verifyEndRecipientReceipt(m, ackReceipt('recipient-1', 999), testReceiptVerifier), 'RECEIPT_INVALID');
});

test('ZEP-ADV-014 receipt at or after expiry is rejected', () => {
  const m = validateMessage(message({ createdAtMs: 1000, expiresAtMs: 5000 }), 1000);
  expectCode(() => verifyEndRecipientReceipt(m, ackReceipt('recipient-1', 5000), testReceiptVerifier), 'EXPIRED');
  expectCode(() => verifyEndRecipientReceipt(m, ackReceipt('recipient-1', 5001), testReceiptVerifier), 'EXPIRED');
});

test('ZEP-ADV-015 receipt from the future relative to outcome observation is rejected', () => {
  const m = validateMessage(message({ createdAtMs: 1000, expiresAtMs: 5000 }), 1000);
  const machine = new DeliveryStateMachine(m);
  machine.transition('ELIGIBLE', { atMs: 1100 });
  machine.transition('SENDING', { atMs: 1200 });
  expectCode(() => applySendResult(machine, m, { kind: 'acknowledged', receipt: ackReceipt('recipient-1', 2001) }, {
    atMs: 2000,
    attemptId: 'a-future-receipt',
    capability: capability(),
    alternativeEligibleRouteExists: false,
    receiptVerifier: testReceiptVerifier,
  }), 'INVALID_TIMESTAMP');
});

test('ZEP-ADV-016 route without binary support is excluded before scoring', () => {
  const m = validateMessage(message(), 1000);
  const p = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;
  const incapable = capability({ adapterId: 'NO_BINARY', supportsBinary: false, availabilityClass: 99 });
  const capable = capability({ adapterId: 'BINARY', availabilityClass: 1 });
  assert.equal(selectRoute(m, routeRequirements(), [incapable, capable], p, 2000).adapterId, 'BINARY');
  expectCode(() => selectRoute(m, routeRequirements(), [incapable], p, 2000), 'CAPABILITY_MISMATCH');
});

test('ZEP-ADV-017 fragmented delivery excludes transport without fragmentation support', () => {
  const m = validateMessage(message(), 1000);
  const p = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;
  const requirements = routeRequirements({ fragmentCount: 2, requiresFragmentation: true });
  const incapable = capability({ adapterId: 'NO_FRAGMENTATION', supportsFragmentation: false, availabilityClass: 99 });
  const capable = capability({ adapterId: 'FRAGMENTATION', availabilityClass: 1 });
  assert.equal(selectRoute(m, requirements, [incapable, capable], p, 2000).adapterId, 'FRAGMENTATION');
  expectCode(() => selectRoute(m, requirements, [incapable], p, 2000), 'CAPABILITY_MISMATCH');
});

test('ZEP-ADV-018 END_RECIPIENT_ACK policy excludes transport without final receipt support', () => {
  const m = validateMessage(message(), 1000);
  const p = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;
  const incapable = capability({ adapterId: 'NO_FINAL_ACK', supportsEndRecipientReceipt: false, availabilityClass: 99 });
  const capable = capability({ adapterId: 'FINAL_ACK', availabilityClass: 1 });
  assert.equal(selectRoute(m, routeRequirements(), [incapable, capable], p, 2000).adapterId, 'FINAL_ACK');
  expectCode(() => selectRoute(m, routeRequirements(), [incapable], p, 2000), 'CAPABILITY_MISMATCH');
});

test('ZEP-ADV-019 explicit transport-receipt requirement excludes incapable transport', () => {
  const m = validateMessage(message(), 1000);
  const p = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;
  const requirements = routeRequirements({ requiresTransportReceipt: true });
  const incapable = capability({ adapterId: 'NO_TRANSPORT_RECEIPT', supportsTransportReceipt: false, availabilityClass: 99 });
  const capable = capability({ adapterId: 'TRANSPORT_RECEIPT', availabilityClass: 1 });
  assert.equal(selectRoute(m, requirements, [incapable, capable], p, 2000).adapterId, 'TRANSPORT_RECEIPT');
  expectCode(() => selectRoute(m, requirements, [incapable], p, 2000), 'CAPABILITY_MISMATCH');
});

test('ZEP-ADV-020 adapter-id tie-break is locale independent', () => {
  const m = validateMessage(message(), 1000);
  const p = { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false } as const;
  const routes = [capability({ adapterId: 'ä' }), capability({ adapterId: 'z' })];
  assert.equal(selectRoute(m, routeRequirements(), routes, p, 2000).adapterId, 'z');
  routes.reverse();
  assert.equal(selectRoute(m, routeRequirements(), routes, p, 2000).adapterId, 'z');
});

test('ZEP-ADV-021 receive batch cannot exceed requested limit', async () => {
  class OversizedBatchAdapter extends CompleteTestAdapter {
    override async receive(_cursor: string | null, context: { nowMs: number; limit: number }) {
      const fragment: Fragment = { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 1, byteOffset: 0, fragmentPayload: Uint8Array.of(1), authenticated: true, expiresAtMs: 5000 };
      return { cursor: null, items: [{ kind: 'fragment' as const, fragment }, { kind: 'fragment' as const, fragment }], observedAtMs: context.nowMs, hasMore: false };
    }
  }
  await assert.rejects(() => adapterReceive(new OversizedBatchAdapter(), null, { nowMs: 2000, limit: 1 }), (error: unknown) => error instanceof ZepError && error.code === 'CORRUPT_RECORD');
});

test('ZEP-ADV-022 hasMore receive batch requires a continuation cursor', async () => {
  class NonProgressingAdapter extends CompleteTestAdapter {
    override async receive(_cursor: string | null, context: { nowMs: number; limit: number }) {
      return { cursor: null, items: [], observedAtMs: context.nowMs, hasMore: true };
    }
  }
  await assert.rejects(() => adapterReceive(new NonProgressingAdapter(), null, { nowMs: 2000, limit: 1 }), (error: unknown) => error instanceof ZepError && error.code === 'CORRUPT_RECORD');
});

test('ZEP-ADV-023 state machine is bound to the complete validated message instance', () => {
  const full = validateMessage(message({ recipientIds: ['recipient-1', 'recipient-2'] }), 1000);
  const subset = validateMessage(message({ recipientIds: ['recipient-1'] }), 1000);
  const machine = new DeliveryStateMachine(full);
  machine.transition('ELIGIBLE', { atMs: 1100 });
  machine.transition('SENDING', { atMs: 1200 });
  expectCode(() => applySendResult(machine, subset, { kind: 'acknowledged', receipt: ackReceipt('recipient-1', 1300) }, {
    atMs: 1300,
    attemptId: 'subset-attempt',
    capability: capability(),
    alternativeEligibleRouteExists: false,
    receiptVerifier: testReceiptVerifier,
  }), 'CORRUPT_RECORD');
  assert.equal(machine.current(), 'SENDING');
  assert.deepEqual(machine.pendingRecipientIds(), ['recipient-1', 'recipient-2']);

  const subsetProof = verifyEndRecipientReceipt(subset, ackReceipt('recipient-1', 1301, 'subset-proof'), testReceiptVerifier);
  expectCode(() => machine.recordVerifiedRecipientAcknowledgement(subsetProof), 'RECEIPT_INVALID');
  assert.deepEqual(machine.pendingRecipientIds(), ['recipient-1', 'recipient-2']);
});

test('ZEP-ADV-024 legacy constructor arguments cannot create a partial-recipient machine', () => {
  expectCode(() => new (DeliveryStateMachine as unknown as new (...args: unknown[]) => DeliveryStateMachine)(
    '00000000000000000000000000000001', 5000, ['recipient-1'],
  ), 'CORRUPT_RECORD');
});

test('ZEP-ADV-025 provider-private fields are rejected by exact allowlists', () => {
  const validMessage = validateMessage(message(), 1000);
  const machine = new DeliveryStateMachine(validMessage);
  const fragment: Fragment = { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 1, byteOffset: 0, fragmentPayload: Uint8Array.of(1), authenticated: true, expiresAtMs: 5000 };
  const errorRecord = { errorCode: 'CORRUPT_RECORD', messageId: null, attemptId: null, adapterId: null, atMs: 1000, retryable: false, publicDetail: 'safe', privateDiagnosticReference: null } as const;

  const boundaries: Array<() => unknown> = [
    () => validateMessage({ ...message(), providerSecret: 'leak' } as never, 1000),
    () => core.validateFragment({ ...fragment, providerSecret: 'leak' } as never),
    () => core.validateReceiptShape({ ...ackReceipt('recipient-1', 1200), providerSecret: 'leak' } as never),
    () => validateTransportCapabilities({ ...capability(), providerToken: 'leak' } as never),
    () => validateTransportStatus({ adapterId: 'A', observedAtMs: 1000, availability: 'AVAILABLE', currentEligibility: 'ALLOWED', providerStatus: 'leak' } as never),
    () => validateSendResult({ kind: 'permanentlyRejected', reasonCode: 'NO', providerCode: 'leak' } as never),
    () => validateReceiveBatch({ cursor: null, items: [], observedAtMs: 1000, hasMore: false, providerCursor: 'leak' } as never),
    () => validateReceiveBatch({ cursor: null, items: [{ kind: 'fragment', fragment, providerItem: 'leak' }], observedAtMs: 1000, hasMore: false } as never),
    () => validateCancelResult({ kind: 'unsupported', reasonCode: 'NO', providerCode: 'leak' } as never),
    () => core.validateAdapterContext({ nowMs: 1000, providerContext: 'leak' } as never),
    () => core.validateAttemptContext({ nowMs: 1000, attemptId: 'a', idempotencyKey: 'i', deadlineMs: 5000, providerContext: 'leak' } as never),
    () => core.validateReceiveContext({ nowMs: 1000, limit: 1, providerContext: 'leak' } as never),
    () => core.createSafeErrorRecord({ ...errorRecord, providerDiagnostic: 'leak' } as never),
    () => selectRoute(validMessage, { ...routeRequirements(), providerRequirement: 'leak' } as never, [capability()], { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false }, 2000),
    () => selectRoute(validMessage, routeRequirements(), [capability()], { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false, providerPolicy: 'leak' } as never, 2000),
    () => machine.transition('ELIGIBLE', { atMs: 1100, providerTransition: 'leak' } as never),
  ];
  for (const boundary of boundaries) {
    assert.throws(boundary, (error: unknown) => error instanceof ZepError && !(error instanceof TypeError));
  }
  assert.equal(machine.current(), 'QUEUED');
});

test('ZEP-ADV-026 public runtime boundaries reject malformed values without raw native errors', async () => {
  const valid = validateMessage(message(), 1000);
  const machine = new DeliveryStateMachine(valid);
  const store = new InMemoryMessageStore();
  const adapter = new CompleteTestAdapter();
  const fragment: Fragment = { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 1, byteOffset: 0, fragmentPayload: Uint8Array.of(1), authenticated: true, expiresAtMs: 5000 };

  const syncBoundaries = new Map<string, () => unknown>([
    ['DeliveryStateMachine', () => new DeliveryStateMachine(null as never)],
    ['InMemoryMessageStore.observe', () => store.observe(null as never, 'e')],
    ['InMemoryMessageStore.get', () => store.get(null as never)],
    ['applySendResult', () => applySendResult(null as never, valid, { kind: 'permanentlyRejected', reasonCode: 'NO' }, { atMs: 1200, attemptId: 'a', capability: capability(), alternativeEligibleRouteExists: false })],
    ['assertValidatedMessage', () => core.assertValidatedMessage(null as never)],
    ['assertVerifiedEndRecipientReceipt', () => core.assertVerifiedEndRecipientReceipt(null as never)],
    ['authorizeUnknownRetry', () => core.authorizeUnknownRetry(null as never, false)],
    ['checkedAddMs', () => core.checkedAddMs(null as never, 0, 'checked')],
    ['createSafeErrorRecord', () => core.createSafeErrorRecord(null as never)],
    ['effectiveNow', () => core.effectiveNow(null as never, 0)],
    ['isExpired', () => core.isExpired(null as never, 0)],
    ['normalizeExtensions', () => core.normalizeExtensions(null)],
    ['provesEndRecipientAcknowledgement', () => core.provesEndRecipientAcknowledgement(valid, null as never, testReceiptVerifier)],
    ['reassembleFragments', () => reassembleFragments(null as never, 1000)],
    ['requireBoolean', () => core.requireBoolean(null, 'value')],
    ['requireEnum', () => core.requireEnum(null, 'value', ['A'] as const)],
    ['requireEpochMs', () => core.requireEpochMs(null, 'value')],
    ['requireNonNegativeSafeInteger', () => core.requireNonNegativeSafeInteger(null, 'value')],
    ['requireOpaqueId', () => core.requireOpaqueId(null, 'value')],
    ['requirePositiveSafeInteger', () => core.requirePositiveSafeInteger(null, 'value')],
    ['requireReasonCode', () => core.requireReasonCode(null)],
    ['requireUint8Array', () => core.requireUint8Array(null, 'value')],
    ['resolveAcceptedTimeout', () => core.resolveAcceptedTimeout(null as never, 1000)],
    ['selectRoute', () => selectRoute(null as never, routeRequirements(), [capability()], { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false }, 2000)],
    ['validateAdapterContext', () => core.validateAdapterContext(null as never)],
    ['validateAttemptContext', () => core.validateAttemptContext(null as never)],
    ['validateCancelResult', () => validateCancelResult(null as never)],
    ['validateEpochMs', () => core.validateEpochMs(null as never, 'value')],
    ['validateFragment', () => core.validateFragment(null as never)],
    ['validateMessage', () => validateMessage(null as never, 1000)],
    ['validateReceipt', () => validateReceipt(valid, null as never)],
    ['validateReceiptShape', () => core.validateReceiptShape(null as never)],
    ['validateReceiveBatch', () => validateReceiveBatch(null as never)],
    ['validateReceiveContext', () => core.validateReceiveContext(null as never)],
    ['validateSendResult', () => validateSendResult(null as never)],
    ['validateTransportCapabilities', () => validateTransportCapabilities(null as never)],
    ['validateTransportStatus', () => validateTransportStatus(null as never)],
    ['verifyEndRecipientReceipt', () => verifyEndRecipientReceipt(valid, null as never, testReceiptVerifier)],
    ['DeliveryStateMachine.transition', () => machine.transition('ELIGIBLE', null as never)],
  ]);

  for (const [name, boundary] of syncBoundaries) {
    assert.throws(boundary, (error: unknown) => error instanceof ZepError && !(error instanceof TypeError), name);
  }

  assert.equal(core.isValidatedMessage(null), false);
  assert.equal(requireNullableOpaqueId(null, 'value'), null);
  assert.equal(core.requireOptionalOpaqueId(undefined, 'value'), undefined);
  assert.throws(() => core.fail('CORRUPT_RECORD', 'expected'), (error: unknown) => error instanceof ZepError);

  const asyncBoundaries = new Map<string, () => Promise<unknown>>([
    ['adapterCapabilities.adapter', () => adapterCapabilities(null as never, { nowMs: 1000 })],
    ['adapterCapabilities.context', () => adapterCapabilities(adapter, null as never)],
    ['adapterStatus.adapter', () => adapterStatus(null as never, { nowMs: 1000 })],
    ['adapterStatus.context', () => adapterStatus(adapter, null as never)],
    ['adapterSend.adapter', () => adapterSend(null as never, fragment, { nowMs: 1000, attemptId: 'a', idempotencyKey: 'i', deadlineMs: 5000 })],
    ['adapterSend.fragment', () => adapterSend(adapter, null as never, { nowMs: 1000, attemptId: 'a', idempotencyKey: 'i', deadlineMs: 5000 })],
    ['adapterSend.context', () => adapterSend(adapter, fragment, null as never)],
    ['adapterReceive.adapter', () => adapterReceive(null as never, null, { nowMs: 1000, limit: 1 })],
    ['adapterReceive.context', () => adapterReceive(adapter, null, null as never)],
    ['adapterCancel.adapter', () => adapterCancel(null as never, 'm', 'a', { nowMs: 1000 })],
    ['adapterCancel.messageId', () => adapterCancel(adapter, null as never, 'a', { nowMs: 1000 })],
    ['adapterCancel.context', () => adapterCancel(adapter, 'm', 'a', null as never)],
  ]);
  for (const [name, boundary] of asyncBoundaries) {
    await assert.rejects(boundary, (error: unknown) => error instanceof ZepError && !(error instanceof TypeError), name);
  }

  class ThrowingAdapter extends CompleteTestAdapter {
    override async capabilities(): Promise<never> { throw new TypeError('provider failure'); }
  }
  await assert.rejects(() => adapterCapabilities(new ThrowingAdapter(), { nowMs: 1000 }), (error: unknown) => error instanceof ZepError && error.code === 'TEMPORARY_UNAVAILABLE');

  const malformedCorpus: unknown[] = [undefined, null, true, false, 0, 1, -1, '', 'yes', 1n, Symbol('x'), () => undefined, [], new Date(0)];
  const objectValidators: Array<(value: unknown) => unknown> = [
    (value) => validateMessage(value as never, 1000),
    (value) => core.validateFragment(value as never),
    (value) => core.validateReceiptShape(value as never),
    (value) => validateTransportCapabilities(value as never),
    (value) => validateTransportStatus(value as never),
    (value) => validateSendResult(value as never),
    (value) => validateReceiveBatch(value as never),
    (value) => validateCancelResult(value as never),
    (value) => core.validateAdapterContext(value as never),
    (value) => core.validateAttemptContext(value as never),
    (value) => core.validateReceiveContext(value as never),
    (value) => core.createSafeErrorRecord(value as never),
  ];
  for (const validator of objectValidators) {
    for (const candidate of malformedCorpus) {
      assert.throws(() => validator(candidate), (error: unknown) => error instanceof ZepError && !(error instanceof TypeError));
    }
  }

  const revokedObject = Proxy.revocable({}, {});
  revokedObject.revoke();
  const revokedBytes = Proxy.revocable(Uint8Array.of(1), {});
  revokedBytes.revoke();
  const revokedSet = Proxy.revocable(new Set(['BLE_DIRECT']), {});
  revokedSet.revoke();
  for (const boundary of [
    () => requirePlainRecord(revokedObject.proxy, 'revoked'),
    () => core.normalizeExtensions(revokedObject.proxy),
    () => core.createSafeErrorRecord(revokedObject.proxy as never),
    () => core.requireUint8Array(revokedBytes.proxy, 'revokedBytes'),
    () => selectRoute(valid, routeRequirements(), [capability()], { version: 'p1', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false, allowedAdapterIds: revokedSet.proxy as never }, 2000),
    () => applySendResult(revokedObject.proxy as never, valid, { kind: 'permanentlyRejected', reasonCode: 'NO' }, { atMs: 1200, attemptId: 'a', capability: capability(), alternativeEligibleRouteExists: false }),
  ]) {
    assert.throws(boundary, (error: unknown) => error instanceof ZepError && !(error instanceof TypeError));
  }

  const mappedFragments = [fragment] as Fragment[];
  Object.defineProperty(mappedFragments, 'map', { value: null, configurable: true });
  assert.deepEqual(reassembleFragments(mappedFragments, 1000), Uint8Array.of(1));
  const mappedItems: unknown[] = [];
  Object.defineProperty(mappedItems, 'map', { value: null, configurable: true });
  assert.equal(validateReceiveBatch({ cursor: null, items: mappedItems as never, observedAtMs: 1000, hasMore: false }).items.length, 0);
  const extensionArray: unknown[] = [{ safe: true }];
  Object.defineProperty(extensionArray, 'map', { value: null, configurable: true });
  const extensionMessage = validateMessage(message({ messageId: 'extension-map-safe', extensions: { items: extensionArray } }), 1000);
  assert.equal(Array.isArray(extensionMessage.extensions?.items), true);

  const throwingKind = {} as Record<string, unknown>;
  Object.defineProperty(throwingKind, 'kind', { enumerable: true, get() { throw new TypeError('getter'); } });
  assert.throws(() => validateSendResult(throwingKind as never), (error: unknown) => error instanceof ZepError && !(error instanceof TypeError));

  const runtimeExports = Object.keys(core).sort();
  const classified = new Set<string>([
    ...syncBoundaries.keys(),
    'ALLOWED_TRANSITIONS', 'DELIVERY_STATES', 'TERMINAL_STATES', 'InMemoryMessageStore', 'ZepError',
    'adapterCancel', 'adapterCapabilities', 'adapterReceive', 'adapterSend', 'adapterStatus',
    'fail', 'isValidatedMessage', 'requireNullableOpaqueId', 'requireOptionalOpaqueId',
  ]);
  assert.deepEqual(runtimeExports.filter((name) => !classified.has(name)), [], 'Every runtime export must be classified by boundary fuzzing or explicit no-input/predicate handling');
});

test('ZEP-ADV-027 OutcomeContext validates boolean strictly and atomically', () => {
  const m = validateMessage(message(), 1000);
  const machine = new DeliveryStateMachine(m);
  machine.transition('ELIGIBLE', { atMs: 1100 });
  expectCode(() => applySendResult(machine, m, { kind: 'permanentlyRejected', reasonCode: 'ROUTE_REJECTED' }, {
    atMs: 1200,
    attemptId: 'truthy-context',
    capability: capability(),
    alternativeEligibleRouteExists: 'yes' as never,
  }), 'CORRUPT_RECORD');
  assert.equal(machine.current(), 'ELIGIBLE');
  expectCode(() => core.authorizeUnknownRetry(capability({ duplicateSafe: false }), 'yes' as never), 'CORRUPT_RECORD');
});

test('ZEP-ADV-028 OutcomeContext rejects null and provider-private fields before mutation', () => {
  const m = validateMessage(message(), 1000);
  const machine = new DeliveryStateMachine(m);
  machine.transition('ELIGIBLE', { atMs: 1100 });
  expectCode(() => applySendResult(machine, m, { kind: 'permanentlyRejected', reasonCode: 'NO' }, null as never), 'CORRUPT_RECORD');
  expectCode(() => applySendResult(machine, m, { kind: 'permanentlyRejected', reasonCode: 'NO' }, {
    atMs: 1200,
    attemptId: 'extra-context',
    capability: capability(),
    alternativeEligibleRouteExists: false,
    providerDecision: 'secret',
  } as never), 'CORRUPT_RECORD');
  assert.equal(machine.current(), 'ELIGIBLE');
});
