import { mkdirSync, writeFileSync } from 'node:fs';
import { runLinkBlackoutDrill } from './link-blackout-drill.js';
const out = '.artifacts/link'; mkdirSync(out,{recursive:true});
const result = await runLinkBlackoutDrill();
writeFileSync(`${out}/blackout-proof-bundle.json`, `${JSON.stringify(result.proofBundle,null,2)}\n`);
writeFileSync(`${out}/blackout-result.json`, `${JSON.stringify({
  operationId:result.operationId,
  businessEffectCount:result.businessEffectCount,
  secondSideEffectSendCount:result.secondSideEffectSendCount,
  transportAttemptCount:result.transportAttemptCount,
  reconciliationQueryCount:result.reconciliationQueryCount,
  deferredTransportAttemptCount:result.deferredTransportAttemptCount,
  deferredRuntimeReopenCount:result.deferredRuntimeReopenCount,
  deferredCheckpointOffset:result.deferredCheckpointOffset,
  deferredPersistentState:result.deferredPersistentState,
  finalCoreComplete:result.finalCoreComplete,
  finalEvidenceComplete:result.finalEvidenceComplete,
  proofManifestSha256:result.proofManifestSha256,
},null,2)}\n`);
