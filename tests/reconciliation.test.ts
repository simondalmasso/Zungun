import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCompletenessCertificate,
  reconcileFacts,
  type OperationFact,
} from '../packages/reconciliation/src/index.js';

const operationId = 'op_recon';
let sequence = 0;
const fact = (source: OperationFact['source'], kind: OperationFact['kind']): OperationFact => ({
  factId: `fact_${++sequence}`,
  operationId,
  source,
  kind,
  occurredAtMs: sequence,
  reference: `ref_${sequence}`,
  payload: {},
});

test('full application evidence confirms effect', () => {
  const result = reconcileFacts(operationId, [
    fact('DEVICE', 'QUEUED'),
    fact('APPLICATION', 'EFFECT_APPLIED'),
    fact('APPLICATION', 'APPLICATION_ACK'),
    fact('RECEIVER', 'SIGNED_RECEIPT'),
  ], 10);
  assert.equal(result.verdict, 'EFFECT_CONFIRMED');
});

test('reconciler-created application ack cannot confirm effect', () => {
  const result = reconcileFacts(operationId, [
    fact('APPLICATION', 'EFFECT_APPLIED'),
    fact('RECONCILER', 'APPLICATION_ACK'),
    fact('RECEIVER', 'SIGNED_RECEIPT'),
  ], 10);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.ok(result.anomalies.includes('MISSING_APPLICATION_ACK'));
});

test('manual resolution facts never strengthen the operational verdict', () => {
  const result = reconcileFacts(operationId, [
    fact('RECEIVER', 'RECEIVER_ACCEPTED'),
    fact('REVIEWER', 'MANUAL_RESOLUTION'),
  ], 10);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.deepEqual(result.evidenceFactIds.length, 1);
});

test('effect without ack remains unknown', () => {
  const result = reconcileFacts(operationId, [fact('APPLICATION', 'EFFECT_APPLIED')], 10);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.ok(result.anomalies.includes('MISSING_APPLICATION_ACK'));
});

test('ack without receipt remains unknown', () => {
  const result = reconcileFacts(operationId, [
    fact('APPLICATION', 'EFFECT_APPLIED'),
    fact('APPLICATION', 'APPLICATION_ACK'),
  ], 10);
  assert.equal(result.verdict, 'UNKNOWN');
  assert.ok(result.anomalies.includes('MISSING_SIGNED_RECEIPT'));
});

test('contradictory effects require compensation', () => {
  assert.equal(reconcileFacts(operationId, [
    fact('APPLICATION', 'EFFECT_APPLIED'),
    fact('ERP', 'NO_EFFECT'),
  ], 10).verdict, 'COMPENSATION_REQUIRED');
});

test('proof hash is stable when only derivation time changes', () => {
  const facts = [fact('DEVICE', 'QUEUED')];
  assert.equal(
    reconcileFacts(operationId, facts, 10).proofHash,
    reconcileFacts(operationId, facts, 20).proofHash,
  );
});

test('declared silent device prevents bounded completeness', () => {
  const certificate = createCompletenessCertificate({
    scopeType: 'SHIFT',
    scopeId: 's1',
    declarationVersion: 1,
    expectedReportingDeviceIds: ['d1', 'd2'],
    expectedOperationIds: ['op_1'],
    expectedOperationCount: 1,
    observedReportingDeviceIds: ['d1'],
    observedOperationIds: ['op_1'],
    terminalOperationIds: ['op_1'],
    unknownOperationIds: [],
    declaredAtMs: 1,
    declarationProvenance: 'manifest:test',
    issuedAtMs: 10,
  });
  assert.equal(certificate.completeWithinDeclaredScope, false);
  assert.deepEqual(certificate.missingReportingDeviceIds, ['d2']);
});

test('complete declared population produces bounded certificate', () => {
  const certificate = createCompletenessCertificate({
    scopeType: 'SHIFT',
    scopeId: 's1',
    declarationVersion: 1,
    expectedReportingDeviceIds: ['d1'],
    expectedOperationIds: ['op_1'],
    expectedOperationCount: 1,
    observedReportingDeviceIds: ['d1'],
    observedOperationIds: ['op_1'],
    terminalOperationIds: ['op_1'],
    unknownOperationIds: [],
    declaredAtMs: 1,
    declarationProvenance: 'manifest:test',
    issuedAtMs: 10,
  });
  assert.equal(certificate.completeWithinDeclaredScope, true);
  assert.deepEqual(certificate.missingOperationIds, []);
});

test('empty declared scope can be complete only when explicitly declared empty', () => {
  const certificate = createCompletenessCertificate({
    scopeType: 'BATCH',
    scopeId: 'empty',
    declarationVersion: 1,
    expectedReportingDeviceIds: [],
    expectedOperationIds: [],
    expectedOperationCount: 0,
    observedReportingDeviceIds: [],
    observedOperationIds: [],
    terminalOperationIds: [],
    unknownOperationIds: [],
    declaredAtMs: 1,
    declarationProvenance: 'manifest:empty',
    issuedAtMs: 10,
  });
  assert.equal(certificate.completeWithinDeclaredScope, true);
});
