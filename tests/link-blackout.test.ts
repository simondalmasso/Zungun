import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyLinkProofBundle } from '../packages/link-core/src/index.js';
import { runLinkBlackoutDrill } from '../tools/resilience-lab/src/link-blackout-drill.js';

test('Blackout Drill drives real proxy transport ambiguity, reconciliation and resumed deferred transfer',async()=>{
  const r=await runLinkBlackoutDrill();
  assert.equal(r.transportAttemptCount,1);
  assert.equal(r.businessEffectCount,1);
  assert.equal(r.secondSideEffectSendCount,0);
  assert.equal(r.reconciliationQueryCount,1);
  assert.equal(r.finalCoreComplete,true);
  assert.equal(r.finalEvidenceComplete,true);
  assert.equal(verifyLinkProofBundle(r.proofBundle),true);
  assert.ok(r.decisions.includes('SEND_CRITICAL_CORE_NOW'));
  assert.ok(r.decisions.includes('RECONCILE_BEFORE_RETRY'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='TRANSPORT_OUTCOME'&&x.details.fault==='DROP_RESPONSE_AFTER_DURABLE_ACCEPT'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='RECONCILIATION_RESULT'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='DEFERRED_TRANSFER_CHECKPOINT'));
  assert.ok(r.proofBundle.records.some(x=>x.kind==='DEFERRED_TRANSFER_COMPLETED'));
});
