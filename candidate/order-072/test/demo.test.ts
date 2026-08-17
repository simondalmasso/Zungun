// PROVENANCE: RECONSTRUCTED_FROM_ORDER.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, runWo2841Demo } from '../src/extensions/index.js';
for (let i = 0; i < 10; i += 1) test(`WO-2841 verdict ${i}`, () => {
  const p = runWo2841Demo(); assert.equal(p.finalVerdict, 'EFFECT_CONFIRMED'); assert.equal(p.action, 'DO_NOT_RETRY');
});
for (let i = 0; i < 10; i += 1) test(`WO-2841 canonical identities ${i}`, () => {
  const p = runWo2841Demo();
  assert.equal(p.operationId, 'OP-DEMO-WO-2841-001');
  assert.equal(p.workOrderId, 'WO-2841');
  assert.equal(p.receiptReference.receipt.receiptId, 'RCP-DEMO-2841');
  assert.equal(p.semanticSourceProvenance, 'EXACT_HISTORICAL_TYPESCRIPT_ORACLE');
});
for (let i = 0; i < 10; i += 1) test(`WO-2841 deterministic proof ${i}`, () => {
  assert.equal(canonicalJson(runWo2841Demo()), canonicalJson(runWo2841Demo()));
  assert.equal(runWo2841Demo().evidence.length, 8);
});
