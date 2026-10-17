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
  sha256Bytes,
  verifyLinkProofBundle,
  type DeferredObjectDescriptor,
  type DeliveryProfileV2,
  type LinkDecisionRecord,
  type LinkProofBundle,
  type LinkSnapshot,
  type PlannerInput,
  type TransferCheckpoint,
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
  readonly deferredTransportAttemptCount: number;
  readonly deferredRuntimeReopenCount: number;
  readonly deferredCheckpointOffset: number;
  readonly deferredPersistentState: string;
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

interface DeferredTransportRequest {
  readonly operationId: string;
  readonly descriptor: DeferredObjectDescriptor;
  readonly offset: number;
  readonly bytes: Uint8Array;
}

interface DeferredTransportResult {
  readonly confirmedOffset: number;
  readonly complete: boolean;
  readonly remoteVersion: string;
  readonly applicationReceipt: string | null;
}

class FaultingDeferredTransport {
  transportAttemptCount = 0;
  private remoteOffset = 0;

  transfer(request: DeferredTransportRequest): DeferredTransportResult {
    this.transportAttemptCount += 1;
    if (request.offset !== this.remoteOffset) throw new Error('BLACKOUT_DEFERRED_REMOTE_OFFSET_MISMATCH');
    if (this.transportAttemptCount === 1) {
      const confirmedOffset = Math.min(request.descriptor.byteLength, 4 * request.descriptor.chunkSizeBytes);
      const accepted = request.bytes.subarray(request.offset, confirmedOffset);
      if (accepted.byteLength !== confirmedOffset - request.offset) throw new Error('BLACKOUT_DEFERRED_SHORT_ACCEPT');
      this.remoteOffset = confirmedOffset;
      return Object.freeze({ confirmedOffset, complete:false, remoteVersion:'remote-v1', applicationReceipt:null });
    }
    assertDeferredObjectIntegrity(request.descriptor, request.bytes);
    this.remoteOffset = request.descriptor.byteLength;
    return Object.freeze({
      confirmedOffset:this.remoteOffset,
      complete:true,
      remoteVersion:'remote-v1',
      applicationReceipt:'deferred-ack-1',
    });
  }
}

type DeferredEvidenceKind = 'DEFERRED_TRANSFER_STARTED' | 'DEFERRED_TRANSFER_CHECKPOINT' | 'DEFERRED_TRANSFER_COMPLETED';

interface DeferredStateRow {
  readonly operation_id: string;
  readonly object_id: string;
  readonly object_sha256: string;
  readonly byte_length: number;
  readonly chunk_size_bytes: number;
  readonly confirmed_offset: number;
  readonly confirmed_prefix_sha256: string;
  readonly remote_version: string | null;
  readonly state: string;
}

interface DeferredEvidenceRow {
  readonly seq: number;
  readonly kind: DeferredEvidenceKind;
  readonly occurred_at_ms: number;
  readonly confirmed_offset: number;
  readonly remote_version: string | null;
  readonly application_receipt: string | null;
  readonly required_evidence_complete: number;
}

class PersistentDeferredTransferRuntime {
  constructor(
    private readonly database: DatabaseSync,
    readonly transport: FaultingDeferredTransport,
    private readonly descriptor: DeferredObjectDescriptor,
    private readonly bytes: Uint8Array,
  ) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS blackout_deferred_transfer (
        operation_id TEXT NOT NULL,
        object_id TEXT NOT NULL,
        object_sha256 TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        chunk_size_bytes INTEGER NOT NULL,
        confirmed_offset INTEGER NOT NULL,
        confirmed_prefix_sha256 TEXT NOT NULL,
        remote_version TEXT,
        state TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(operation_id, object_id)
      );
      CREATE TABLE IF NOT EXISTS blackout_deferred_evidence (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        confirmed_offset INTEGER NOT NULL,
        remote_version TEXT,
        application_receipt TEXT,
        required_evidence_complete INTEGER NOT NULL
      );
    `);
  }

  register(operationId: string, at: number): void {
    assertDeferredObjectIntegrity(this.descriptor, this.bytes);
    this.database.prepare(`
      INSERT OR IGNORE INTO blackout_deferred_transfer(
        operation_id,object_id,object_sha256,byte_length,chunk_size_bytes,confirmed_offset,
        confirmed_prefix_sha256,remote_version,state,updated_at_ms
      ) VALUES(?,?,?,?,?,0,?,NULL,'PENDING',?)
    `).run(
      operationId,
      this.descriptor.objectId,
      this.descriptor.sha256,
      this.descriptor.byteLength,
      this.descriptor.chunkSizeBytes,
      sha256Bytes(this.bytes.subarray(0,0)),
      at,
    );
  }

  transfer(operationId: string, at: number): { readonly complete: boolean; readonly confirmedOffset: number } {
    const row = this.state(operationId);
    if (row.state === 'COMPLETED') return Object.freeze({ complete:true, confirmedOffset:row.confirmed_offset });
    const checkpoint: TransferCheckpoint | null = row.confirmed_offset === 0 ? null : {
      objectId:row.object_id,
      objectSha256:row.object_sha256,
      confirmedOffset:row.confirmed_offset,
      confirmedPrefixSha256:row.confirmed_prefix_sha256,
      remoteVersion:row.remote_version,
      updatedAtMs:at,
    };
    const offset = resumeOffset(this.descriptor,checkpoint);
    const localPrefix = sha256Bytes(this.bytes.subarray(0,offset));
    if (localPrefix !== row.confirmed_prefix_sha256) throw new Error('BLACKOUT_DEFERRED_PREFIX_MISMATCH');
    this.insertEvidence(operationId,'DEFERRED_TRANSFER_STARTED',at,offset,row.remote_version,null,false);

    const result = this.transport.transfer({ operationId, descriptor:this.descriptor, offset, bytes:this.bytes });
    if (result.confirmedOffset < offset || result.confirmedOffset > this.descriptor.byteLength) {
      throw new Error('BLACKOUT_DEFERRED_OFFSET_REGRESSION');
    }
    if (!result.complete && result.confirmedOffset % this.descriptor.chunkSizeBytes !== 0) {
      throw new Error('BLACKOUT_DEFERRED_UNALIGNED_CHECKPOINT');
    }
    if (result.complete && result.confirmedOffset !== this.descriptor.byteLength) {
      throw new Error('BLACKOUT_DEFERRED_INCOMPLETE_FINAL_OFFSET');
    }
    if (result.complete) assertDeferredObjectIntegrity(this.descriptor,this.bytes);
    const prefix = sha256Bytes(this.bytes.subarray(0,result.confirmedOffset));
    const state = result.complete ? 'COMPLETED' : 'PENDING';
    const kind: DeferredEvidenceKind = result.complete ? 'DEFERRED_TRANSFER_COMPLETED' : 'DEFERRED_TRANSFER_CHECKPOINT';
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE blackout_deferred_transfer
        SET confirmed_offset=?,confirmed_prefix_sha256=?,remote_version=?,state=?,updated_at_ms=?
        WHERE operation_id=? AND object_id=?
      `).run(result.confirmedOffset,prefix,result.remoteVersion,state,at+1,operationId,this.descriptor.objectId);
      this.insertEvidence(
        operationId,
        kind,
        at+1,
        result.confirmedOffset,
        result.remoteVersion,
        result.applicationReceipt,
        result.complete,
      );
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return Object.freeze({ complete:result.complete, confirmedOffset:result.confirmedOffset });
  }

  state(operationId: string): DeferredStateRow {
    const row = this.database.prepare(`
      SELECT operation_id,object_id,object_sha256,byte_length,chunk_size_bytes,confirmed_offset,
             confirmed_prefix_sha256,remote_version,state
      FROM blackout_deferred_transfer WHERE operation_id=? AND object_id=?
    `).get(operationId,this.descriptor.objectId) as DeferredStateRow | undefined;
    if (!row) throw new Error('BLACKOUT_DEFERRED_STATE_MISSING');
    return row;
  }

  evidenceAfter(operationId: string, sequence: number): readonly DeferredEvidenceRow[] {
    return this.database.prepare(`
      SELECT seq,kind,occurred_at_ms,confirmed_offset,remote_version,application_receipt,required_evidence_complete
      FROM blackout_deferred_evidence WHERE operation_id=? AND seq>? ORDER BY seq ASC
    `).all(operationId,sequence) as DeferredEvidenceRow[];
  }

  isComplete(operationId: string): boolean {
    const row = this.state(operationId);
    if (row.state !== 'COMPLETED' || row.confirmed_offset !== row.byte_length) return false;
    const evidence = this.database.prepare(`
      SELECT COUNT(*) AS count FROM blackout_deferred_evidence
      WHERE operation_id=? AND kind='DEFERRED_TRANSFER_COMPLETED' AND required_evidence_complete=1
    `).get(operationId) as { count: number };
    return Number(evidence.count) === 1;
  }

  private insertEvidence(
    operationId: string,
    kind: DeferredEvidenceKind,
    at: number,
    confirmedOffset: number,
    remoteVersion: string | null,
    applicationReceipt: string | null,
    requiredEvidenceComplete: boolean,
  ): void {
    this.database.prepare(`
      INSERT INTO blackout_deferred_evidence(
        operation_id,kind,occurred_at_ms,confirmed_offset,remote_version,application_receipt,required_evidence_complete
      ) VALUES(?,?,?,?,?,?,?)
    `).run(operationId,kind,at,confirmedOffset,remoteVersion,applicationReceipt,requiredEvidenceComplete?1:0);
  }
}

class BlackoutRuntime {
  readonly operationId = 'blackout-op-1';
  readonly records: LinkDecisionRecord[] = [];
  readonly decisions: string[] = [];
  coreComplete = false;
  private deferredEvidenceSequence = 0;

  constructor(
    private readonly profile: DeliveryProfileV2,
    private readonly transport: PlannerInput['transports'][number],
    private readonly proxy: LinkReceiverProxy,
    readonly upstream: FaultingDurableBusinessTransport,
    private deferredRuntime: PersistentDeferredTransferRuntime,
  ) {}

  get evidenceComplete(): boolean {
    return this.deferredRuntime.isComplete(this.operationId);
  }

  replaceDeferredRuntime(runtime: PersistentDeferredTransferRuntime): void {
    runtime.state(this.operationId);
    this.deferredRuntime = runtime;
  }

  private record(
    kind: LinkDecisionRecord['kind'],
    at: number,
    certainty: LinkDecisionRecord['certainty'],
    details: Record<string,string|number|boolean|null>,
    plan: ReturnType<typeof createTransmissionPlan> | null = null,
    requiredEvidenceComplete: boolean = this.evidenceComplete,
  ) {
    this.records.push(createLinkDecisionRecord({
      recordVersion:1, operationId:this.operationId, kind, occurredAtMs:at,
      planId:plan?.planId ?? null, snapshotHash:plan?.snapshotHash ?? null,
      adapterId:plan?.adapterId ?? null, networkKey:plan?.networkKey ?? null,
      certainty, coreComplete:this.coreComplete, requiredEvidenceComplete, details,
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
    this.record('TRANSPORT_PATH_SELECTED',at+1,'UNKNOWN',{fault:'DROP_RESPONSE_AFTER_DURABLE_ACCEPT',proxyState:response.record.state},plan);
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

  transferDeferred(plan: ReturnType<typeof createTransmissionPlan>, at: number) {
    const result = this.deferredRuntime.transfer(this.operationId,at);
    this.syncDeferredEvidence(plan);
    return result;
  }

  deferredState(): DeferredStateRow {
    return this.deferredRuntime.state(this.operationId);
  }

  private syncDeferredEvidence(plan: ReturnType<typeof createTransmissionPlan>): void {
    const rows = this.deferredRuntime.evidenceAfter(this.operationId,this.deferredEvidenceSequence);
    for (const row of rows) {
      this.deferredEvidenceSequence = row.seq;
      const certainty: LinkDecisionRecord['certainty'] = row.kind === 'DEFERRED_TRANSFER_COMPLETED' ? 'RECEIVED' : 'SENT';
      this.record(
        row.kind,
        row.occurred_at_ms,
        certainty,
        {
          source:'PERSISTED_DEFERRED_RUNTIME',
          confirmedOffset:row.confirmed_offset,
          remoteVersion:row.remote_version,
          applicationReceipt:row.application_receipt,
        },
        plan,
        row.required_evidence_complete === 1,
      );
    }
  }

  finish() {
    if (!this.evidenceComplete) throw new Error('BLACKOUT_REQUIRED_EVIDENCE_INCOMPLETE');
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
  const proxyDatabase = new DatabaseSync(join(dir,'proxy.sqlite'));
  const deferredPath = join(dir,'deferred.sqlite');
  let deferredDatabase: DatabaseSync | null = new DatabaseSync(deferredPath);
  const deferredTransport = new FaultingDeferredTransport();
  const deferredBytes = new Uint8Array(8_400_000).fill(7);
  const deferredObject = contentAddressedObject(deferredBytes,'application/octet-stream','REQUIRED_FOR_FINAL_EVIDENCE',256*1024);
  let deferredRuntime = new PersistentDeferredTransferRuntime(deferredDatabase,deferredTransport,deferredObject,deferredBytes);
  deferredRuntime.register('blackout-op-1',1_000);
  let deferredRuntimeReopenCount = 0;
  try {
    const upstream = new FaultingDurableBusinessTransport();
    const proxy = new LinkReceiverProxy([route],new SqliteLinkProxyStore(proxyDatabase),upstream);
    const runtime = new BlackoutRuntime(profile,transport,proxy,upstream,deferredRuntime);
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

    const checkpointed = runtime.transferDeferred(flush,5400);
    if (checkpointed.complete || checkpointed.confirmedOffset <= 0) throw new Error('BLACKOUT_DEFERRED_CHECKPOINT_NOT_PERSISTED');
    const persistedBeforeReopen = runtime.deferredState();
    if (persistedBeforeReopen.state !== 'PENDING' || persistedBeforeReopen.confirmed_offset !== checkpointed.confirmedOffset) {
      throw new Error('BLACKOUT_DEFERRED_CHECKPOINT_STATE_INVALID');
    }

    deferredDatabase.close();
    deferredDatabase = null;
    deferredRuntimeReopenCount += 1;
    deferredDatabase = new DatabaseSync(deferredPath);
    deferredRuntime = new PersistentDeferredTransferRuntime(deferredDatabase,deferredTransport,deferredObject,deferredBytes);
    runtime.replaceDeferredRuntime(deferredRuntime);
    const restored = runtime.deferredState();
    if (restored.confirmed_offset !== checkpointed.confirmedOffset || restored.state !== 'PENDING') {
      throw new Error('BLACKOUT_DEFERRED_REOPEN_LOST_CHECKPOINT');
    }

    const completed = runtime.transferDeferred(flush,5500);
    if (!completed.complete || completed.confirmedOffset !== deferredObject.byteLength) {
      throw new Error('BLACKOUT_DEFERRED_RUNTIME_DID_NOT_COMPLETE');
    }
    const finalDeferred = runtime.deferredState();
    const proofBundle = runtime.finish();
    return Object.freeze({
      operationId:runtime.operationId,
      businessEffectCount:upstream.businessEffectCount,
      secondSideEffectSendCount:Math.max(0,upstream.transportAttemptCount-1),
      transportAttemptCount:upstream.transportAttemptCount,
      reconciliationQueryCount:upstream.reconciliationQueryCount,
      deferredTransportAttemptCount:deferredTransport.transportAttemptCount,
      deferredRuntimeReopenCount,
      deferredCheckpointOffset:checkpointed.confirmedOffset,
      deferredPersistentState:finalDeferred.state,
      decisions:Object.freeze([...runtime.decisions]),
      finalCoreComplete:runtime.coreComplete,
      finalEvidenceComplete:runtime.evidenceComplete,
      proofManifestSha256:proofBundle.manifestSha256,
      proofBundle,
    });
  } finally {
    deferredDatabase?.close();
    proxyDatabase.close();
    rmSync(dir,{recursive:true,force:true});
  }
}
