import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECLARED_SCOPE_SCHEMA,
  DELIVERY_EVIDENCE_SCHEMA,
  MANUAL_RESOLUTION_SCHEMA,
  declaredScopeManifestHash,
  deliveryEvidenceHash,
  manualResolutionHash,
  validateDeclaredScopeManifest,
  validateDeliveryEvidence,
  validateManualResolution,
} from '../packages/protocol-core/src/extensions.js';

test('delivery evidence contract is content-addressed and tamper evident', () => {
  const base = {
    operationId: 'op_extension_1',
    source: 'DEVICE' as const,
    kind: 'TRANSPORT_ATTEMPT' as const,
    occurredAtMs: 10,
    reference: 'attempt_1',
    payload: { attempt: 1 },
  };
  const record = { schema: DELIVERY_EVIDENCE_SCHEMA, ...base, evidenceHash: deliveryEvidenceHash(base) };
  assert.equal(validateDeliveryEvidence(record).evidenceHash, record.evidenceHash);
  assert.throws(() => validateDeliveryEvidence({ ...record, payload: { attempt: 2 } }), /MISMATCH/);
});

test('declared scope contract binds population and predecessor', () => {
  const base = {
    scopeType: 'SHIFT' as const,
    scopeId: 'shift_1',
    declarationVersion: 2,
    expectedReportingDeviceIds: ['d2', 'd1'],
    expectedOperationIds: ['op_2', 'op_1'],
    expectedOperationCount: 2,
    declaredAtMs: 10,
    provenance: 'dispatch:v2',
    previousManifestHash: 'sha256:previous',
  };
  const record = { schema: DECLARED_SCOPE_SCHEMA, ...base, manifestHash: declaredScopeManifestHash(base) };
  assert.equal(validateDeclaredScopeManifest(record).manifestHash, record.manifestHash);
  assert.throws(() => validateDeclaredScopeManifest({ ...record, expectedOperationCount: 3 }), /MISMATCH/);
});

test('manual resolution contract binds actor, evidence and predecessor proof', () => {
  const base = {
    operationId: 'op_extension_1',
    revision: 1,
    targetVerdict: 'UNKNOWN' as const,
    rationale: 'retain ambiguity pending application evidence',
    referencedFactIds: ['fact_1'],
    previousProofHash: 'sha256:previous',
    actorId: 'reviewer_1',
    createdAtMs: 10,
  };
  const record = { schema: MANUAL_RESOLUTION_SCHEMA, ...base, newProofHash: manualResolutionHash(base) };
  assert.equal(validateManualResolution(record).newProofHash, record.newProofHash);
  assert.throws(() => validateManualResolution({ ...record, actorId: 'reviewer_2' }), /MISMATCH/);
});
