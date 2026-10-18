import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendWitnessEvidence, buildIncidentProofBundle, type WitnessEvidence } from '../packages/protocol-core/src/witness.js';
import { verifyProofBundleFile } from '../tools/resilience-lab/src/verify-proof-bundle.js';

test('offline verifier accepts intact bundle and rejects changed bytes',()=>{const c:WitnessEvidence[]=[]; c.push(appendWitnessEvidence(c,{incidentId:'cli-fixture',evidenceId:'ev1',state:'DETECTED',evidenceClass:'OBSERVED_FACT',emitterId:'sensor:1',authorizationScope:'witness:source',observedAtMs:1,monotonicMs:1,provenance:'test',reasonCode:'DETECTED',claims:{boundaryRole:'SENSOR_OR_SOURCE',sourceId:'sensor:1'}})); const bundle=buildIncidentProofBundle(c); const dir=mkdtempSync(join(tmpdir(),'witness-cli-')); const path=join(dir,'bundle.json'); writeFileSync(path,JSON.stringify(bundle)); assert.equal(verifyProofBundleFile(path).ok,true); const bad={...bundle,manifestSha256:'sha256:'+'0'.repeat(64)}; writeFileSync(path,JSON.stringify(bad)); assert.throws(()=>verifyProofBundleFile(path),/BUNDLE_MANIFEST_TAMPERED/); rmSync(dir,{recursive:true,force:true});});
