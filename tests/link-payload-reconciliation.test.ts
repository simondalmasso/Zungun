import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDeferredObjectIntegrity,
  buildOperationPayload,
  contentAddressedObject,
  createLinkDecisionRecord,
  createLinkProofBundle,
  hedgingAllowed,
  reconcileAmbiguous,
  resumeOffset,
  validateDeltaBase,
  verifyLinkProofBundle,
} from '../packages/link-core/src/index.js';

const bytes = new Uint8Array(700_000).fill(7);

test('content-addressed deferred object detects corruption and supports aligned resume', () => {
  const descriptor = contentAddressedObject(bytes, 'image/jpeg', 'REQUIRED_FOR_FINAL_EVIDENCE', 256 * 1024);
  assert.equal(descriptor.objectId, `sha256:${descriptor.sha256}`);
  assert.equal(descriptor.chunkHashes.length, 3);
  assert.doesNotThrow(() => assertDeferredObjectIntegrity(descriptor, bytes));
  const corrupt = bytes.slice(); corrupt[3] = 8;
  assert.throws(() => assertDeferredObjectIntegrity(descriptor, corrupt), /DEFERRED_HASH_MISMATCH/);
  assert.equal(resumeOffset(descriptor, {
    objectId: descriptor.objectId,
    objectSha256: descriptor.sha256,
    confirmedOffset: 256 * 1024,
    confirmedPrefixSha256: descriptor.chunkHashes[0]!,
    remoteVersion: 'v1',
    updatedAtMs: 1,
  }), 256 * 1024);
});

test('critical core commitment remains independent from deferred evidence', () => {
  const deferred = contentAddressedObject(bytes, 'image/jpeg', 'REQUIRED_FOR_FINAL_EVIDENCE');
  const payload = buildOperationPayload(new TextEncoder().encode('{"closed":true}'), 'application/json', [deferred]);
  assert.equal(payload.deferredObjects.length, 1);
  assert.equal(payload.criticalCoreCommitment.length, 64);
});

test('delta requires exact base and never fuzzy-applies', () => {
  const delta = { kind: 'JSON_PATCH_EXACT_BASE' as const, baseSha256: 'a'.repeat(64), resultSha256: 'b'.repeat(64), deltaSha256: 'c'.repeat(64), byteLength: 12 };
  assert.equal(validateDeltaBase(delta, 'a'.repeat(64)), 'APPLY');
  assert.equal(validateDeltaBase(delta, 'd'.repeat(64)), 'FULL_FALLBACK_OR_DEFER');
  assert.equal(validateDeltaBase(delta, null), 'FULL_FALLBACK_OR_DEFER');
});

test('ambiguous durable acceptance recovers without a second side-effect send', () => {
  const result = reconcileAmbiguous({
    prior: 'UNKNOWN', retryContract: 'RECONCILE_BEFORE_RETRY',
    query: { kind: 'ACCEPTED', receiptId: 'r1' }, operationCreatedAtMs: 1, nowMs: 2,
  });
  assert.deepEqual(result, { certainty: 'DURABLY_ACCEPTED', retryAllowed: false, secondSideEffectSendAllowed: false, reason: 'ACCEPTANCE_RECOVERED' });
});

test('bounded authoritative not-accepted can retry but eventual not-found remains uncertain', () => {
  const safe = reconcileAmbiguous({
    prior: 'UNKNOWN', retryContract: 'RECONCILE_BEFORE_RETRY',
    query: { kind: 'BOUNDED_NOT_ACCEPTED', observedThroughMs: 10, authoritative: true }, operationCreatedAtMs: 1, nowMs: 10,
  });
  assert.equal(safe.retryAllowed, true);
  assert.equal(safe.secondSideEffectSendAllowed, true);
  const uncertain = reconcileAmbiguous({
    prior: 'UNKNOWN', retryContract: 'RECONCILE_BEFORE_RETRY', query: { kind: 'NOT_FOUND_UNBOUNDED' }, operationCreatedAtMs: 1, nowMs: 10,
  });
  assert.equal(uncertain.certainty, 'UNKNOWN');
  assert.equal(uncertain.retryAllowed, false);
});

test('hedging is off unless both idempotency and transport capability explicitly permit it', () => {
  const capability = { adapterId: 'http', available: true, reachabilityClass: 'INTERNET' as const, maxPayloadBytes: null, supportsDurableReceipt: true, supportsReceiverQuery: true, supportsResume: false, supportsNetworkBinding: true, supportsHedging: true };
  assert.equal(hedgingAllowed('RECONCILE_BEFORE_RETRY', true, capability), false);
  assert.equal(hedgingAllowed('SAFE_IDEMPOTENT', false, capability), false);
  assert.equal(hedgingAllowed('SAFE_IDEMPOTENT', true, capability), true);
});

test('proof bundle separates effect confirmation from final required evidence and detects tamper', () => {
  const record = createLinkDecisionRecord({
    recordVersion: 1, operationId: 'op1', kind: 'CRITICAL_CORE_SENT', occurredAtMs: 1,
    planId: 'p1', snapshotHash: 's1', adapterId: 'http', networkKey: 'net:1', certainty: 'SENT',
    coreComplete: true, requiredEvidenceComplete: false, details: { deferredBytes: 8_400_000 },
  });
  const bundle = createLinkProofBundle('op1', [record]);
  assert.equal(verifyLinkProofBundle(bundle), true);
  const tampered = { ...bundle, manifestSha256: '0'.repeat(64) };
  assert.equal(verifyLinkProofBundle(tampered), false);
});
