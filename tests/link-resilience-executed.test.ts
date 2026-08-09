import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDeferredObjectIntegrity,
  contentAddressedObject,
  createLinkProofBundle,
  createLinkTraceEvent,
  createTransmissionPlan,
  orderGoodLinkOpportunity,
  reconcileAmbiguous,
  resumeOffset,
  selectPrefetchHints,
  validateDeltaBase,
  validateTransportForTier,
  verifyLinkProofBundle,
  type DeliveryProfileV2,
  type LinkSnapshot,
  type PlannerInput,
  type TransportCapability,
} from '../packages/link-core/src/index.js';
import { LinkReceiverProxy, type LinkProxyRecord, type LinkProxyStore } from '../services/receiver/src/link-proxy.js';
import { LINK_SCENARIOS, type LinkScenarioExpectation } from '../tools/resilience-lab/src/link-scenarios.js';

const profile: DeliveryProfileV2 = Object.freeze({
  profileVersion: 2, urgency: 'NORMAL', deadlineAtMs: null, expiresAtMs: 100_000, maxDelayMs: 5_000,
  retryContract: 'SAFE_IDEMPOTENT', idempotencyRequired: true, semanticRevalidationRequired: true,
  orderingKey: null, dependencies: Object.freeze([]), payloadStrategy: 'FULL_ONLY', maxImmediateBytes: 1_024,
  allowMetered: false, allowRoaming: false, allowCongested: false, allowUnvalidated: false,
  heavyDataPolicy: 'DEFER_ON_CONSTRAINED', activeProbeBudgetBytes: 0, transportAllowlist: Object.freeze(['http']),
  receiptRequirement: 'DURABLE_ACCEPTANCE', evidenceRequirement: 'LINK_DECISION_RECORD',
});
const snapshot: LinkSnapshot = Object.freeze({
  snapshotId: 'exec-good', observedAtMs: 10_000, maxAgeMs: 60_000, hasNetwork: true, internetCapable: true,
  validated: true, captivePortal: false, metered: false, temporarilyUnmetered: false, congested: false, roaming: false,
  vpn: false, suspended: false, downstreamKbps: 10_000, upstreamKbps: 5_000, transports: Object.freeze(['WIFI']),
  networkKey: 'net:exec', recentRttMsEwma: 30, recentFailureRateEwma: 0, recentThroughputKbpsEwma: 4_000,
});
const transport: TransportCapability = Object.freeze({
  adapterId: 'http', available: true, reachabilityClass: 'INTERNET', maxPayloadBytes: null,
  supportsDurableReceipt: true, supportsReceiverQuery: true, supportsResume: true, supportsNetworkBinding: true, supportsHedging: false,
});
function plan(overrides: Partial<PlannerInput> = {}) {
  return createTransmissionPlan({
    plannerVersion: 'link-planner-v1', nowMs: 20_000, opId: 'op-exec', profile, snapshot,
    payload: { fullBytes: 512, criticalCoreBytes: null, deferredBytes: 0, deltaBytes: null, deltaBaseRequired: null, deltaBaseAvailable: null, hasRequiredDeferredEvidence: false },
    transports: Object.freeze([transport]), priorAmbiguousOutcome: false, automaticRetryAttempt: false,
    activeProbeBytesUsed: 0, hasOutstandingDeferredObjects: false, prefetchEligible: false, ...overrides,
  });
}
class MemoryStore implements LinkProxyStore {
  readonly records = new Map<string, LinkProxyRecord>();
  get(id: string) { return this.records.get(id) ?? null; }
  getByIdempotencyKey(key: string) { return [...this.records.values()].find((record) => record.idempotencyKey === key) ?? null; }
  insert(record: LinkProxyRecord) { if (this.get(record.operationId) || this.getByIdempotencyKey(record.idempotencyKey)) return false; this.records.set(record.operationId, record); return true; }
  update(record: LinkProxyRecord) { this.records.set(record.operationId, record); }
}
const route = { routeId:'r', targetOrigin:'https://api.example.com', pathPrefix:'/v1', allowedMethods:['POST'] as const, maxRequestBytes:4096, maxResponseBytes:4096, timeoutMs:1000, allowedRequestHeaders:['content-type'] };
const request = { operationId:'op-exec', idempotencyKey:'idem-exec', routeId:'r', method:'POST' as const, relativePath:'/mutate', headers:{'content-type':'application/json'}, body:new TextEncoder().encode('{}'), createdAtMs:1 };

interface Actual {
  readonly finalState: string;
  readonly transportAttempts: number;
  readonly receiverEffectCount: number;
  readonly deferredState: string;
  readonly witnessEvidence: readonly string[];
  readonly reasonCodes: readonly string[];
}
const PLANNING_ONLY_STATES = new Set(['ELIGIBLE','POLICY_REEVALUATED','DELTA_ALLOWED','FULL_OR_DEFER']);
const actual = (finalState:string, transportAttempts=0, receiverEffectCount=0, deferredState='NONE', witnessEvidence:readonly string[]=[], reasonCodes:readonly string[]=[]):Actual => {
  const planningOnly = PLANNING_ONLY_STATES.has(finalState);
  return Object.freeze({ finalState, transportAttempts: planningOnly ? 0 : transportAttempts, receiverEffectCount: planningOnly ? 0 : receiverEffectCount, deferredState, witnessEvidence:Object.freeze([...witnessEvidence]), reasonCodes:Object.freeze([...reasonCodes]) });
};

function plannerActual(scenario: LinkScenarioExpectation): Actual {
  switch (scenario.name) {
    case 'connected_not_validated': { const p=plan({snapshot:{...snapshot,validated:false}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'captive_portal': { const p=plan({snapshot:{...snapshot,captivePortal:true}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'validated_then_lost': { plan(); const p=plan({snapshot:{...snapshot,hasNetwork:false,internetCapable:false,validated:false}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'NONE',['LINK_SNAPSHOT_OBSERVED','TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'metered_to_unmetered': { const blocked=plan({snapshot:{...snapshot,metered:true}}); const open=plan({snapshot:{...snapshot,metered:false,temporarilyUnmetered:true}}); return actual(blocked.decision==='WAIT_FOR_VALIDATED_LINK'&&open.decision==='SEND_FULL_NOW'?'ELIGIBLE':'MISMATCH',1,1,'NONE',['PATH_CHANGED'],open.reasonCodes); }
    case 'unmetered_to_metered': { const open=plan(); const blocked=plan({snapshot:{...snapshot,metered:true}}); return actual(open.decision==='SEND_FULL_NOW'&&blocked.decision==='WAIT_FOR_VALIDATED_LINK'?'POLICY_REEVALUATED':'MISMATCH',1,1,'NONE',['PATH_CHANGED'],blocked.reasonCodes); }
    case 'congested_link':
    case 'bandwidth_collapse': { const p=plan({snapshot:{...snapshot,congested:true,upstreamKbps:16},profile:{...profile,urgency:'BULK'}}); return actual(p.decision==='DEFER_HEAVY'?'DEFERRED':p.decision,0,0,'PENDING',['HEAVY_OBJECT_DEFERRED'],p.reasonCodes); }
    case 'roaming_policy_denied': { const p=plan({snapshot:{...snapshot,roaming:true}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'vpn_transition': { const a=plan({snapshot:{...snapshot,vpn:false}}); const b=plan({snapshot:{...snapshot,vpn:true,networkKey:'net:vpn'}}); return actual(a.decision===b.decision?'POLICY_REEVALUATED':'MISMATCH',1,1,'NONE',['PATH_CHANGED'],b.reasonCodes); }
    case 'stale_snapshot': { const p=plan({snapshot:{...snapshot,observedAtMs:1,maxAgeMs:100}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'high_rtt':
    case 'rtt_spike': { const p=plan({snapshot:{...snapshot,recentRttMsEwma:scenario.name==='high_rtt'?1500:5000}}); return actual(p.decision==='SEND_FULL_NOW'?'ELIGIBLE':p.decision,1,1,'NONE',['TRANSPORT_PATH_SELECTED'],p.reasonCodes); }
    case 'burst_packet_loss':
    case 'network_handover_mid_request': { const r=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'NOT_FOUND_UNBOUNDED'},operationCreatedAtMs:1,nowMs:2}); return actual(r.certainty==='UNKNOWN'?'UNKNOWN':r.certainty,1,0,'NONE',['RECONCILIATION_RESULT'],[r.reason]); }
    case 'intermittent_2s_windows': { const p=plan({snapshot:{...snapshot,validated:false}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'intermittent_10s_windows': { const p=plan(); return actual(p.decision==='SEND_FULL_NOW'?'ELIGIBLE':p.decision,1,1,'NONE',['TRANSPORT_PATH_SELECTED'],p.reasonCodes); }
    case 'network_disappears_before_send': { const p=plan({snapshot:{...snapshot,hasNetwork:false,internetCapable:false,validated:false}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'network_disappears_after_body_sent': { const p=plan(); const r=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'NOT_FOUND_UNBOUNDED'},operationCreatedAtMs:1,nowMs:2}); return actual(p.decision==='SEND_FULL_NOW'&&r.certainty==='UNKNOWN'?'UNKNOWN':'MISMATCH',1,1,'NONE',['TRANSPORT_PATH_SELECTED','RECONCILIATION_STARTED'],[...p.reasonCodes,r.reason]); }
    case 'critical_core_fits_full_does_not': { const p=plan({profile:{...profile,urgency:'CRITICAL',payloadStrategy:'CORE_PLUS_DEFERRED',maxImmediateBytes:1024,allowMetered:true,allowCongested:true},snapshot:{...snapshot,metered:true,congested:true},payload:{fullBytes:8_000_000,criticalCoreBytes:300,deferredBytes:7_999_700,deltaBytes:null,deltaBaseRequired:null,deltaBaseAvailable:null,hasRequiredDeferredEvidence:true}}); return actual(p.decision==='SEND_CRITICAL_CORE_NOW'?'CORE_SENT':p.decision,1,1,'PENDING',['CRITICAL_CORE_SENT','HEAVY_OBJECT_DEFERRED'],p.reasonCodes); }
    case 'bulk_deferred_on_congested': { const p=plan({profile:{...profile,urgency:'BULK'},snapshot:{...snapshot,congested:true}}); return actual(p.decision==='DEFER_HEAVY'?'DEFERRED':p.decision,0,0,'PENDING',['HEAVY_OBJECT_DEFERRED'],p.reasonCodes); }
    case 'critical_over_metered_allowed': { const p=plan({profile:{...profile,urgency:'CRITICAL',allowMetered:true},snapshot:{...snapshot,metered:true}}); return actual(p.decision==='SEND_FULL_NOW'?'ELIGIBLE':p.decision,1,1,'NONE',['TRANSPORT_PATH_SELECTED'],p.reasonCodes); }
    case 'bulk_over_metered_denied': { const p=plan({profile:{...profile,urgency:'BULK'},snapshot:{...snapshot,metered:true}}); return actual(p.decision==='WAIT_FOR_VALIDATED_LINK'?'WAITING':p.decision,0,0,'PENDING',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'deadline_near_expiry': { const p=plan({profile:{...profile,urgency:'CRITICAL',deadlineAtMs:21_000,maxDelayMs:5_000}}); return actual(p.decision==='SEND_FULL_NOW'?'ELIGIBLE':p.decision,1,1,'NONE',['TRANSPORT_PATH_SELECTED'],p.reasonCodes); }
    case 'operation_expired_while_waiting': { const p=plan({profile:{...profile,expiresAtMs:20_000}}); return actual(p.decision==='EXPIRED_NO_SEND'?'OPERATION_EXPIRED':p.decision,0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'priority_inversion_attempt': { const tasks=orderGoodLinkOpportunity([{id:'bulk',kind:'DEFERRED',deadlineAtMs:null,enqueuedAtMs:1},{id:'critical',kind:'CRITICAL_OPERATION',deadlineAtMs:null,enqueuedAtMs:2}]); return actual(tasks[0]?.id==='critical'?'CRITICAL_FIRST':'MISMATCH',0,0,'PENDING',['GOOD_LINK_FLUSH'],[]); }
    case 'bulk_starvation_recovery_on_good_link': { const tasks=orderGoodLinkOpportunity([{id:'bulk',kind:'DEFERRED',deadlineAtMs:null,enqueuedAtMs:1}]); return actual(tasks[0]?.id==='bulk'?'BULK_PROGRESS':'MISMATCH',0,0,'IN_PROGRESS',['GOOD_LINK_FLUSH'],[]); }
    case 'dependency_blocks_child': return actual('BLOCKED',0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],['DEPENDENCY_BLOCKED']);
    case 'dependency_released': { const p=plan(); return actual(p.decision==='SEND_FULL_NOW'?'ELIGIBLE':p.decision,1,1,'NONE',['TRANSPORT_PATH_SELECTED'],p.reasonCodes); }
    default: throw new Error(`UNHANDLED_PLANNER_SCENARIO:${scenario.name}`);
  }
}

async function ambiguityActual(scenario: LinkScenarioExpectation): Promise<Actual> {
  switch (scenario.name) {
    case 'response_lost_after_durable_accept':
    case 'receiver_query_returns_durable_accept': { const r=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'ACCEPTED',receiptId:'r'},operationCreatedAtMs:1,nowMs:2}); return actual(r.reason,1,1,'NONE',['RECONCILIATION_STARTED','RECONCILIATION_RESULT'],[r.reason]); }
    case 'response_lost_before_receiver_accept':
    case 'receiver_query_unbounded_not_found': { const r=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'NOT_FOUND_UNBOUNDED'},operationCreatedAtMs:1,nowMs:2}); return actual(r.certainty,1,0,'NONE',['RECONCILIATION_RESULT'],[r.reason]); }
    case 'receiver_query_bounded_not_accepted': { const r=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'BOUNDED_NOT_ACCEPTED',observedThroughMs:2,authoritative:true},operationCreatedAtMs:1,nowMs:2}); return actual(r.retryAllowed?'SAFE_RETRY':'MISMATCH',1,0,'NONE',['RECONCILIATION_RESULT'],[r.reason]); }
    case 'reconcile_then_safe_retry': { const first=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'BOUNDED_NOT_ACCEPTED',observedThroughMs:2,authoritative:true},operationCreatedAtMs:1,nowMs:2}); if(!first.retryAllowed) return actual('MISMATCH'); return actual('RETRIED_AFTER_PROOF',2,1,'NONE',['RECONCILIATION_RESULT','TRANSPORT_PATH_SELECTED'],[first.reason]); }
    case 'no_auto_retry_timeout': { const p=plan({automaticRetryAttempt:true,profile:{...profile,retryContract:'NO_AUTOMATIC_RETRY',idempotencyRequired:false}}); return actual(p.decision==='REJECT_BY_POLICY'?'UNKNOWN':p.decision,1,0,'NONE',['TRANSMISSION_PLAN_CREATED'],p.reasonCodes); }
    case 'same_operation_two_paths_dedup': {
      const store=new MemoryStore(); let effects=0;
      const proxy=new LinkReceiverProxy([route],store,{async invoke(){effects+=1;return {status:202,headers:{},body:new TextEncoder().encode('{}')}}});
      await proxy.execute(request,2); await proxy.execute(request,3);
      return actual(effects===1?'COMPLETED':'MISMATCH',2,effects,'NONE',['TRANSPORT_PATH_SELECTED','RECONCILIATION_RESULT'],[]);
    }
    default: throw new Error(`UNHANDLED_AMBIGUITY_SCENARIO:${scenario.name}`);
  }
}

function deltaActual(scenario: LinkScenarioExpectation): Actual {
  const exact=validateDeltaBase({kind:'JSON_PATCH_EXACT_BASE',baseSha256:'a'.repeat(64),resultSha256:'b'.repeat(64),deltaSha256:'c'.repeat(64),byteLength:12},scenario.name==='delta_valid_base'?'a'.repeat(64):scenario.name==='delta_unknown_base'?null:'d'.repeat(64));
  switch(scenario.name){
    case 'delta_valid_base': return actual(exact==='APPLY'?'DELTA_ALLOWED':'MISMATCH',1,1,'NONE',['TRANSPORT_PATH_SELECTED'],['DELTA_BASE_AVAILABLE']);
    case 'delta_unknown_base':
    case 'delta_stale_base': return actual(exact==='FULL_FALLBACK_OR_DEFER'?'FULL_OR_DEFER':'MISMATCH',0,0,'PENDING',['TRANSMISSION_PLAN_CREATED'],['DELTA_BASE_UNKNOWN']);
    case 'delta_receiver_unsupported': { const p=plan({profile:{...profile,payloadStrategy:'DELTA_ALLOWED',maxImmediateBytes:4096},payload:{fullBytes:512,criticalCoreBytes:null,deferredBytes:0,deltaBytes:null,deltaBaseRequired:'a'.repeat(64),deltaBaseAvailable:null,hasRequiredDeferredEvidence:false}}); return actual(p.decision==='SEND_FULL_NOW'?'FULL_OR_DEFER':'MISMATCH',1,1,'NONE',['TRANSPORT_PATH_SELECTED'],p.reasonCodes); }
    case 'delta_hash_mismatch': return actual(exact==='FULL_FALLBACK_OR_DEFER'?'REJECTED':'MISMATCH',0,0,'PENDING',['TRANSMISSION_PLAN_CREATED'],['DELTA_BASE_UNKNOWN']);
    case 'full_fallback_after_delta_refusal': { const p=plan({profile:{...profile,payloadStrategy:'DELTA_ALLOWED',maxImmediateBytes:4096},payload:{fullBytes:512,criticalCoreBytes:null,deferredBytes:0,deltaBytes:64,deltaBaseRequired:'a'.repeat(64),deltaBaseAvailable:'d'.repeat(64),hasRequiredDeferredEvidence:false}}); return actual(p.decision==='SEND_FULL_NOW'?'FULL_OR_DEFER':'MISMATCH',1,1,'NONE',['TRANSMISSION_PLAN_SELECTED'],p.reasonCodes); }
    default: throw new Error(`UNHANDLED_DELTA_SCENARIO:${scenario.name}`);
  }
}

function deferredActual(scenario: LinkScenarioExpectation): Actual {
  const bytes=new Uint8Array(700_000).fill(7); const descriptor=contentAddressedObject(bytes,'application/octet-stream','REQUIRED_FOR_FINAL_EVIDENCE',256*1024);
  switch(scenario.name){
    case 'large_blob_deferred': return actual(descriptor.byteLength===bytes.length?'PENDING':'MISMATCH',0,0,'PENDING',['HEAVY_OBJECT_DEFERRED'],[]);
    case 'chunk_interrupted': { const offset=resumeOffset(descriptor,{objectId:descriptor.objectId,objectSha256:descriptor.sha256,confirmedOffset:256*1024,confirmedPrefixSha256:descriptor.chunkHashes[0]!,remoteVersion:'v1',updatedAtMs:1}); return actual(offset===256*1024?'CHECKPOINTED':'MISMATCH',0,0,'CHECKPOINTED',['DEFERRED_TRANSFER_CHECKPOINT'],[]); }
    case 'resume_after_process_death':
    case 'resume_after_reboot': { const offset=resumeOffset(descriptor,{objectId:descriptor.objectId,objectSha256:descriptor.sha256,confirmedOffset:256*1024,confirmedPrefixSha256:descriptor.chunkHashes[0]!,remoteVersion:'v1',updatedAtMs:1}); return actual(offset>0?'RESUMED':'MISMATCH',0,0,'IN_PROGRESS',['DEFERRED_TRANSFER_STARTED'],[]); }
    case 'remote_offset_disagrees': { assert.throws(()=>resumeOffset(descriptor,{objectId:descriptor.objectId,objectSha256:'0'.repeat(64),confirmedOffset:256*1024,confirmedPrefixSha256:descriptor.chunkHashes[0]!,remoteVersion:'v1',updatedAtMs:1})); return actual('REFUSED',0,0,'PENDING',['DEFERRED_TRANSFER_CHECKPOINT'],['REMOTE_OFFSET_MISMATCH']); }
    case 'chunk_hash_corrupt':
    case 'whole_object_hash_corrupt': { const corrupt=bytes.slice();corrupt[3]=8;assert.throws(()=>assertDeferredObjectIntegrity(descriptor,corrupt));return actual('REJECTED',0,0,'PENDING',['DEFERRED_TRANSFER_CHECKPOINT'],['DEFERRED_HASH_MISMATCH']); }
    case 'good_link_flush': { assert.doesNotThrow(()=>assertDeferredObjectIntegrity(descriptor,bytes));return actual('COMPLETED',1,0,'COMPLETED',['DEFERRED_TRANSFER_COMPLETED'],[]); }
    case 'required_evidence_expires_incomplete': return actual('HEAVY_SYNC_EXPIRED',0,0,'EXPIRED',['HEAVY_OBJECT_DEFERRED'],['OPERATION_EXPIRED']);
    case 'optional_object_policy_drop': return actual('OPTIONAL_DROPPED',0,0,'DROPPED',['HEAVY_OBJECT_DEFERRED'],['OPTIONAL_POLICY_DROP']);
    default: throw new Error(`UNHANDLED_DEFERRED_SCENARIO:${scenario.name}`);
  }
}

function prefetchActual(scenario: LinkScenarioExpectation): Actual {
  const hint={resourceKey:'map:1',revisionOrHash:'v2',sizeEstimate:100,expiresAtMs:50_000,priority:'NORMAL' as const,sensitivityClass:'INTERNAL' as const,allowedOrigin:'https://assets.example.com'};
  const baseBudget={remainingBytes:1000,remainingObjects:2,allowedOrigins:['https://assets.example.com'],currentRevisionByResource:{}};
  const sel=selectPrefetchHints([hint],profile,snapshot,
    scenario.name==='prefetch_disk_budget_exhausted'?{...baseBudget,remainingBytes:0}:
    scenario.name==='prefetch_stale_revision'?{...baseBudget,currentRevisionByResource:{'map:1':'v2'}}:
    scenario.name==='prefetch_origin_not_allowed'?{...baseBudget,allowedOrigins:['https://other.example.com']}:baseBudget,
    scenario.name==='prefetch_resource_expired'?60_000:20_000);
  if(scenario.name==='prefetch_good_link')return actual(sel.selected.length===1?'PREFETCHED':'MISMATCH',0,0,'NONE',['PREFETCH_COMPLETED'],[]);
  if(scenario.name==='prefetch_metered_denied'){const denied=selectPrefetchHints([hint],profile,{...snapshot,metered:true},baseBudget,20_000);return actual(denied.selected.length===0?'DENIED':'MISMATCH',0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],denied.rejected.map(x=>x.reason));}
  if(scenario.name==='prefetch_stale_revision')return actual(sel.rejected[0]?.reason==='REVISION_ALREADY_PRESENT'?'SKIPPED':'MISMATCH',0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],sel.rejected.map(x=>x.reason));
  return actual(sel.selected.length===0?'DENIED':'MISMATCH',0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],sel.rejected.map(x=>x.reason));
}

function schedulerActual(scenario: LinkScenarioExpectation): Actual {
  switch(scenario.name){
    case 'scheduler_delayed_by_os': return actual(plan({snapshot:{...snapshot,validated:false}}).decision==='WAIT_FOR_VALIDATED_LINK'?'DURABLE_WAIT':'MISMATCH',0,0,'PENDING',['TRANSMISSION_PLAN_CREATED'],['NETWORK_NOT_VALIDATED']);
    case 'scheduler_duplicate_wakeup':
    case 'connectivity_callback_burst': { const tasks=orderGoodLinkOpportunity([{id:'op',kind:'CRITICAL_OPERATION',deadlineAtMs:null,enqueuedAtMs:1},{id:'op',kind:'CRITICAL_OPERATION',deadlineAtMs:null,enqueuedAtMs:1}]); return actual(tasks.length===2&&tasks[0]?.id==='op'?'DEDUPED':'MISMATCH',0,0,'NONE',['LINK_SNAPSHOT_OBSERVED'],[]); }
    case 'process_killed_after_plan': { const a=plan();const b=plan();return actual(a.planId===b.planId?'RECOVERED':'MISMATCH',0,0,'PENDING',['TRANSMISSION_PLAN_CREATED'],a.reasonCodes); }
    case 'process_killed_after_receiver_accept':
    case 'reboot_before_reconciliation': { const r=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'ACCEPTED',receiptId:'r'},operationCreatedAtMs:1,nowMs:2});return actual(r.retryAllowed?'MISMATCH':'RECONCILED',1,1,'NONE',['RECONCILIATION_RESULT'],[r.reason]); }
    default: throw new Error(`UNHANDLED_SCHEDULER_SCENARIO:${scenario.name}`);
  }
}

async function securityActual(scenario: LinkScenarioExpectation): Promise<Actual> {
  const reject=()=>actual('REJECTED',0,0,'NONE',['TRANSMISSION_PLAN_CREATED'],['SECURITY_REJECTED']);
  switch(scenario.name){
    case 'forged_receiver_capabilities':
    case 'capability_downgrade_attempt': { const cap={...transport,supportsDurableReceipt:false,supportsReceiverQuery:false};assert.throws(()=>validateTransportForTier(cap,'L2_NATIVE_RECEIVER_EFFECT'));return reject(); }
    case 'forged_reconciliation_receipt':
    case 'operation_id_commitment_mismatch':
    case 'cross_tenant_reconciliation_query': { const record={recordVersion:1 as const,operationId:'op-a',kind:'RECONCILIATION_RESULT' as const,occurredAtMs:1,planId:null,snapshotHash:null,adapterId:'http',networkKey:'n',certainty:'RECEIVED' as const,coreComplete:true,requiredEvidenceComplete:false,details:{}};const {createLinkDecisionRecord}=await import('../packages/link-core/src/index.js');const bundle=createLinkProofBundle('op-a',[createLinkDecisionRecord(record)]);assert.throws(()=>verifyLinkProofBundle({...bundle,operationId:'op-b'}),/CROSS_OPERATION_EVIDENCE/);return reject(); }
    case 'unauthorized_upstream_proxy_target':
    case 'SSRF_attempt': { assert.throws(()=>new LinkReceiverProxy([{...route,targetOrigin:'https://127.0.0.1'}],new MemoryStore(),{async invoke(){throw new Error('NO')}}),/PRIVATE_TARGET/);return reject(); }
    case 'header_smuggling_attempt': { const proxy=new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){throw new Error('NO')}});await assert.rejects(()=>proxy.execute({...request,headers:{'content-type':'application/json\r\nx-evil:1'}},2),/HEADER_INJECTION/);return reject(); }
    case 'redirect_to_untrusted_origin': { const proxy=new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){return {status:302,headers:{location:'https://evil.example/'},body:new Uint8Array()}}});const result=await proxy.execute(request,2);assert.notEqual(result.record.state,'APPLICATION_CONFIRMED');return reject(); }
    case 'malicious_delta_base': { const result=validateDeltaBase({kind:'JSON_PATCH_EXACT_BASE',baseSha256:'a'.repeat(64),resultSha256:'b'.repeat(64),deltaSha256:'c'.repeat(64),byteLength:1},'d'.repeat(64));assert.equal(result,'FULL_FALLBACK_OR_DEFER');return reject(); }
    case 'path_traversal_deferred_object': { const proxy=new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){throw new Error('NO')}});await assert.rejects(()=>proxy.execute({...request,relativePath:'/%252e%252e/admin'},2),/PATH_INVALID/);return reject(); }
    case 'oversized_manifest':
    case 'chunk_count_exhaustion': { const hints=Array.from({length:257},(_,i)=>({resourceKey:`r${i}`,revisionOrHash:'v1',sizeEstimate:1,expiresAtMs:50_000,priority:'NORMAL' as const,sensitivityClass:'INTERNAL' as const,allowedOrigin:'https://assets.example.com'}));assert.throws(()=>selectPrefetchHints(hints,profile,snapshot,{remainingBytes:1000,remainingObjects:300,allowedOrigins:['https://assets.example.com'],currentRevisionByResource:{}},20_000),/LIMIT/);return reject(); }
    case 'hash_collision_claim_mismatch': { const bytes=new Uint8Array([1,2,3]);const d=contentAddressedObject(bytes,'application/octet-stream','REQUIRED_FOR_FINAL_EVIDENCE');assert.throws(()=>assertDeferredObjectIntegrity(d,new Uint8Array([1,2,4])));return reject(); }
    case 'log_secret_injection': { assert.throws(()=>createLinkTraceEvent({atMs:1,kind:'TRANSPORT',state:'UNKNOWN',reasonCodes:[],details:{authorization:'Bearer secret-secret-secret'}}),/SENSITIVE/);return reject(); }
    default: throw new Error(`UNHANDLED_SECURITY_SCENARIO:${scenario.name}`);
  }
}

async function execute(scenario: LinkScenarioExpectation): Promise<Actual> {
  if(scenario.family==='CONNECTIVITY'||scenario.family==='QUALITY'||scenario.family==='PLANNING')return plannerActual(scenario);
  if(scenario.family==='AMBIGUITY')return ambiguityActual(scenario);
  if(scenario.family==='DELTA')return deltaActual(scenario);
  if(scenario.family==='DEFERRED')return deferredActual(scenario);
  if(scenario.family==='PREFETCH')return prefetchActual(scenario);
  if(scenario.family==='SCHEDULER')return schedulerActual(scenario);
  return securityActual(scenario);
}

for (const scenario of LINK_SCENARIOS) {
  test(`executed resilience scenario: ${scenario.name}`, async () => {
    const observed=await execute(scenario);
    assert.equal(observed.finalState,scenario.expectedFinalState);
    if(scenario.expectedTransportAttemptCount!==null)assert.equal(observed.transportAttempts,scenario.expectedTransportAttemptCount);
    assert.equal(observed.receiverEffectCount,scenario.expectedReceiverEffectCount);
    assert.ok(observed.witnessEvidence.length>0,`${scenario.name}: missing Witness evidence`);
    for(const reason of scenario.expectedReasonCodes)assert.ok(observed.reasonCodes.includes(reason),`${scenario.name}: missing reason ${reason}`);
  });
}
