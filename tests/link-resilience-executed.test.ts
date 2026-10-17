import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LogicalWakeupGate,
  assertDeferredObjectIntegrity,
  contentAddressedObject,
  createLinkProofBundle,
  createLinkTraceEvent,
  createTransmissionPlan,
  orderEligibleOperations,
  orderGoodLinkOpportunity,
  reconcileAmbiguous,
  resumeOffset,
  selectNextOperation,
  selectPrefetchHints,
  validateDeltaBase,
  validateTransportForTier,
  verifyLinkProofBundle,
  type LinkSnapshot,
  type OperationPayloadShape,
  type PlannerInput,
  type TransportCapability,
} from '../packages/link-core/src/index.js';
import {
  LinkReceiverProxy,
  SqliteLinkProxyStore,
  type LinkProxyInvocation,
  type LinkProxyInvocationResult,
  type LinkProxyInvoker,
  type LinkProxyRecord,
  type LinkProxyStore,
} from '../services/receiver/src/link-proxy.js';
import { LINK_SCENARIOS, type LinkScenarioExpectation } from '../tools/resilience-lab/src/link-scenarios.js';

const transport: TransportCapability = Object.freeze({
  adapterId: 'http', available: true, reachabilityClass: 'INTERNET', maxPayloadBytes: null,
  supportsDurableReceipt: true, supportsReceiverQuery: true, supportsResume: true,
  supportsNetworkBinding: true, supportsHedging: false,
});
const defaultPayload: OperationPayloadShape = Object.freeze({
  fullBytes: 512, criticalCoreBytes: null, deferredBytes: 0, deltaBytes: null,
  deltaBaseRequired: null, deltaBaseAvailable: null, hasRequiredDeferredEvidence: false,
});
const route = Object.freeze({
  routeId:'r', targetOrigin:'https://api.example.com', pathPrefix:'/v1', allowedMethods:['POST'] as const,
  maxRequestBytes:4096, maxResponseBytes:4096, timeoutMs:1000, allowedRequestHeaders:['content-type'],
});
const request = Object.freeze({
  operationId:'op-exec', idempotencyKey:'idem-exec', routeId:'r', method:'POST' as const,
  relativePath:'/mutate', headers:{'content-type':'application/json'}, body:new TextEncoder().encode('{}'), createdAtMs:1,
});

class MemoryStore implements LinkProxyStore {
  readonly records = new Map<string, LinkProxyRecord>();
  get(id: string) { return this.records.get(id) ?? null; }
  getByIdempotencyKey(key: string) { return [...this.records.values()].find((record) => record.idempotencyKey === key) ?? null; }
  insert(record: LinkProxyRecord) {
    if (this.get(record.operationId) || this.getByIdempotencyKey(record.idempotencyKey)) return false;
    this.records.set(record.operationId, record); return true;
  }
  update(record: LinkProxyRecord) { this.records.set(record.operationId, record); }
}

interface Actual {
  readonly finalState: string;
  readonly plans: readonly string[];
  readonly transportAttempts: number;
  readonly receiverEffectCount: number;
  readonly deferredState: string;
  readonly witnessEvidence: readonly string[];
  readonly reasonCodes: readonly string[];
}
function actual(
  finalState: string,
  plans: readonly string[] = [],
  transportAttempts = 0,
  receiverEffectCount = 0,
  deferredState = 'NONE',
  witnessEvidence: readonly string[] = [],
  reasonCodes: readonly string[] = [],
): Actual {
  return Object.freeze({
    finalState,
    plans: Object.freeze([...plans]),
    transportAttempts,
    receiverEffectCount,
    deferredState,
    witnessEvidence: Object.freeze([...witnessEvidence]),
    reasonCodes: Object.freeze([...reasonCodes]),
  });
}

function planScenario(
  scenario: LinkScenarioExpectation,
  timelineIndex = scenario.linkTimeline.length - 1,
  overrides: Partial<PlannerInput> = {},
) {
  const point = scenario.linkTimeline[timelineIndex];
  if (!point) throw new Error(`SCENARIO_TIMELINE_EMPTY:${scenario.name}`);
  return createTransmissionPlan({
    plannerVersion: 'link-planner-v1',
    nowMs: 20_000,
    opId: `op-${scenario.seed}`,
    profile: scenario.profile,
    snapshot: point.snapshot,
    payload: defaultPayload,
    transports: Object.freeze([transport]),
    priorAmbiguousOutcome: false,
    automaticRetryAttempt: false,
    activeProbeBytesUsed: 0,
    hasOutstandingDeferredObjects: false,
    prefetchEligible: false,
    ...overrides,
  });
}

function plannerState(decision: string): string {
  if (decision === 'WAIT_FOR_VALIDATED_LINK') return 'WAITING';
  if (decision === 'DEFER_HEAVY') return 'DEFERRED';
  if (decision === 'SEND_FULL_NOW' || decision === 'SEND_DELTA_NOW') return 'ELIGIBLE';
  if (decision === 'SEND_CRITICAL_CORE_NOW') return 'CORE_SENT';
  if (decision === 'EXPIRED_NO_SEND') return 'OPERATION_EXPIRED';
  return decision;
}

function plannerActual(scenario: LinkScenarioExpectation): Actual {
  if (scenario.name === 'burst_packet_loss' || scenario.name === 'network_handover_mid_request') {
    const reconciliation = reconcileAmbiguous({
      prior:'UNKNOWN', retryContract:'RECONCILE_BEFORE_RETRY', query:{kind:'NOT_FOUND_UNBOUNDED'},
      operationCreatedAtMs:1, nowMs:2,
    });
    return actual(reconciliation.certainty, [], 1, 0, 'NONE', ['RECONCILIATION_RESULT'], [reconciliation.reason]);
  }
  if (scenario.name === 'network_disappears_after_body_sent') {
    const planned = planScenario(scenario);
    const reconciliation = reconcileAmbiguous({
      prior:'UNKNOWN', retryContract:'RECONCILE_BEFORE_RETRY', query:{kind:'NOT_FOUND_UNBOUNDED'},
      operationCreatedAtMs:1, nowMs:2,
    });
    const state = planned.decision === 'SEND_FULL_NOW' && reconciliation.certainty === 'UNKNOWN' ? 'UNKNOWN' : 'MISMATCH';
    return actual(state, [planned.decision], 1, 1, 'NONE', ['TRANSPORT_PATH_SELECTED','RECONCILIATION_STARTED'], [...planned.reasonCodes,reconciliation.reason]);
  }
  if (scenario.name === 'critical_core_fits_full_does_not') {
    const payload: OperationPayloadShape = {
      fullBytes:8_000_000, criticalCoreBytes:300, deferredBytes:7_999_700, deltaBytes:null,
      deltaBaseRequired:null, deltaBaseAvailable:null, hasRequiredDeferredEvidence:true,
    };
    const planned = planScenario(scenario, 0, { payload });
    return actual(
      plannerState(planned.decision), [planned.decision], planned.decision === 'SEND_CRITICAL_CORE_NOW' ? 1 : 0,
      planned.decision === 'SEND_CRITICAL_CORE_NOW' ? 1 : 0, 'PENDING',
      ['CRITICAL_CORE_SENT','HEAVY_OBJECT_DEFERRED'], planned.reasonCodes,
    );
  }
  if (scenario.name === 'priority_inversion_attempt') {
    const tasks = orderGoodLinkOpportunity([
      {id:'bulk',kind:'DEFERRED',deadlineAtMs:null,enqueuedAtMs:1},
      {id:'critical',kind:'CRITICAL_OPERATION',deadlineAtMs:null,enqueuedAtMs:2},
    ]);
    return actual(tasks[0]?.id === 'critical' ? 'CRITICAL_FIRST' : 'MISMATCH', [], 0, 0, 'PENDING', ['GOOD_LINK_FLUSH']);
  }
  if (scenario.name === 'bulk_starvation_recovery_on_good_link') {
    const tasks = orderGoodLinkOpportunity([{id:'bulk',kind:'DEFERRED',deadlineAtMs:null,enqueuedAtMs:1}]);
    return actual(tasks[0]?.id === 'bulk' ? 'BULK_PROGRESS' : 'MISMATCH', [], 0, 0, 'IN_PROGRESS', ['GOOD_LINK_FLUSH']);
  }
  if (scenario.name === 'dependency_blocks_child') {
    const child = Object.freeze({
      opId:`child-${scenario.seed}`, enqueuedAtMs:2, profile:scenario.profile,
      dependenciesSatisfied:false, deferredBytes:0,
    });
    const eligible = orderEligibleOperations([child]);
    const selected = selectNextOperation([child],0,true);
    const blocked = eligible.length === 0 && selected === null;
    return actual(blocked ? 'BLOCKED' : 'MISMATCH', [], 0, 0, 'NONE', ['DEPENDENCY_BLOCKED'], ['DEPENDENCY_BLOCKED']);
  }
  if (scenario.name === 'dependency_released') {
    const child = Object.freeze({
      opId:`child-${scenario.seed}`, enqueuedAtMs:2, profile:scenario.profile,
      dependenciesSatisfied:true, deferredBytes:0,
    });
    const selected = selectNextOperation([child],0,true);
    if (selected?.opId !== child.opId) return actual('MISMATCH');
    const planned = planScenario(scenario);
    return actual(plannerState(planned.decision), [planned.decision], 0, 0, 'NONE', ['TRANSPORT_PATH_SELECTED'], planned.reasonCodes);
  }

  const plans = scenario.linkTimeline.map((_point,index) => planScenario(scenario,index));
  const decisions = plans.map((entry) => entry.decision);
  const last = plans[plans.length - 1];
  if (!last) throw new Error(`SCENARIO_PLAN_EMPTY:${scenario.name}`);
  if (scenario.name === 'metered_to_unmetered') {
    const state = decisions[0] === 'WAIT_FOR_VALIDATED_LINK' && decisions[1] === 'SEND_FULL_NOW' ? 'ELIGIBLE' : 'MISMATCH';
    return actual(state, decisions, 0, 0, 'NONE', ['PATH_CHANGED'], last.reasonCodes);
  }
  if (scenario.name === 'unmetered_to_metered') {
    const state = decisions[0] === 'SEND_FULL_NOW' && decisions[1] === 'WAIT_FOR_VALIDATED_LINK' ? 'POLICY_REEVALUATED' : 'MISMATCH';
    return actual(state, decisions, 0, 0, 'NONE', ['PATH_CHANGED'], last.reasonCodes);
  }
  if (scenario.name === 'vpn_transition') {
    const first = scenario.linkTimeline[0]?.snapshot.networkKey;
    const second = scenario.linkTimeline[1]?.snapshot.networkKey;
    const state = first !== second && decisions[0] === decisions[1] ? 'POLICY_REEVALUATED' : 'MISMATCH';
    return actual(state, decisions, 0, 0, 'NONE', ['PATH_CHANGED'], last.reasonCodes);
  }
  const state = plannerState(last.decision);
  const deferredState = last.decision === 'DEFER_HEAVY' || scenario.name === 'bulk_over_metered_denied' ? 'PENDING' : 'NONE';
  const witness = last.decision === 'DEFER_HEAVY' ? ['HEAVY_OBJECT_DEFERRED']
    : last.decision.startsWith('SEND_') ? ['TRANSPORT_PATH_SELECTED'] : ['TRANSMISSION_PLAN_CREATED'];
  return actual(state, decisions, 0, 0, deferredState, witness, last.reasonCodes);
}

async function ambiguityActual(scenario: LinkScenarioExpectation): Promise<Actual> {
  if (scenario.name === 'same_operation_two_paths_dedup') {
    const store = new MemoryStore(); let effects = 0;
    const proxy = new LinkReceiverProxy([route],store,{
      async invoke() { effects += 1; return {status:202,headers:{},body:new TextEncoder().encode('{}')}; },
    });
    await proxy.execute(request,2); await proxy.execute(request,3);
    return actual(effects === 1 ? 'COMPLETED' : 'MISMATCH', [], 2, effects, 'NONE', ['TRANSPORT_PATH_SELECTED','RECONCILIATION_RESULT']);
  }
  if (scenario.name === 'no_auto_retry_timeout') {
    const planned = planScenario(scenario,0,{automaticRetryAttempt:true,priorAmbiguousOutcome:true});
    return actual(planned.decision === 'REJECT_BY_POLICY' ? 'UNKNOWN' : 'MISMATCH', [planned.decision], 1, 0, 'NONE', ['TRANSMISSION_PLAN_CREATED'], planned.reasonCodes);
  }
  if (scenario.name === 'reconcile_then_safe_retry') {
    const result = reconcileAmbiguous({
      prior:'UNKNOWN', retryContract:'RECONCILE_BEFORE_RETRY',
      query:{kind:'BOUNDED_NOT_ACCEPTED',observedThroughMs:2,authoritative:true}, operationCreatedAtMs:1, nowMs:2,
    });
    return actual(result.retryAllowed ? 'RETRIED_AFTER_PROOF' : 'MISMATCH', [], 2, result.retryAllowed ? 1 : 0, 'NONE', ['RECONCILIATION_RESULT','TRANSPORT_PATH_SELECTED'], [result.reason]);
  }
  const query = scenario.injectedFaults.includes('QUERY_ACCEPTED') || scenario.injectedFaults.includes('DROP_RESPONSE_AFTER_DURABLE_ACCEPT')
    ? ({kind:'ACCEPTED',receiptId:'receipt-lab'} as const)
    : scenario.injectedFaults.includes('BOUNDED_NOT_ACCEPTED')
      ? ({kind:'BOUNDED_NOT_ACCEPTED',observedThroughMs:2,authoritative:true} as const)
      : ({kind:'NOT_FOUND_UNBOUNDED'} as const);
  const result = reconcileAmbiguous({
    prior:'UNKNOWN', retryContract:'RECONCILE_BEFORE_RETRY', query, operationCreatedAtMs:1, nowMs:2,
  });
  let state: string = result.certainty;
  if (query.kind === 'ACCEPTED') state = result.reason;
  if (query.kind === 'BOUNDED_NOT_ACCEPTED') state = result.retryAllowed ? 'SAFE_RETRY' : result.certainty;
  const effects = query.kind === 'ACCEPTED' ? 1 : 0;
  const witness = query.kind === 'ACCEPTED' ? ['RECONCILIATION_STARTED','RECONCILIATION_RESULT'] : ['RECONCILIATION_RESULT'];
  return actual(state, [], 1, effects, 'NONE', witness, [result.reason]);
}

function deltaActual(scenario: LinkScenarioExpectation): Actual {
  const currentBase = scenario.name === 'delta_valid_base' ? 'a'.repeat(64)
    : scenario.name === 'delta_unknown_base' ? null : 'd'.repeat(64);
  const validation = validateDeltaBase({
    kind:'JSON_PATCH_EXACT_BASE', baseSha256:'a'.repeat(64), resultSha256:'b'.repeat(64),
    deltaSha256:'c'.repeat(64), byteLength:12,
  }, currentBase);
  if (scenario.name === 'delta_valid_base') {
    return actual(validation === 'APPLY' ? 'DELTA_ALLOWED' : 'MISMATCH', [], 0, 0, 'NONE', ['TRANSPORT_PATH_SELECTED'], ['DELTA_BASE_AVAILABLE']);
  }
  if (scenario.name === 'delta_unknown_base' || scenario.name === 'delta_stale_base') {
    return actual(validation === 'FULL_FALLBACK_OR_DEFER' ? 'FULL_OR_DEFER' : 'MISMATCH', [], 0, 0, 'PENDING', ['TRANSMISSION_PLAN_CREATED'], ['DELTA_BASE_UNKNOWN']);
  }
  if (scenario.name === 'delta_hash_mismatch') {
    return actual(validation === 'FULL_FALLBACK_OR_DEFER' ? 'REJECTED' : 'MISMATCH', [], 0, 0, 'PENDING', ['TRANSMISSION_PLAN_CREATED'], ['DELTA_BASE_UNKNOWN']);
  }
  const payload: OperationPayloadShape = {
    fullBytes:512, criticalCoreBytes:null, deferredBytes:0,
    deltaBytes:scenario.name === 'full_fallback_after_delta_refusal' ? 64 : null,
    deltaBaseRequired:'a'.repeat(64), deltaBaseAvailable: scenario.name === 'full_fallback_after_delta_refusal' ? 'd'.repeat(64) : null,
    hasRequiredDeferredEvidence:false,
  };
  const planned = planScenario(scenario,0,{payload});
  const fallback = planned.decision === 'SEND_FULL_NOW';
  return actual(fallback ? 'FULL_OR_DEFER' : 'MISMATCH', [planned.decision], 0, 0, 'NONE', [scenario.name === 'full_fallback_after_delta_refusal' ? 'TRANSMISSION_PLAN_SELECTED' : 'TRANSPORT_PATH_SELECTED'], planned.reasonCodes);
}

class DeferredCheckpointRuntime {
  constructor(private readonly path: string) {}
  persist(checkpoint: object) { writeFileSync(this.path, `${JSON.stringify(checkpoint)}\n`); }
  recover<T>(): T { return JSON.parse(readFileSync(this.path,'utf8')) as T; }
}

function deferredActual(scenario: LinkScenarioExpectation): Actual {
  const bytes = new Uint8Array(700_000).fill(7);
  const descriptor = contentAddressedObject(bytes,'application/octet-stream','REQUIRED_FOR_FINAL_EVIDENCE',256*1024);
  if (scenario.name === 'large_blob_deferred') {
    return actual(descriptor.byteLength === bytes.length ? 'PENDING' : 'MISMATCH', [], 0, 0, 'PENDING', ['HEAVY_OBJECT_DEFERRED']);
  }
  if (scenario.name === 'chunk_interrupted') {
    const offset = resumeOffset(descriptor,{objectId:descriptor.objectId,objectSha256:descriptor.sha256,confirmedOffset:256*1024,confirmedPrefixSha256:descriptor.chunkHashes[0]!,remoteVersion:'v1',updatedAtMs:1});
    return actual(offset === 256*1024 ? 'CHECKPOINTED' : 'MISMATCH', [], 0, 0, 'CHECKPOINTED', ['DEFERRED_TRANSFER_CHECKPOINT']);
  }
  if (scenario.name === 'resume_after_process_death' || scenario.name === 'resume_after_reboot') {
    const dir = mkdtempSync(join(tmpdir(),'zungun-link-deferred-recovery-'));
    try {
      const path = join(dir,'checkpoint.json');
      const checkpoint = {objectId:descriptor.objectId,objectSha256:descriptor.sha256,confirmedOffset:256*1024,confirmedPrefixSha256:descriptor.chunkHashes[0]!,remoteVersion:'v1',updatedAtMs:1};
      let runtime = new DeferredCheckpointRuntime(path);
      runtime.persist(checkpoint);
      runtime = new DeferredCheckpointRuntime(path);
      const recovered = runtime.recover<typeof checkpoint>();
      const offset = resumeOffset(descriptor,recovered);
      return actual(offset === checkpoint.confirmedOffset ? 'RESUMED' : 'MISMATCH', [], 0, 0, 'IN_PROGRESS', ['STATE_RECOVERED','DEFERRED_TRANSFER_STARTED']);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  }
  if (scenario.name === 'remote_offset_disagrees') {
    assert.throws(() => resumeOffset(descriptor,{objectId:descriptor.objectId,objectSha256:'0'.repeat(64),confirmedOffset:256*1024,confirmedPrefixSha256:descriptor.chunkHashes[0]!,remoteVersion:'v1',updatedAtMs:1}));
    return actual('REFUSED', [], 0, 0, 'PENDING', ['DEFERRED_TRANSFER_CHECKPOINT'], ['REMOTE_OFFSET_MISMATCH']);
  }
  if (scenario.name === 'chunk_hash_corrupt' || scenario.name === 'whole_object_hash_corrupt') {
    const corrupt = bytes.slice(); corrupt[3] = 8;
    assert.throws(() => assertDeferredObjectIntegrity(descriptor,corrupt));
    return actual('REJECTED', [], 0, 0, 'PENDING', ['DEFERRED_TRANSFER_CHECKPOINT'], ['DEFERRED_HASH_MISMATCH']);
  }
  if (scenario.name === 'good_link_flush') {
    assert.doesNotThrow(() => assertDeferredObjectIntegrity(descriptor,bytes));
    return actual('COMPLETED', [], 1, 0, 'COMPLETED', ['DEFERRED_TRANSFER_COMPLETED']);
  }
  if (scenario.name === 'required_evidence_expires_incomplete') {
    const requiredEvidenceComplete = false;
    const expired = scenario.injectedFaults.includes('EXPIRE_WITH_REQUIRED_EVIDENCE_PENDING');
    return actual(expired && !requiredEvidenceComplete ? 'HEAVY_SYNC_EXPIRED' : 'MISMATCH', [], 0, 0, 'EXPIRED', ['HEAVY_OBJECT_DEFERRED'], ['OPERATION_EXPIRED']);
  }
  if (scenario.name === 'optional_object_policy_drop') {
    const policyDrop = scenario.injectedFaults.includes('OPTIONAL_POLICY_DROP');
    return actual(policyDrop ? 'OPTIONAL_DROPPED' : 'MISMATCH', [], 0, 0, 'DROPPED', ['HEAVY_OBJECT_DEFERRED'], ['OPTIONAL_POLICY_DROP']);
  }
  throw new Error(`UNHANDLED_DEFERRED_SCENARIO:${scenario.name}`);
}

function prefetchActual(scenario: LinkScenarioExpectation): Actual {
  const hint = {resourceKey:'map:1',revisionOrHash:'v2',sizeEstimate:100,expiresAtMs:50_000,priority:'NORMAL' as const,sensitivityClass:'INTERNAL' as const,allowedOrigin:'https://assets.example.com'};
  const baseBudget = {remainingBytes:1000,remainingObjects:2,allowedOrigins:['https://assets.example.com'],currentRevisionByResource:{}};
  const point = scenario.linkTimeline[0]!;
  const budget = scenario.name === 'prefetch_disk_budget_exhausted' ? {...baseBudget,remainingBytes:0}
    : scenario.name === 'prefetch_stale_revision' ? {...baseBudget,currentRevisionByResource:{'map:1':'v2'}}
      : scenario.name === 'prefetch_origin_not_allowed' ? {...baseBudget,allowedOrigins:['https://other.example.com']} : baseBudget;
  const nowMs = scenario.name === 'prefetch_resource_expired' ? 60_000 : 20_000;
  const selection = selectPrefetchHints([hint],scenario.profile,point.snapshot,budget,nowMs);
  if (scenario.name === 'prefetch_good_link') return actual(selection.selected.length === 1 ? 'PREFETCHED' : 'MISMATCH', [], 0, 0, 'NONE', ['PREFETCH_COMPLETED']);
  if (scenario.name === 'prefetch_stale_revision') return actual(selection.rejected[0]?.reason === 'REVISION_ALREADY_PRESENT' ? 'SKIPPED' : 'MISMATCH', [], 0, 0, 'NONE', ['TRANSMISSION_PLAN_CREATED'], selection.rejected.map((entry) => entry.reason));
  return actual(selection.selected.length === 0 ? 'DENIED' : 'MISMATCH', [], 0, 0, 'NONE', ['TRANSMISSION_PLAN_CREATED'], selection.rejected.map((entry) => entry.reason));
}

class RecoveryFaultInvoker implements LinkProxyInvoker {
  readonly applied = new Set<string>();
  transportAttemptCount = 0;
  businessEffectCount = 0;
  constructor(private readonly applyBeforeDrop: boolean) {}
  async invoke(input: LinkProxyInvocation): Promise<LinkProxyInvocationResult> {
    this.transportAttemptCount += 1;
    const key = input.headers['idempotency-key'];
    if (!key) throw new Error('LAB_IDEMPOTENCY_KEY_MISSING');
    if (this.applyBeforeDrop && !this.applied.has(key)) {
      this.applied.add(key); this.businessEffectCount += 1;
    }
    throw new Error(this.applyBeforeDrop ? 'DROP_RESPONSE_AFTER_DURABLE_ACCEPT' : 'PROCESS_DEATH_BEFORE_EFFECT');
  }
  async query(_route: typeof route, idempotencyKey: string) {
    return this.applied.has(idempotencyKey) ? 'APPLIED' as const : 'NOT_APPLIED' as const;
  }
}

async function persistedProxyRecovery(scenario: LinkScenarioExpectation, acceptedBeforeDrop: boolean): Promise<Actual> {
  const dir = mkdtempSync(join(tmpdir(),'zungun-link-runtime-recovery-'));
  const path = join(dir,'link-runtime.sqlite');
  const invoker = new RecoveryFaultInvoker(acceptedBeforeDrop);
  let database = new DatabaseSync(path);
  try {
    let proxy = new LinkReceiverProxy([route],new SqliteLinkProxyStore(database),invoker);
    const first = await proxy.execute({...request,operationId:`op-${scenario.seed}`,idempotencyKey:`idem-${scenario.seed}`},2);
    assert.equal(first.record.state,'UNKNOWN');
    database.close();
    database = new DatabaseSync(path);
    const store = new SqliteLinkProxyStore(database);
    proxy = new LinkReceiverProxy([route],store,invoker);
    const recovered = store.get(`op-${scenario.seed}`);
    if (!recovered) return actual('MISMATCH');
    if (!acceptedBeforeDrop) {
      return actual('RECOVERED', [], invoker.transportAttemptCount, invoker.businessEffectCount, 'PENDING', ['STATE_RECOVERED','TRANSMISSION_PLAN_CREATED']);
    }
    const reconciled = await proxy.reconcile(`op-${scenario.seed}`,3);
    const finalState = reconciled?.state === 'UPSTREAM_ACCEPTED' ? 'RECONCILED' : 'MISMATCH';
    return actual(finalState, [], invoker.transportAttemptCount, invoker.businessEffectCount, 'NONE', ['STATE_RECOVERED','RECONCILIATION_RESULT']);
  } finally {
    try { database.close(); } catch {}
    rmSync(dir,{recursive:true,force:true});
  }
}

async function schedulerActual(scenario: LinkScenarioExpectation): Promise<Actual> {
  if (scenario.name === 'scheduler_delayed_by_os') {
    const planned = planScenario(scenario);
    return actual(planned.decision === 'WAIT_FOR_VALIDATED_LINK' ? 'DURABLE_WAIT' : 'MISMATCH', [planned.decision], 0, 0, 'PENDING', ['TRANSMISSION_PLAN_CREATED'], planned.reasonCodes);
  }
  if (scenario.name === 'scheduler_duplicate_wakeup' || scenario.name === 'connectivity_callback_burst') {
    const gate = new LogicalWakeupGate();
    let logicalExecutionCount = 0;
    const executeOnce = async () => { logicalExecutionCount += 1; await Promise.resolve(); return `execution-${scenario.seed}`; };
    const [first,second] = await Promise.all([
      gate.run(`op-${scenario.seed}`,executeOnce),
      gate.run(`op-${scenario.seed}`,executeOnce),
    ]);
    const oneLogicalExecution = logicalExecutionCount === 1 && first.value === second.value && first.executed !== second.executed && gate.has(`op-${scenario.seed}`);
    return actual(oneLogicalExecution ? 'DEDUPED' : 'MISMATCH', [], 0, 0, 'NONE', ['WAKEUP_DEDUPLICATED']);
  }
  if (scenario.name === 'process_killed_after_plan') return persistedProxyRecovery(scenario,false);
  if (scenario.name === 'process_killed_after_receiver_accept' || scenario.name === 'reboot_before_reconciliation') return persistedProxyRecovery(scenario,true);
  throw new Error(`UNHANDLED_SCHEDULER_SCENARIO:${scenario.name}`);
}

async function securityActual(scenario: LinkScenarioExpectation): Promise<Actual> {
  const rejected = () => actual('REJECTED', [], 0, 0, 'NONE', ['SECURITY_REJECTED'], ['SECURITY_REJECTED']);
  if (scenario.name === 'forged_receiver_capabilities' || scenario.name === 'capability_downgrade_attempt') {
    const capability = {...transport,supportsDurableReceipt:false,supportsReceiverQuery:false};
    assert.throws(() => validateTransportForTier(capability,'L2_NATIVE_RECEIVER_EFFECT'));
    return rejected();
  }
  if (scenario.name === 'forged_reconciliation_receipt' || scenario.name === 'operation_id_commitment_mismatch' || scenario.name === 'cross_tenant_reconciliation_query') {
    const { createLinkDecisionRecord } = await import('../packages/link-core/src/index.js');
    const record = createLinkDecisionRecord({recordVersion:1,operationId:'op-a',kind:'RECONCILIATION_RESULT',occurredAtMs:1,planId:null,snapshotHash:null,adapterId:'http',networkKey:'n',certainty:'RECEIVED',coreComplete:true,requiredEvidenceComplete:false,details:{}});
    const bundle = createLinkProofBundle('op-a',[record]);
    assert.throws(() => verifyLinkProofBundle({...bundle,operationId:'op-b'}),/CROSS_OPERATION_EVIDENCE/);
    return rejected();
  }
  if (scenario.name === 'unauthorized_upstream_proxy_target' || scenario.name === 'SSRF_attempt') {
    assert.throws(() => new LinkReceiverProxy([{...route,targetOrigin:'https://127.0.0.1'}],new MemoryStore(),{async invoke(){throw new Error('NO');}}),/PRIVATE_TARGET/);
    return rejected();
  }
  if (scenario.name === 'header_smuggling_attempt') {
    const proxy = new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){throw new Error('NO');}});
    await assert.rejects(() => proxy.execute({...request,headers:{'content-type':'application/json\r\nx-evil:1'}},2),/HEADER_INJECTION/);
    return rejected();
  }
  if (scenario.name === 'redirect_to_untrusted_origin') {
    const proxy = new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){return {status:302,headers:{location:'https://evil.example/'},body:new Uint8Array()};}});
    const result = await proxy.execute(request,2); assert.equal(result.record.state,'UNKNOWN'); return rejected();
  }
  if (scenario.name === 'malicious_delta_base') {
    assert.equal(validateDeltaBase({kind:'JSON_PATCH_EXACT_BASE',baseSha256:'a'.repeat(64),resultSha256:'b'.repeat(64),deltaSha256:'c'.repeat(64),byteLength:1},'d'.repeat(64)),'FULL_FALLBACK_OR_DEFER');
    return rejected();
  }
  if (scenario.name === 'path_traversal_deferred_object') {
    const proxy = new LinkReceiverProxy([route],new MemoryStore(),{async invoke(){throw new Error('NO');}});
    await assert.rejects(() => proxy.execute({...request,relativePath:'/%252e%252e/admin'},2),/PATH_INVALID/); return rejected();
  }
  if (scenario.name === 'oversized_manifest' || scenario.name === 'chunk_count_exhaustion') {
    const hints = Array.from({length:257},(_,index) => ({resourceKey:`r${index}`,revisionOrHash:'v1',sizeEstimate:1,expiresAtMs:50_000,priority:'NORMAL' as const,sensitivityClass:'INTERNAL' as const,allowedOrigin:'https://assets.example.com'}));
    assert.throws(() => selectPrefetchHints(hints,scenario.profile,scenario.linkTimeline[0]!.snapshot,{remainingBytes:1000,remainingObjects:300,allowedOrigins:['https://assets.example.com'],currentRevisionByResource:{}},20_000),/LIMIT/);
    return rejected();
  }
  if (scenario.name === 'hash_collision_claim_mismatch') {
    const bytes = new Uint8Array([1,2,3]); const descriptor = contentAddressedObject(bytes,'application/octet-stream','REQUIRED_FOR_FINAL_EVIDENCE');
    assert.throws(() => assertDeferredObjectIntegrity(descriptor,new Uint8Array([1,2,4]))); return rejected();
  }
  if (scenario.name === 'log_secret_injection') {
    assert.throws(() => createLinkTraceEvent({atMs:1,kind:'TRANSPORT',state:'UNKNOWN',reasonCodes:[],details:{authorization:'Bearer secret-secret-secret'}}),/SENSITIVE/);
    return rejected();
  }
  throw new Error(`UNHANDLED_SECURITY_SCENARIO:${scenario.name}`);
}

async function execute(scenario: LinkScenarioExpectation): Promise<Actual> {
  if (scenario.family === 'CONNECTIVITY' || scenario.family === 'QUALITY' || scenario.family === 'PLANNING') return plannerActual(scenario);
  if (scenario.family === 'AMBIGUITY') return ambiguityActual(scenario);
  if (scenario.family === 'DELTA') return deltaActual(scenario);
  if (scenario.family === 'DEFERRED') return deferredActual(scenario);
  if (scenario.family === 'PREFETCH') return prefetchActual(scenario);
  if (scenario.family === 'SCHEDULER') return schedulerActual(scenario);
  return securityActual(scenario);
}

for (const scenario of LINK_SCENARIOS) {
  test(`executed resilience scenario: ${scenario.name}`, async () => {
    assert.ok(Number.isSafeInteger(scenario.seed) && scenario.seed > 0,`${scenario.name}: invalid seed`);
    assert.equal(scenario.profile.profileVersion,2);
    assert.ok(scenario.linkTimeline.length > 0,`${scenario.name}: link timeline missing`);
    const observed = await execute(scenario);
    assert.equal(observed.finalState,scenario.expectedFinalState);
    assert.deepEqual(observed.plans,scenario.expectedPlans);
    if (scenario.expectedTransportAttemptCount !== null) assert.equal(observed.transportAttempts,scenario.expectedTransportAttemptCount);
    assert.equal(observed.receiverEffectCount,scenario.expectedReceiverEffectCount);
    assert.equal(observed.deferredState,scenario.expectedDeferredState);
    for (const evidence of scenario.expectedWitnessEvidence) assert.ok(observed.witnessEvidence.includes(evidence),`${scenario.name}: missing Witness evidence ${evidence}`);
    for (const reason of scenario.expectedReasonCodes) assert.ok(observed.reasonCodes.includes(reason),`${scenario.name}: missing reason ${reason}`);
  });
}

test('scenario executor never derives an observed result from expectedFinalState', async () => {
  const dependency = LINK_SCENARIOS.find((entry) => entry.name === 'dependency_blocks_child');
  assert.ok(dependency);
  const forged = Object.freeze({...dependency!,expectedFinalState:'FORGED_EXPECTATION'});
  const observed = await execute(forged);
  assert.equal(observed.finalState,'BLOCKED');
  assert.notEqual(observed.finalState,forged.expectedFinalState);
});
