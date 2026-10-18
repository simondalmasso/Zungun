import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { attachLinkEvidence, verifyLinkEvidenceAttachment } from '../packages/link-core/src/proof-extension.js';
import { buildLinkControlRoomView } from '../packages/link-core/src/control-room.js';
import { createLinkDecisionRecord } from '../packages/link-core/src/witness-link.js';
import { canonicalJson } from '../packages/link-core/src/canonical.js';
import { LinkReceiverProxy, type LinkProxyStore } from '../services/receiver/src/link-proxy.js';

const hash=(s:string)=>`sha256:${createHash('sha256').update(s).digest('hex')}`;
function baseBundle() {
  const evidence='[]';
  const body=[{path:'evidence-chain.json',content:evidence,sha256:hash(evidence)}];
  const manifest=canonicalJson({schemaVersion:'zungun-proof-bundle/1',incidentId:'op-proof',objects:body.map(x=>({path:x.path,sha256:x.sha256,redaction:null}))});
  const mf={path:'manifest.json',content:manifest,sha256:hash(manifest)};
  return {schemaVersion:'zungun-proof-bundle/1' as const,incidentId:'op-proof',files:[...body,mf],manifestSha256:mf.sha256};
}
function record(kind:any, certainty:any, requiredEvidenceComplete:boolean, details:Record<string,any>={}) {
  return createLinkDecisionRecord({recordVersion:1,operationId:'op-proof',kind,occurredAtMs:1000+Math.random()*0,planId:'plan-1',snapshotHash:'snap',adapterId:'http',networkKey:null,certainty,coreComplete:true,requiredEvidenceComplete,details});
}

test('Link evidence attaches to Witness Incident Proof Bundle manifest and tamper fails closed',()=>{
  const plan=record('TRANSMISSION_PLAN_CREATED','PLANNED',false,{reasonCodes:'CRITICAL_CORE_FITS,HEAVY_DEFERRED'});
  const deferred=record('HEAVY_OBJECT_DEFERRED','PENDING',false,{bytes:8400000});
  const complete=record('DEFERRED_TRANSFER_COMPLETED','RECEIVED',true,{bytes:8400000});
  const bundle=attachLinkEvidence(baseBundle(),{decisionRecords:[plan,deferred,complete],transportAttempts:[],deferredObjectManifest:[{objectId:'photo',sha256:'abc'}],reconciliation:{state:'RECOVERED'}});
  assert.equal(verifyLinkEvidenceAttachment(bundle).ok,true);
  const tampered={...bundle,files:bundle.files.map(f=>f.path==='link/reconciliation.json'?{...f,content:'{}'}:f)};
  assert.throws(()=>verifyLinkEvidenceAttachment(tampered),/TAMPERED|INVALID/);
});

test('Link proof refuses secret-bearing attachment material',()=>{
  const plan=record('TRANSMISSION_PLAN_CREATED','PLANNED',true,{});
  assert.throws(()=>attachLinkEvidence(baseBundle(),{decisionRecords:[plan],transportAttempts:[{authorization:'Bearer abcdefghijklmnop'}],deferredObjectManifest:[],reconciliation:{state:'ok'}}),/SENSITIVE|SECRET/);
});

test('Control Room never shows complete while required evidence or reconciliation is unresolved',()=>{
  const plan=record('TRANSMISSION_PLAN_CREATED','PLANNED',false,{reasonCodes:'CRITICAL_CORE_FITS,HEAVY_DEFERRED'});
  const deferred=record('HEAVY_OBJECT_DEFERRED','PENDING',false,{});
  const recon=record('RECONCILIATION_STARTED','UNKNOWN',false,{});
  const view=buildLinkControlRoomView({operationId:'op-proof',operationState:'COMPLETED',applicationOutcome:'EFFECT_APPLIED',assuranceTier:'L1_RECEIVER_PROXY',witnessState:'UNKNOWN',records:[plan,deferred,recon]});
  assert.equal(view.complete,false); assert.equal(view.deferredBytesStatus,'PENDING'); assert.equal(view.reconciliationStatus,'REQUIRED');
});

test('Receiver Proxy exposes L1 capability honestly without claiming L2',()=>{
  const records=new Map<string,any>();
  const store:LinkProxyStore={get:(id)=>records.get(id)??null,getByIdempotencyKey:()=>null,insert:(r)=>{records.set(r.operationId,r);return true;},update:(r)=>records.set(r.operationId,r)};
  const proxy=new LinkReceiverProxy([],store,{invoke:async()=>({status:200,headers:{},body:new Uint8Array()})});
  const tiers=proxy.capabilities(1000).assuranceTiers;
  assert.deepEqual(tiers,['L0_LINK_ONLY','L1_RECEIVER_PROXY']); assert.equal(tiers.includes('L2_NATIVE_RECEIVER_EFFECT'),false);
});
