import { randomUUID } from 'node:crypto';
import { canonicalize, sha256Hex, type CanonicalValue } from '../../../packages/protocol-core/src/canonical.js';
import {
  envelopeCommitment,
  validateEnvelope,
  type OperationEnvelope,
} from '../../../packages/protocol-core/src/operation.js';
import {
  createCompletenessCertificate,
  reconcileFacts,
  type ExecutionVerdict,
  type FactKind,
  type FactSource,
  type OperationFact,
  type ReconciliationResult,
} from '../../../packages/reconciliation/src/index.js';
import {
  signExecutionReceipt,
  type RotatingReceiptKeyProvider,
  type SignedExecutionReceipt,
} from '../../../packages/security/src/receipts.js';
import { ReceiverDatabase, evidenceHash } from './database.js';

export interface AcceptResult {
  readonly operationId: string;
  readonly duplicate: boolean;
  readonly state: string;
  readonly envelopeCommitment: string;
  readonly receipt: SignedExecutionReceipt | null;
}

export interface ClaimResult {
  readonly operationId: string;
  readonly attemptId: string;
  readonly ownerId: string;
  readonly fencingToken: number;
  readonly leaseExpiresAtMs: number;
}

export interface EffectInput {
  readonly outcome: 'EFFECT_APPLIED' | 'NO_EFFECT' | 'REJECTED' | 'UNKNOWN';
  readonly applicationReference: string;
  readonly applicationAcknowledged: boolean;
  readonly workOrderStatus: string;
  readonly result: Readonly<Record<string, CanonicalValue>>;
  readonly occurredAtMs: number;
}

export interface ScopeDeclarationInput {
  readonly scopeType: 'ROUTE' | 'SHIFT' | 'DEVICE' | 'BATCH';
  readonly scopeId: string;
  readonly declarationVersion: number;
  readonly expectedReportingDeviceIds: readonly string[];
  readonly expectedOperationIds: readonly string[];
  readonly expectedOperationCount: number | null;
  readonly declaredAtMs: number;
  readonly provenance: string;
  readonly previousManifestHash: string | null;
}

export interface ManualResolutionInput {
  readonly targetVerdict: ExecutionVerdict;
  readonly rationale: string;
  readonly referencedFactIds: readonly string[];
  readonly previousProofHash: string;
  readonly nowMs: number;
}

export interface OperationPage {
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly nextOffset: number | null;
}

function rowObject(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}

function parseReceipt(row: any): SignedExecutionReceipt | null {
  if (!row) return null;
  return Object.freeze({
    payload: JSON.parse(row.payload_json),
    keyId: row.key_id,
    algorithm: row.algorithm,
    signatureBase64: row.signature_base64,
    payloadSha256: row.payload_sha256,
  }) as SignedExecutionReceipt;
}

function exactStrings(values: readonly string[], label: string): readonly string[] {
  const unique = [...new Set(values)];
  if (unique.some((value) => !/^[A-Za-z0-9._:+/-]{1,256}$/.test(value))) {
    throw new Error(`INVALID_${label}`);
  }
  return Object.freeze(unique.sort());
}

export class PersistentReceiver {
  constructor(
    readonly database: ReceiverDatabase,
    readonly keyProvider: RotatingReceiptKeyProvider,
    readonly receiverId = 'receiver_local_1',
  ) {
    database.migrate();
  }

  ready(nowMs = Date.now()) {
    const database = this.database.readiness();
    const activeKey = this.keyProvider.current(nowMs).publicRecord;
    return Object.freeze({
      status: 'ready',
      database,
      activeKeyId: activeKey.keyId,
      activeKeyValidUntilMs: activeKey.validUntilMs,
    });
  }

  accept(rawEnvelope: unknown, observedAtMs: number): AcceptResult {
    const envelope = validateEnvelope(rawEnvelope, observedAtMs);
    const commitment = envelopeCommitment(envelope);
    return this.database.transaction(() => {
      const replay = this.database.db.prepare(
        'SELECT operation_id,envelope_commitment FROM replay_ledger WHERE replay_nonce=?',
      ).get(envelope.replayNonce) as any;
      if (replay && replay.operation_id !== envelope.operationId) throw new Error('REPLAY_DETECTED');
      const existing = this.database.db.prepare(
        'SELECT * FROM operations WHERE operation_id=? OR idempotency_key=?',
      ).get(envelope.operationId, envelope.idempotencyKey) as any;
      if (existing) {
        if (existing.message_commitment !== envelope.messageCommitment ||
            existing.envelope_commitment !== commitment) throw new Error('DUPLICATE_CONFLICT');
        this.addEvidence(
          existing.operation_id,
          'RECEIVER',
          'DUPLICATE',
          observedAtMs,
          `duplicate:${envelope.operationId}`,
          { envelopeCommitment: commitment },
        );
        const receipt = parseReceipt(
          this.database.db.prepare('SELECT * FROM receipts WHERE operation_id=?').get(existing.operation_id),
        );
        return Object.freeze({
          operationId: existing.operation_id,
          duplicate: true,
          state: existing.state,
          envelopeCommitment: commitment,
          receipt,
        });
      }
      const deviceId = typeof envelope.extensions.deviceId === 'string'
        ? envelope.extensions.deviceId
        : 'unknown_device';
      this.database.db.prepare(`INSERT INTO operations(
        operation_id,idempotency_key,tenant_id,message_id,message_commitment,envelope_commitment,
        work_order_id,scope_type,scope_id,device_id,payload_json,replay_nonce,state,
        application_outcome,created_at_ms,updated_at_ms,expires_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        envelope.operationId,
        envelope.idempotencyKey,
        envelope.tenantId,
        envelope.messageId,
        envelope.messageCommitment,
        commitment,
        envelope.workOrderId,
        envelope.scopeType,
        envelope.scopeId,
        deviceId,
        canonicalize(envelope as unknown as CanonicalValue),
        envelope.replayNonce,
        'RECEIVER_ACCEPTED',
        'UNKNOWN',
        envelope.policy.createdAtMs,
        observedAtMs,
        envelope.policy.expiresAtMs,
      );
      this.database.db.prepare(
        'INSERT INTO replay_ledger(replay_nonce,operation_id,observed_at_ms,envelope_commitment) VALUES(?,?,?,?)',
      ).run(envelope.replayNonce, envelope.operationId, observedAtMs, commitment);
      this.database.db.prepare(`INSERT INTO reporting_devices(
        scope_type,scope_id,device_id,first_seen_at_ms,last_seen_at_ms
      ) VALUES(?,?,?,?,?) ON CONFLICT(scope_type,scope_id,device_id)
      DO UPDATE SET last_seen_at_ms=excluded.last_seen_at_ms`).run(
        envelope.scopeType,
        envelope.scopeId,
        deviceId,
        observedAtMs,
        observedAtMs,
      );
      this.addEvidence(
        envelope.operationId,
        'RECEIVER',
        'RECEIVER_ACCEPTED',
        observedAtMs,
        `accept:${envelope.operationId}`,
        { envelopeCommitment: commitment },
      );
      return Object.freeze({
        operationId: envelope.operationId,
        duplicate: false,
        state: 'RECEIVER_ACCEPTED',
        envelopeCommitment: commitment,
        receipt: null,
      });
    });
  }

  claim(operationId: string, ownerId: string, nowMs: number, leaseMs = 30_000): ClaimResult {
    if (!/^[A-Za-z0-9._:@/-]{1,128}$/.test(ownerId)) throw new Error('INVALID_OWNER');
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw new Error('INVALID_LEASE');
    }
    return this.database.transaction(() => {
      const operation = this.requireOperation(operationId);
      if (['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(String(operation.state))) {
        throw new Error('TERMINAL_OPERATION');
      }
      const lease = this.database.db.prepare('SELECT * FROM leases WHERE operation_id=?').get(operationId) as any;
      if (lease && lease.expires_at_ms > nowMs && lease.owner_id !== ownerId) throw new Error('LEASE_HELD');
      const fencingToken = Number(operation.fencing_token) + 1;
      const attemptId = `attempt_${randomUUID()}`;
      this.database.db.prepare(
        'UPDATE operations SET state=?,updated_at_ms=?,fencing_token=? WHERE operation_id=?',
      ).run('CLAIMED', nowMs, fencingToken, operationId);
      this.database.db.prepare(`INSERT INTO leases(operation_id,owner_id,fencing_token,expires_at_ms)
        VALUES(?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET owner_id=excluded.owner_id,
        fencing_token=excluded.fencing_token,expires_at_ms=excluded.expires_at_ms`).run(
        operationId,
        ownerId,
        fencingToken,
        nowMs + leaseMs,
      );
      this.database.db.prepare(`INSERT INTO attempts(
        attempt_id,operation_id,owner_id,fencing_token,status,started_at_ms,detail
      ) VALUES(?,?,?,?,?,?,?)`).run(
        attemptId,
        operationId,
        ownerId,
        fencingToken,
        'CLAIMED',
        nowMs,
        'lease acquired',
      );
      this.addEvidence(operationId, 'RECEIVER', 'TRANSPORT_ATTEMPT', nowMs, attemptId, {
        ownerId,
        fencingToken,
      });
      return Object.freeze({
        operationId,
        attemptId,
        ownerId,
        fencingToken,
        leaseExpiresAtMs: nowMs + leaseMs,
      });
    });
  }

  recordEffect(
    operationId: string,
    attemptId: string,
    fencingToken: number,
    input: EffectInput,
  ): { readonly state: string; readonly receipt: SignedExecutionReceipt | null } {
    return this.database.transaction(() => {
      const operation = this.requireOperation(operationId);
      const attempt = this.database.db.prepare(
        'SELECT * FROM attempts WHERE attempt_id=? AND operation_id=?',
      ).get(attemptId, operationId) as any;
      const lease = this.database.db.prepare('SELECT * FROM leases WHERE operation_id=?').get(operationId) as any;
      if (!attempt || !lease || attempt.fencing_token !== fencingToken ||
          lease.fencing_token !== fencingToken || lease.expires_at_ms < input.occurredAtMs) {
        if (attempt) {
          this.database.db.prepare(
            'UPDATE attempts SET status=?,completed_at_ms=?,detail=? WHERE attempt_id=?',
          ).run('LEASE_LOST', input.occurredAtMs, 'fencing token or lease invalid', attemptId);
        }
        throw new Error('LEASE_LOST');
      }
      if (operation.expires_at_ms <= input.occurredAtMs) {
        this.database.db.prepare(
          'UPDATE operations SET state=?,updated_at_ms=? WHERE operation_id=?',
        ).run('EXPIRED', input.occurredAtMs, operationId);
        throw new Error('TTL_EXPIRED');
      }

      let state = 'UNKNOWN';
      const terminalEvidence = input.outcome !== 'UNKNOWN' && input.applicationAcknowledged;
      if (input.outcome === 'EFFECT_APPLIED' && terminalEvidence) {
        const workOrder = this.database.db.prepare(
          'SELECT * FROM work_orders WHERE work_order_id=?',
        ).get(operation.work_order_id) as any;
        if (workOrder && workOrder.effect_operation_id !== operationId) {
          throw new Error('APPLICATION_CONFLICT');
        }
        this.database.db.prepare(`INSERT INTO work_orders(
          work_order_id,status,result_json,effect_operation_id,updated_at_ms
        ) VALUES(?,?,?,?,?) ON CONFLICT(work_order_id) DO UPDATE SET
          status=excluded.status,result_json=excluded.result_json,updated_at_ms=excluded.updated_at_ms`).run(
          operation.work_order_id,
          input.workOrderStatus,
          canonicalize(input.result as CanonicalValue),
          operationId,
          input.occurredAtMs,
        );
        state = 'COMPLETED';
      } else if (terminalEvidence && input.outcome === 'NO_EFFECT') {
        state = 'COMPLETED';
      } else if (terminalEvidence && input.outcome === 'REJECTED') {
        state = 'REJECTED';
      }

      this.database.db.prepare(`UPDATE operations SET
        state=?,application_outcome=?,application_reference=?,updated_at_ms=? WHERE operation_id=?`).run(
        state,
        input.outcome,
        input.applicationReference,
        input.occurredAtMs,
        operationId,
      );
      this.database.db.prepare(
        'UPDATE attempts SET status=?,completed_at_ms=?,detail=? WHERE attempt_id=?',
      ).run(
        terminalEvidence ? 'SUCCEEDED' : 'UNKNOWN',
        input.occurredAtMs,
        input.applicationReference,
        attemptId,
      );
      this.addEvidence(
        operationId,
        'APPLICATION',
        input.outcome,
        input.occurredAtMs,
        input.applicationReference,
        input.result,
      );

      let receipt: SignedExecutionReceipt | null = null;
      if (terminalEvidence) {
        this.addEvidence(
          operationId,
          'APPLICATION',
          'APPLICATION_ACK',
          input.occurredAtMs,
          input.applicationReference,
          { outcome: input.outcome },
        );
        receipt = signExecutionReceipt({
          schema: 'zungun.execution-receipt.v1',
          protocolVersion: 1,
          operationId,
          messageCommitment: operation.message_commitment,
          receiverId: this.receiverId,
          applicationOutcome: input.outcome,
          applicationReference: input.applicationReference,
          scopeType: operation.scope_type,
          scopeId: operation.scope_id,
          issuedAtMs: input.occurredAtMs,
          validFromMs: input.occurredAtMs - 1,
          validUntilMs: input.occurredAtMs + 86_400_000,
          replayNonce: operation.replay_nonce,
        }, this.keyProvider);
        const receiptId = `receipt_${receipt.payloadSha256.slice(0, 32)}`;
        this.database.db.prepare(`INSERT OR REPLACE INTO receipts(
          receipt_id,operation_id,key_id,algorithm,payload_json,signature_base64,payload_sha256,issued_at_ms
        ) VALUES(?,?,?,?,?,?,?,?)`).run(
          receiptId,
          operationId,
          receipt.keyId,
          receipt.algorithm,
          canonicalize(receipt.payload as unknown as CanonicalValue),
          receipt.signatureBase64,
          receipt.payloadSha256,
          input.occurredAtMs,
        );
        this.addEvidence(operationId, 'RECEIVER', 'SIGNED_RECEIPT', input.occurredAtMs, receiptId, {
          keyId: receipt.keyId,
          payloadSha256: receipt.payloadSha256,
        });
      }
      return Object.freeze({ state, receipt });
    });
  }

  reconcile(operationId: string, actorId: string, note: string, nowMs: number): ReconciliationResult {
    return this.database.transaction(() => {
      this.requireOperation(operationId);
      const result = this.deriveReconciliation(operationId, nowMs);
      const latest = this.database.db.prepare(`SELECT * FROM reconciliation_reviews
        WHERE operation_id=? ORDER BY revision DESC LIMIT 1`).get(operationId) as any;
      if (latest && latest.proof_hash === result.proofHash) return result;
      const revision = Number(latest?.revision ?? 0) + 1;
      this.database.db.prepare(`INSERT INTO reconciliation_reviews(
        operation_id,revision,verdict,anomalies_json,evidence_fact_ids_json,proof_hash,
        actor_id,note,created_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        operationId,
        revision,
        result.verdict,
        JSON.stringify(result.anomalies),
        JSON.stringify(result.evidenceFactIds),
        result.proofHash,
        actorId,
        note,
        nowMs,
      );
      this.addEvidence(operationId, 'RECONCILER', 'RECONCILIATION_REVIEW', nowMs, `review:${revision}`, {
        verdict: result.verdict,
        proofHash: result.proofHash,
      });
      return result;
    });
  }

  manualResolve(operationId: string, actorId: string, input: ManualResolutionInput) {
    if (input.rationale.trim().length < 8) throw new Error('RATIONALE_REQUIRED');
    return this.database.transaction(() => {
      this.requireOperation(operationId);
      const current = this.deriveReconciliation(operationId, input.nowMs);
      if (input.targetVerdict !== current.verdict) throw new Error('MANUAL_RESOLUTION_UNSUPPORTED_BY_EVIDENCE');
      const requestedFacts = exactStrings(input.referencedFactIds, 'FACT_IDS');
      if (requestedFacts.length < 1 || requestedFacts.some((id) => !current.evidenceFactIds.includes(id))) {
        throw new Error('INVALID_REFERENCED_FACTS');
      }
      const latest = this.database.db.prepare(`SELECT * FROM manual_resolutions
        WHERE operation_id=? ORDER BY revision DESC LIMIT 1`).get(operationId) as any;
      const expectedPrevious = latest?.new_proof_hash ?? current.proofHash;
      if (input.previousProofHash !== expectedPrevious) throw new Error('STALE_PROOF_HASH');
      const revision = Number(latest?.revision ?? 0) + 1;
      const resolutionValue: CanonicalValue = {
        operationId,
        revision,
        targetVerdict: input.targetVerdict,
        rationale: input.rationale,
        referencedFactIds: [...requestedFacts],
        previousProofHash: input.previousProofHash,
        actorId,
        createdAtMs: input.nowMs,
      };
      const newProofHash = `sha256:${sha256Hex(canonicalize(resolutionValue))}`;
      this.database.db.prepare(`INSERT INTO manual_resolutions(
        operation_id,revision,target_verdict,rationale,referenced_fact_ids_json,
        previous_proof_hash,new_proof_hash,actor_id,created_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        operationId,
        revision,
        input.targetVerdict,
        input.rationale,
        JSON.stringify(requestedFacts),
        input.previousProofHash,
        newProofHash,
        actorId,
        input.nowMs,
      );
      this.addEvidence(operationId, 'REVIEWER', 'MANUAL_RESOLUTION', input.nowMs, `resolution:${revision}`, {
        targetVerdict: input.targetVerdict,
        previousProofHash: input.previousProofHash,
        newProofHash,
      });
      return Object.freeze({ operationId, revision, targetVerdict: input.targetVerdict, newProofHash });
    });
  }

  declareScope(input: ScopeDeclarationInput, actorId: string) {
    const expectedDevices = exactStrings(input.expectedReportingDeviceIds, 'EXPECTED_DEVICES');
    const expectedOperations = exactStrings(input.expectedOperationIds, 'EXPECTED_OPERATIONS');
    if (!Number.isSafeInteger(input.declarationVersion) || input.declarationVersion < 1) {
      throw new Error('INVALID_DECLARATION_VERSION');
    }
    if (input.expectedOperationCount !== null &&
        (!Number.isSafeInteger(input.expectedOperationCount) || input.expectedOperationCount < 0)) {
      throw new Error('INVALID_EXPECTED_OPERATION_COUNT');
    }
    if (input.provenance.trim().length < 3) throw new Error('INVALID_PROVENANCE');
    return this.database.transaction(() => {
      const latest = this.database.db.prepare(`SELECT * FROM scope_manifests
        WHERE scope_type=? AND scope_id=? ORDER BY declaration_version DESC LIMIT 1`).get(
          input.scopeType,
          input.scopeId,
        ) as any;
      if (input.declarationVersion !== Number(latest?.declaration_version ?? 0) + 1) {
        throw new Error('DECLARATION_VERSION_CONFLICT');
      }
      const expectedPrevious = latest?.manifest_hash ?? null;
      if (input.previousManifestHash !== expectedPrevious) throw new Error('STALE_MANIFEST_HASH');
      const manifestValue: CanonicalValue = {
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        declarationVersion: input.declarationVersion,
        expectedReportingDeviceIds: [...expectedDevices],
        expectedOperationIds: [...expectedOperations],
        expectedOperationCount: input.expectedOperationCount,
        declaredAtMs: input.declaredAtMs,
        provenance: input.provenance,
        previousManifestHash: input.previousManifestHash,
        actorId,
      };
      const manifestHash = `sha256:${sha256Hex(canonicalize(manifestValue))}`;
      this.database.db.prepare(`INSERT INTO scope_manifests(
        scope_type,scope_id,declaration_version,expected_devices_json,expected_operations_json,
        expected_operation_count,declared_at_ms,provenance,previous_manifest_hash,manifest_hash,actor_id
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        input.scopeType,
        input.scopeId,
        input.declarationVersion,
        JSON.stringify(expectedDevices),
        JSON.stringify(expectedOperations),
        input.expectedOperationCount,
        input.declaredAtMs,
        input.provenance,
        input.previousManifestHash,
        manifestHash,
        actorId,
      );
      return Object.freeze({ ...input, expectedReportingDeviceIds: expectedDevices, expectedOperationIds: expectedOperations, manifestHash });
    });
  }

  completeness(scopeType: ScopeDeclarationInput['scopeType'], scopeId: string, nowMs: number) {
    const manifest = this.database.db.prepare(`SELECT * FROM scope_manifests
      WHERE scope_type=? AND scope_id=? ORDER BY declaration_version DESC LIMIT 1`).get(
        scopeType,
        scopeId,
      ) as any;
    if (!manifest) throw new Error('SCOPE_NOT_DECLARED');
    const operations = this.database.db.prepare(`SELECT operation_id,state,application_outcome,device_id
      FROM operations WHERE scope_type=? AND scope_id=? ORDER BY operation_id`).all(scopeType, scopeId) as any[];
    const observedOperationIds = operations.map((operation) => String(operation.operation_id));
    const terminalOperationIds = operations.filter((operation) =>
      ['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(String(operation.state)),
    ).map((operation) => String(operation.operation_id));
    const unknownOperationIds = operations.filter((operation) =>
      String(operation.application_outcome) === 'UNKNOWN' || String(operation.state) === 'UNKNOWN',
    ).map((operation) => String(operation.operation_id));
    const observedDevices = (this.database.db.prepare(`SELECT device_id FROM reporting_devices
      WHERE scope_type=? AND scope_id=? ORDER BY device_id`).all(scopeType, scopeId) as any[])
      .map((row) => String(row.device_id));
    return createCompletenessCertificate({
      scopeType,
      scopeId,
      declarationVersion: Number(manifest.declaration_version),
      expectedReportingDeviceIds: JSON.parse(String(manifest.expected_devices_json)),
      expectedOperationIds: JSON.parse(String(manifest.expected_operations_json)),
      expectedOperationCount: manifest.expected_operation_count === null
        ? null
        : Number(manifest.expected_operation_count),
      observedReportingDeviceIds: observedDevices,
      observedOperationIds,
      terminalOperationIds,
      unknownOperationIds,
      declaredAtMs: Number(manifest.declared_at_ms),
      declarationProvenance: String(manifest.provenance),
      issuedAtMs: nowMs,
    });
  }

  getOperation(operationId: string): Readonly<Record<string, unknown>> {
    const operation = this.requireOperation(operationId);
    const attempts = this.database.db.prepare(
      'SELECT * FROM attempts WHERE operation_id=? ORDER BY started_at_ms',
    ).all(operationId);
    const evidence = this.listEvidence(operationId);
    const receipt = parseReceipt(
      this.database.db.prepare('SELECT * FROM receipts WHERE operation_id=?').get(operationId),
    );
    const reviews = this.database.db.prepare(
      'SELECT * FROM reconciliation_reviews WHERE operation_id=? ORDER BY revision',
    ).all(operationId);
    const resolutions = this.database.db.prepare(
      'SELECT * FROM manual_resolutions WHERE operation_id=? ORDER BY revision',
    ).all(operationId);
    const lease = this.database.db.prepare('SELECT * FROM leases WHERE operation_id=?').get(operationId) ?? null;
    return Object.freeze({ operation: rowObject(operation), attempts, lease, evidence, receipt, reviews, resolutions });
  }

  listOperationsPage(input: { q?: string; state?: string; limit?: number; offset?: number } = {}): OperationPage {
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const offset = Math.max(Number(input.offset ?? 0), 0);
    const q = `%${input.q ?? ''}%`;
    const state = input.state ?? '';
    const where = `(operation_id LIKE ? OR work_order_id LIKE ?) AND (?='' OR state=?)`;
    const totalRow = this.database.db.prepare(`SELECT COUNT(*) AS total FROM operations WHERE ${where}`)
      .get(q, q, state, state) as any;
    const items = this.database.db.prepare(`SELECT
      operation_id,work_order_id,scope_type,scope_id,device_id,state,application_outcome,
      created_at_ms,updated_at_ms FROM operations WHERE ${where}
      ORDER BY updated_at_ms DESC,operation_id LIMIT ? OFFSET ?`).all(
        q,
        q,
        state,
        state,
        limit,
        offset,
      ) as readonly Record<string, unknown>[];
    const total = Number(totalRow.total);
    return Object.freeze({
      items: Object.freeze(items),
      total,
      limit,
      offset,
      nextOffset: offset + items.length < total ? offset + items.length : null,
    });
  }

  listOperations(input: { q?: string; state?: string; limit?: number; offset?: number } = {}) {
    return this.listOperationsPage(input).items;
  }

  dashboard() {
    const counts = this.database.db.prepare(`SELECT
      COUNT(*) AS observed,
      SUM(CASE WHEN state IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED') THEN 1 ELSE 0 END) AS terminal,
      SUM(CASE WHEN state='UNKNOWN' OR application_outcome='UNKNOWN' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN state='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN state='REJECTED' THEN 1 ELSE 0 END) AS rejected
      FROM operations`).get() as any;
    return Object.freeze({
      observed: Number(counts.observed ?? 0),
      terminal: Number(counts.terminal ?? 0),
      unknown: Number(counts.unknown ?? 0),
      completed: Number(counts.completed ?? 0),
      rejected: Number(counts.rejected ?? 0),
    });
  }

  queues() {
    const ambiguity = this.database.db.prepare(`SELECT operation_id,work_order_id,state,application_outcome,updated_at_ms
      FROM operations WHERE state='UNKNOWN' OR application_outcome='UNKNOWN'
      ORDER BY updated_at_ms ASC`).all();
    const reconciliation = this.database.db.prepare(`SELECT o.operation_id,o.work_order_id,o.state,o.application_outcome,
      COALESCE((SELECT verdict FROM reconciliation_reviews r WHERE r.operation_id=o.operation_id ORDER BY revision DESC LIMIT 1),'UNREVIEWED') AS verdict
      FROM operations o WHERE o.state='UNKNOWN' OR EXISTS(
        SELECT 1 FROM evidence e WHERE e.operation_id=o.operation_id AND e.kind IN ('DUPLICATE','EXTERNAL_ASSERTION')
      ) ORDER BY o.updated_at_ms ASC`).all();
    return Object.freeze({ ambiguity, reconciliation });
  }

  cancel(operationId: string, nowMs: number): void {
    this.database.transaction(() => {
      const operation = this.requireOperation(operationId);
      if (['COMPLETED', 'REJECTED', 'EXPIRED', 'CANCELLED'].includes(String(operation.state))) {
        throw new Error('TERMINAL_OPERATION');
      }
      const envelope = decodeEnvelopeFromStored(operation);
      if (!envelope.policy.cancellationAllowed) throw new Error('CANCELLATION_NOT_ALLOWED');
      this.database.db.prepare(
        'UPDATE operations SET state=?,cancellation_requested=1,updated_at_ms=? WHERE operation_id=?',
      ).run('CANCELLED', nowMs, operationId);
      this.addEvidence(operationId, 'DEVICE', 'REJECTED', nowMs, 'cancel', { reason: 'USER_CANCELLED' });
    });
  }

  listKeys() {
    return this.keyProvider.list();
  }

  rotateKey(nowMs: number, validityMs: number) {
    const keyId = this.keyProvider.rotate(nowMs, validityMs);
    return Object.freeze({ keyId, keys: this.keyProvider.list() });
  }

  revokeKey(keyId: string, nowMs: number) {
    this.keyProvider.revoke(keyId, nowMs);
    return Object.freeze({ keyId, revokedAtMs: nowMs, keys: this.keyProvider.list() });
  }

  auditAuth(subject: string, action: string, resource: string, allowed: boolean, detail: string, nowMs = Date.now()) {
    this.database.db.prepare(`INSERT INTO auth_audit(
      subject,action,resource,allowed,observed_at_ms,detail
    ) VALUES(?,?,?,?,?,?)`).run(subject, action, resource, allowed ? 1 : 0, nowMs, detail);
  }

  listAuthAudit(limit = 100) {
    return this.database.db.prepare(`SELECT * FROM auth_audit
      ORDER BY observed_at_ms DESC,audit_id DESC LIMIT ?`).all(Math.min(Math.max(limit, 1), 500));
  }

  private deriveReconciliation(operationId: string, nowMs: number): ReconciliationResult {
    const facts = this.listEvidence(operationId).map((row): OperationFact => ({
      factId: `fact_${row.evidence_id}`,
      operationId,
      source: row.source as FactSource,
      kind: row.kind as FactKind,
      occurredAtMs: Number(row.occurred_at_ms),
      reference: String(row.reference),
      payload: JSON.parse(String(row.payload_json)),
    }));
    return reconcileFacts(operationId, facts, nowMs);
  }

  private requireOperation(operationId: string): any {
    const row = this.database.db.prepare('SELECT * FROM operations WHERE operation_id=?').get(operationId);
    if (!row) throw new Error('OPERATION_NOT_FOUND');
    return row;
  }

  private listEvidence(operationId: string): any[] {
    return this.database.db.prepare(
      'SELECT * FROM evidence WHERE operation_id=? ORDER BY occurred_at_ms,evidence_id',
    ).all(operationId) as any[];
  }

  private addEvidence(
    operationId: string,
    source: FactSource,
    kind: FactKind,
    occurredAtMs: number,
    reference: string,
    payload: Readonly<Record<string, CanonicalValue>>,
  ): void {
    const hash = evidenceHash({ source, kind, occurredAtMs, reference, payload });
    this.database.db.prepare(`INSERT OR IGNORE INTO evidence(
      operation_id,source,kind,occurred_at_ms,reference,payload_json,evidence_sha256
    ) VALUES(?,?,?,?,?,?,?)`).run(
      operationId,
      source,
      kind,
      occurredAtMs,
      reference,
      canonicalize(payload as CanonicalValue),
      hash,
    );
  }
}

export function decodeEnvelopeFromStored(operation: Record<string, unknown>): OperationEnvelope {
  return JSON.parse(String(operation.payload_json)) as OperationEnvelope;
}
