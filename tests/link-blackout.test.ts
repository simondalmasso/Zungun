import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { verifyLinkProofBundle } from '../packages/link-core/src/index.js';
import { runLinkBlackoutDrill } from '../tools/resilience-lab/src/link-blackout-drill.js';

test('Blackout Drill drives real proxy ambiguity and persisted deferred resume across runtime recreation',async()=>{
  const r=await runLinkBlackoutDrill();
  assert.equal(r.transportAttemptCount,1);
  assert.equal(r.businessEffectCount,1);
  assert.equal(r.secondSideEffectSendCount,0);
  assert.equal(r.reconciliationQueryCount,1);
  assert.equal(r.deferredTransportAttemptCount,2);
  assert.equal(r.deferredRuntimeReopenCount,1);
  assert.ok(r.deferredCheckpointOffset>0);
  assert.equal(r.deferredPersistentState,'COMPLETED');
  assert.equal(r.finalCoreComplete,true);
  assert.equal(r.finalEvidenceComplete,true);
  assert.equal(verifyLinkProofBundle(r.proofBundle),true);
  assert.ok(r.decisions.includes('SEND_CRITICAL_CORE_NOW'));
  assert.ok(r.decisions.includes('RECONCILE_BEFORE_RETRY'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='TRANSPORT_PATH_SELECTED'&&x.details.fault==='DROP_RESPONSE_AFTER_DURABLE_ACCEPT'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='RECONCILIATION_RESULT'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='DEFERRED_TRANSFER_CHECKPOINT'&&x.details.source==='PERSISTED_DEFERRED_RUNTIME'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='DEFERRED_TRANSFER_COMPLETED'&&x.details.source==='PERSISTED_DEFERRED_RUNTIME'&&x.requiredEvidenceComplete));
});

test('Blackout Drill cannot directly manufacture deferred completion state',()=>{
  const source=readFileSync(new URL('../tools/resilience-lab/src/link-blackout-drill.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/evidenceComplete\s*=\s*true/);
  assert.doesNotMatch(source,/this\.record\(\s*['"]DEFERRED_TRANSFER_COMPLETED['"]/);
  assert.doesNotMatch(source,/resumeDeferred\s*\(/);
  assert.match(source,/PERSISTED_DEFERRED_RUNTIME/);
  assert.match(source,/deferredDatabase\.close\(\)/);
  assert.match(source,/new DatabaseSync\(deferredPath\)/);
});
