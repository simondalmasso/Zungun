import assert from 'node:assert/strict';
import test from 'node:test';
import { runLinkBlackoutDrill } from '../tools/resilience-lab/src/link-blackout-drill.js';
test('Blackout Drill preserves one business effect and resumes required evidence',()=>{const r=runLinkBlackoutDrill();assert.equal(r.businessEffectCount,1);assert.equal(r.secondSideEffectSendCount,0);assert.equal(r.finalCoreComplete,true);assert.equal(r.finalEvidenceComplete,true);assert.equal(r.proofManifestSha256.length,64);});
