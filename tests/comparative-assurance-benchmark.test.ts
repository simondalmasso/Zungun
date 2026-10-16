import test from 'node:test';
import assert from 'node:assert/strict';
import { runComparativeAssuranceBenchmark } from '../tools/resilience-lab/src/comparative-benchmark.js';

test('comparative benchmark distinguishes naive retries from a competent idempotent baseline', async () => {
  const report = await runComparativeAssuranceBenchmark(5);
  assert.equal(report.ok, true);
  assert.equal(report.trialsPerLane, 5);

  const naive = report.lanes.find((lane) => lane.lane === 'direct-http-no-idempotency')!;
  const directIdempotent = report.lanes.find((lane) => lane.lane === 'direct-http-idempotent-receiver')!;
  const outbox = report.lanes.find((lane) => lane.lane === 'sqlite-outbox-idempotent-receiver')!;
  const zungun = report.lanes.find((lane) => lane.lane === 'zungun-link-reconcile')!;

  assert.equal(naive.businessEffects, 10);
  assert.equal(naive.duplicateBusinessEffects, 5);
  assert.equal(directIdempotent.businessEffects, 5);
  assert.equal(directIdempotent.duplicateBusinessEffects, 0);
  assert.equal(outbox.businessEffects, 5);
  assert.equal(outbox.duplicateBusinessEffects, 0);
  assert.equal(outbox.durableSenderRecords, 5);
  assert.equal(outbox.pendingSenderRecords, 0);
  assert.equal(zungun.businessEffects, 5);
  assert.equal(zungun.duplicateBusinessEffects, 0);
  assert.equal(zungun.sideEffectRequests, 5);
  assert.equal(zungun.reconciliationQueries, 5);
  assert.equal(zungun.durableProxyRecords, 5);
  assert.equal(zungun.replayChecksPassed, 5);
  assert.equal(outbox.totalNetworkCalls, zungun.totalNetworkCalls);
  assert.equal(report.integratedLinkProof.proofBundleVerified, true);
  assert.equal(report.integratedLinkProof.secondSideEffectSendCount, 0);
  assert.equal(report.integratedLinkProof.finalCoreComplete, true);
  assert.equal(report.integratedLinkProof.finalEvidenceComplete, true);
});
