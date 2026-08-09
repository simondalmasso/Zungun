import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  assertDeferredObjectIntegrity,
  contentAddressedObject,
  createLinkDecisionRecord,
  createLinkProofBundle,
  createTransmissionPlan,
  reconcileAmbiguous,
  resumeOffset,
  verifyLinkProofBundle,
  type DeliveryProfileV2,
  type LinkDecisionRecord,
  type LinkProofBundle,
  type LinkSnapshot,
  type PlannerInput,
} from '../../../packages/link-core/src/index.js';
import {
  LinkReceiverProxy,
  SqliteLinkProxyStore,
  type LinkProxyInvocation,
  type LinkProxyInvocationResult,
  type LinkProxyInvoker,
  type LinkProxyRoute,
} from '../../../services/receiver/src/link-proxy.js';

export interface LinkBlackoutResult {
  readonly operationId: string;
  readonly businessEffectCount: number;
  readonly secondSideEffectSendCount: number;
  readonly transportAttemptCount: number;
  readonly reconciliationQueryCount: number;
  readonly decisions: readonly string[];
  readonly finalCoreComplete: boolean;
  readonly finalEvidenceComplete: boolean;
  readonly proofManifestSha256: string;
  readonly proofBundle: LinkProofBundle;
}

class FaultingDurableBusinessTransport implements LinkProxyInvoker {
  private readonly durableEffects = new Set<string>();
  transportAttemptCount = 0;
  reconciliationQueryCount = 0;
  businessEffectCount = 0;
  private dropResponseAfterNextDurableAccept = true;

  async invoke(input: LinkProxyInvocation): Promise<LinkProxyInvocationResult> {
    this.transportAttemptCount += 1;
    const idempotencyKey = input.headers['idempotency-key'];
    if (!idempotencyKey) throw new Error('BLACKOUT_IDEMPOTENCY_KEY_MISSING');
    if (!this.durableEffects.has(idempotencyKey)) {
      this.durableEffects.add(idempotencyKey);
      this.businessEffectCount += 1;
    }
    if (this.dropResponseAfterNextDurableAccept) {
      this.dropResponseAfterNextDurableAccept = false;
      throw new Error('DROP_RESPONSE_AFTER_DURABLE_ACCEPT');
    }
    return Object.freeze({ status:202, headers:Object.freeze({}), body:new TextEncoder().encode('{"accepted":true}') });
  }

  async query(_route: LinkProxyRoute, idempotencyKey: string): Promise<'APPLIED'|'NOT_APPLIED'|'UNKNOWN'> {
    this.reconciliationQueryCount += 1;
    return this.durableEffects.has(idempotencyKey) ? 'APPLIED' : 'NOT_APPLIED';
  }
}

class BlackoutRuntime {
  readonly operationId = 'blackout-op-1';
  readonly records: LinkDecisionRecord[] = [];
  readonly decisions: string[] = [];
  coreComplete = false;
  evidenceComplete = false;

  constructor(
    private readonly profile: DeliveryProfileV2,
    private readonly transport: PlannerInput['transports'][number],
    private readonly proxy: LinkReceiverProxy,
    readonly upstream: FaultingDurableBusinessTransport,
  ) {}

  private record(
    kind: LinkDecisionRecord['kind'],
    at: number,
    certainty: LinkDecisionRecord['certainty'],
    details: Record<string,string|number|boolean|null>,
    plan: ReturnType<typeof createTransmissionPlan> | null = null,
  ) {
    this.records.push(createLinkDecisionRecord({
      recordVersion:1, operationId:this.operationId, kind, occurredAtMs:at,
      planId:plan?.planId ?? null, snapshotHash:plan?.snapshotHash ?? null,
      adapterId:plan?.adapterId ?? null, networkKey:plan?.networkKey ?? null,
      certainty, coreComplete:this.coreComplete, requiredEvidenceComplete:this.evidenceComplete, details,
    }));
  }

  observe(snapshot: LinkSnapshot) {
    this.record('LINK_SNAPSHOT_OBSERVED',snapshot.observedAtMs,'PLANNED',{
      snapshotId:snapshot.snapshotId, validated:snapshot.validated,
      metered:snapshot.metered, congested:snapshot.congested,
    });
  }

  plan(nowMs:number,snapshot:LinkSnapshot,priorAmbiguousOutcome=false,hasOutstandingDeferredObjects=false) {
    const input: PlannerInput = {
      plannerVersion:'link-planner-v1', nowMs, opId:this.operationId, profile:this.profile, snapshot,
      payload:{fullBytes:8_400_312,criticalCoreBytes:312,deferredBytes:8_400_000,deltaBytes:null,deltaBaseRequired:null,deltaBaseAvailable:null,hasRequiredDeferredEvidence:true},
      transports:[this.transport], priorAmbiguousOutcome, automaticRetryAttempt:priorAmbiguousOutcome,
      activeProbeBytesUsed:0, hasOutstandingDeferredObjects, prefetchEligible:false,
    };
    const plan = createTransmissionPlan(input);
    this.decisions.push(plan.decision);
    this.record('TRANSMISSION_PLAN_CREATED',nowMs,'PLANNED',{decision:plan.decision,plannedBytes:plan.plannedBytes},plan);
    return plan;
  }

  async sendCritical(plan:ReturnType<typeof createTransmissionPlan>,at:number): Promise<'UNKNOWN'> {
    if (plan.decision !== 'SEND_CRITICAL_CORE_NOW') throw new Error('BLACKOUT_CORE_NOT_SELECTED');
    this.record('CRITICAL_CORE_SENT',at,'SENT',{bytes:plan.plannedBytes},plan);
    this.record('HEAVY_OBJECT_DEFERRED',at,'PENDING',{bytes:8_400_000},plan);
    const response = await this.proxy.execute({
      operationId:this.operationId,
      idempotencyKey:'blackout-idem-1',
      routeId:'blackout-route',
      method:'POST',
      relativePath:'/critical-operation',
      headers:{'content-type':'application/json'},
      body:new Uint8Array(312).fill(7),
      createdAtMs:1_000,
    },at);
    if (response.record.state !== 'UNKNOWN') throw new Error(`BLACKOUT_EXPECTED_UNKNOWN:${response.record.state}`);
    if (this.upstream.businessEffectCount !== 1) throw new Error('BLACKOUT_DURABLE_EFFECT_NOT_APPLIED_ONCE');
    this.coreComplete = true;
    this.record('TRANSPORT_OUTCOME',at+1,'UNKNOWN',{fault:'DROP_RESPONSE_AFTER_DURABLE_ACCEPT',proxyState:response.record.state},plan);
    return 'UNKNOWN';
  }

  async reconcile(plan:ReturnType<typeof createTransmissionPlan>,at:number) {
    if (plan.decision !== 'RECONCILE_BEFORE_RETRY') throw new Error('BLACKOUT_RECONCILE_NOT_SELECTED');
    this.record('RECONCILIATION_STARTED',at,'UNKNOWN',{reason:'LOST_RESPONSE_AFTER_DURABLE_ACCEPT'},plan);
    const proxyRecord = await this.proxy.reconcile(this.operationId,at+1);
    if (proxyRecord?.state !== 'UPSTREAM_ACCEPTED') throw new Error(`BLACKOUT_PROXY_RECONCILIATION_FAILED:${proxyRecord?.state ?? 'MISSING'}`);
    const result = reconcileAmbiguous({
      prior:'UNKNOWN', retryContract:'RECONCILE_BEFORE_RETRY',
      query:{kind:'ACCEPTED',receiptId:'blackout-proxy-durable-accept'},
      operationCreatedAtMs:1_000, nowMs:at+2,
    });
    if (result.retryAllowed || result.secondSideEffectSendAllowed) throw new Error('BLACKOUT_DUPLICATE_RISK');
    if (this.upstream.transportAttemptCount !== 1 || this.upstream.businessEffectCount !== 1) throw new Error('BLACKOUT_RECONCILIATION_REAPPLIED_EFFECT');
    this.record('RECONCILIATION_RESULT',at+2,'RECEIVED',{result:result.reason,proxyState:proxyRecord.state},plan);
    return result;
  }

  resumeDeferred(plan:ReturnType<typeof createTransmissionPlan>,at:number) {
    const bytes = new Uint8Array(8_400_000).fill(7);
    const object = contentAddressedObject(bytes,'application/octet-stream','REQUIRED_FOR_FINAL_EVIDENCE',256*1024);
    const firstOffset = 4*256*1024;
    const checkpoint = {
      objectId:object.objectId, objectSha256:object.sha256, confirmedOffset:firstOffset,
      confirmedPrefixSha256:object.chunkHashes[3]!, remoteVersion:'v1', updatedAtMs:at,
    };
    const resumed = resumeOffset(object,checkpoint);
    if (resumed !== firstOffset) throw new Error('BLACKOUT_RESUME_OFFSET_MISMATCH');
    this.record('DEFERRED_TRANSFER_STARTED',at,'SENT',{offset:resumed},plan);
    this.record('DEFERRED_TRANSFER_CHECKPOINT',at+1,'SENT',{offset:resumed},plan);
    assertDeferredObjectIntegrity(object,bytes);
    this.evidenceComplete = true;
    this.record('DEFERRED_TRANSFER_COMPLETED',at+2,'RECEIVED',{bytes:object.byteLength,sha256:object.sha256},plan);
  }

  finish() {
    const proofBundle = createLinkProofBundle(this.operationId,this.records);
    if (!verifyLinkProofBundle(proofBundle)) throw new Error('BLACKOUT_PROOF_INVALID');
    return proofBundle;
  }
}

export async function runLinkBlackoutDrill(): Promise<LinkBlackoutResult> {
  const profile: DeliveryProfileV2 = {
    profileVersion:2, urgency:'CRITICAL', deadlineAtMs:10_000, expiresAtMs:60_000, maxDelayMs:2_000,
    retryContract:'RECONCILE_BEFORE_RETRY', idempotencyRequired:true, semanticRevalidationRequired:true,
    orderingKey:'workorder:1', dependencies:[], payloadStrategy:'CORE_PLUS_DEFERRED', maxImmediateBytes:1024,
    allowMetered:true, allowRoaming:false, allowCongested:true, allowUnvalidated:false,
    heavyDataPolicy:'DEFER_ON_CONSTRAINED', activeProbeBudgetBytes:0, transportAllowlist:['http'],
    receiptRequirement:'DURABLE_ACCEPTANCE', evidenceRequirement:'FULL_WITNESS',
  };
  const transport = {
    adapterId:'http', available:true, reachabilityClass:'INTERNET' as const, maxPayloadBytes:null,
    supportsDurableReceipt:true, supportsReceiverQuery:true, supportsResume:true, supportsNetworkBinding:true, supportsHedging:false,
  };
  const route: LinkProxyRoute = {
    routeId:'blackout-route', targetOrigin:'https://receiver.example.com', pathPrefix:'/api', allowedMethods:['POST'],
    maxRequestBytes:4096, maxResponseBytes:4096, timeoutMs:1000, allowedRequestHeaders:['content-type'],
  };
  const snap = (id:string,t:number,patch:Partial<LinkSnapshot>={}):LinkSnapshot => ({
    snapshotId:id, observedAtMs:t, maxAgeMs:5000, hasNetwork:true, internetCapable:true, validated:true,
    captivePortal:false, metered:false, temporarilyUnmetered:false, congested:false, roaming:false, vpn:false,
    suspended:false, downstreamKbps:5000, upstreamKbps:2000, transports:['CELLULAR'], networkKey:'net:1',
    recentRttMsEwma:null, recentFailureRateEwma:null, recentThroughputKbpsEwma:null, ...patch,
  });

  const dir = mkdtempSync(join(tmpdir(),'zungun-blackout-proxy-'));
  const database = new DatabaseSync(join(dir,'proxy.sqlite'));
  try {
    const upstream = new FaultingDurableBusinessTransport();
    const proxy = new LinkReceiverProxy([route],new SqliteLinkProxyStore(database),upstream);
    const runtime = new BlackoutRuntime(profile,transport,proxy,upstream);
    const good = snap('good',1000); runtime.observe(good);
    const constrained = snap('constrained',2000,{metered:true,congested:true,upstreamKbps:64}); runtime.observe(constrained);
    const corePlan = runtime.plan(2100,constrained);
    const outcome = await runtime.sendCritical(corePlan,2200);
    if (outcome !== 'UNKNOWN') throw new Error('BLACKOUT_AMBIGUITY_NOT_CREATED');
    const ambiguousPlan = runtime.plan(2300,constrained,true,true);
    await runtime.reconcile(ambiguousPlan,2400);
    const recovery = snap('recovery',5000,{metered:false,congested:false,upstreamKbps:5000}); runtime.observe(recovery);
    const flush = runtime.plan(5300,recovery,false,true);
    if (flush.decision !== 'SEND_CRITICAL_CORE_NOW' && flush.decision !== 'SEND_FULL_NOW') throw new Error('BLACKOUT_RECOVERY_PLAN_INVALID');
    runtime.resumeDeferred(flush,5400);
    const proofBundle = runtime.finish();
    return Object.freeze({
      operationId:runtime.operationId,
      businessEffectCount:upstream.businessEffectCount,
      secondSideEffectSendCount:Math.max(0,upstream.transportAttemptCount-1),
      transportAttemptCount:upstream.transportAttemptCount,
      reconciliationQueryCount:upstream.reconciliationQueryCount,
      decisions:Object.freeze([...runtime.decisions]),
      finalCoreComplete:runtime.coreComplete,
      finalEvidenceComplete:runtime.evidenceComplete,
      proofManifestSha256:proofBundle.manifestSha256,
      proofBundle,
    });
  } finally {
    database.close();
    rmSync(dir,{recursive:true,force:true});
  }
}
