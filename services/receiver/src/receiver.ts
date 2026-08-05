import { randomUUID } from 'node:crypto';
import { canonicalize, type CanonicalValue } from '../../../packages/protocol-core/src/canonical.js';
import { envelopeCommitment, validateEnvelope, type OperationEnvelope } from '../../../packages/protocol-core/src/operation.js';
import { createCompletenessCertificate, reconcileFacts, type OperationFact, type ReconciliationResult } from '../../../packages/reconciliation/src/index.js';
import { signExecutionReceipt, type ReceiptKeyProvider, type SignedExecutionReceipt } from '../../../packages/security/src/receipts.js';
import { ReceiverDatabase, evidenceHash } from './database.js';

export interface AcceptResult { readonly operationId: string; readonly duplicate: boolean; readonly state: string; readonly envelopeCommitment: string; readonly receipt: SignedExecutionReceipt | null; }
export interface ClaimResult { readonly operationId: string; readonly attemptId: string; readonly ownerId: string; readonly fencingToken: number; readonly leaseExpiresAtMs: number; }
export interface EffectInput { readonly outcome: 'EFFECT_APPLIED' | 'NO_EFFECT' | 'REJECTED' | 'UNKNOWN'; readonly applicationReference: string; readonly workOrderStatus: string; readonly result: Readonly<Record<string, CanonicalValue>>; readonly occurredAtMs: number; }

function rowObject(row: any): Record<string, unknown> { return row as Record<string, unknown>; }
function parseReceipt(row: any): SignedExecutionReceipt | null {
  if (!row) return null;
  return Object.freeze({ payload: JSON.parse(row.payload_json), keyId: row.key_id, algorithm: row.algorithm, signatureBase64: row.signature_base64, payloadSha256: row.payload_sha256 }) as SignedExecutionReceipt;
}

export class PersistentReceiver {
  constructor(readonly database: ReceiverDatabase, readonly keyProvider: ReceiptKeyProvider, readonly receiverId = 'receiver_local_1') {
    database.migrate();
  }

  accept(rawEnvelope: unknown, observedAtMs: number): AcceptResult {
    const envelope = validateEnvelope(rawEnvelope, observedAtMs);
    const commitment = envelopeCommitment(envelope);
    return this.database.transaction(() => {
      const replay = this.database.db.prepare('SELECT operation_id,envelope_commitment FROM replay_ledger WHERE replay_nonce=?').get(envelope.replayNonce) as any;
      if (replay && replay.operation_id !== envelope.operationId) throw new Error('REPLAY_DETECTED');
      const existing = this.database.db.prepare('SELECT * FROM operations WHERE operation_id=? OR idempotency_key=?').get(envelope.operationId, envelope.idempotencyKey) as any;
      if (existing) {
        if (existing.message_commitment !== envelope.messageCommitment || existing.envelope_commitment !== commitment) throw new Error('DUPLICATE_CONFLICT');
        const receipt = parseReceipt(this.database.db.prepare('SELECT * FROM receipts WHERE operation_id=?').get(existing.operation_id));
        return Object.freeze({ operationId: existing.operation_id, duplicate: true, state: existing.state, envelopeCommitment: commitment, receipt });
      }
      const deviceId = typeof envelope.extensions.deviceId === 'string' ? envelope.extensions.deviceId : 'unknown_device';
      this.database.db.prepare(`INSERT INTO operations(
        operation_id,idempotency_key,tenant_id,message_id,message_commitment,envelope_commitment,work_order_id,scope_type,scope_id,device_id,payload_json,replay_nonce,state,application_outcome,created_at_ms,updated_at_ms,expires_at_ms
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        envelope.operationId,envelope.idempotencyKey,envelope.tenantId,envelope.messageId,envelope.messageCommitment,commitment,envelope.workOrderId,envelope.scopeType,envelope.scopeId,deviceId,canonicalize(envelope as unknown as CanonicalValue),envelope.replayNonce,'RECEIVER_ACCEPTED','UNKNOWN',envelope.policy.createdAtMs,observedAtMs,envelope.policy.expiresAtMs,
      );
      this.database.db.prepare('INSERT INTO replay_ledger(replay_nonce,operation_id,observed_at_ms,envelope_commitment) VALUES(?,?,?,?)').run(envelope.replayNonce,envelope.operationId,observedAtMs,commitment);
      this.database.db.prepare(`INSERT INTO reporting_devices(scope_type,scope_id,device_id,first_seen_at_ms,last_seen_at_ms) VALUES(?,?,?,?,?)
        ON CONFLICT(scope_type,scope_id,device_id) DO UPDATE SET last_seen_at_ms=excluded.last_seen_at_ms`).run(envelope.scopeType,envelope.scopeId,deviceId,observedAtMs,observedAtMs);
      this.addEvidence(envelope.operationId,'RECEIVER','RECEIVER_ACCEPTED',observedAtMs,`accept:${envelope.operationId}`,{ envelopeCommitment: commitment });
      return Object.freeze({ operationId: envelope.operationId, duplicate: false, state: 'RECEIVER_ACCEPTED', envelopeCommitment: commitment, receipt: null });
    });
  }

  claim(operationId: string, ownerId: string, nowMs: number, leaseMs = 30_000): ClaimResult {
    return this.database.transaction(() => {
      const operation = this.requireOperation(operationId);
      if (['COMPLETED','REJECTED','EXPIRED','CANCELLED'].includes(String(operation.state))) throw new Error('TERMINAL_OPERATION');
      const lease = this.database.db.prepare('SELECT * FROM leases WHERE operation_id=?').get(operationId) as any;
      if (lease && lease.expires_at_ms > nowMs && lease.owner_id !== ownerId) throw new Error('LEASE_HELD');
      const fencingToken = Number(operation.fencing_token) + 1;
      const attemptId = `attempt_${randomUUID()}`;
      this.database.db.prepare('UPDATE operations SET state=?,updated_at_ms=?,fencing_token=? WHERE operation_id=?').run('CLAIMED',nowMs,fencingToken,operationId);
      this.database.db.prepare(`INSERT INTO leases(operation_id,owner_id,fencing_token,expires_at_ms) VALUES(?,?,?,?)
        ON CONFLICT(operation_id) DO UPDATE SET owner_id=excluded.owner_id,fencing_token=excluded.fencing_token,expires_at_ms=excluded.expires_at_ms`).run(operationId,ownerId,fencingToken,nowMs+leaseMs);
      this.database.db.prepare('INSERT INTO attempts(attempt_id,operation_id,owner_id,fencing_token,status,started_at_ms,detail) VALUES(?,?,?,?,?,?,?)').run(attemptId,operationId,ownerId,fencingToken,'CLAIMED',nowMs,'lease acquired');
      this.addEvidence(operationId,'RECEIVER','TRANSPORT_ACCEPTED',nowMs,attemptId,{ ownerId, fencingToken });
      return Object.freeze({ operationId, attemptId, ownerId, fencingToken, leaseExpiresAtMs: nowMs + leaseMs });
    });
  }

  recordEffect(operationId: string, attemptId: string, fencingToken: number, input: EffectInput): { readonly state: string; readonly receipt: SignedExecutionReceipt | null } {
    return this.database.transaction(() => {
      const operation = this.requireOperation(operationId);
      const attempt = this.database.db.prepare('SELECT * FROM attempts WHERE attempt_id=? AND operation_id=?').get(attemptId,operationId) as any;
      const lease = this.database.db.prepare('SELECT * FROM leases WHERE operation_id=?').get(operationId) as any;
      if (!attempt || !lease || attempt.fencing_token !== fencingToken || lease.fencing_token !== fencingToken || lease.expires_at_ms < input.occurredAtMs) {
        if (attempt) this.database.db.prepare('UPDATE attempts SET status=?,completed_at_ms=?,detail=? WHERE attempt_id=?').run('LEASE_LOST',input.occurredAtMs,'fencing token or lease invalid',attemptId);
        throw new Error('LEASE_LOST');
      }
      if (operation.expires_at_ms <= input.occurredAtMs) {
        this.database.db.prepare('UPDATE operations SET state=?,updated_at_ms=? WHERE operation_id=?').run('EXPIRED',input.occurredAtMs,operationId);
        throw new Error('TTL_EXPIRED');
      }
      let state = 'UNKNOWN';
      if (input.outcome === 'EFFECT_APPLIED') {
        const workOrder = this.database.db.prepare('SELECT * FROM work_orders WHERE work_order_id=?').get(operation.work_order_id) as any;
        if (workOrder && workOrder.effect_operation_id !== operationId) throw new Error('APPLICATION_CONFLICT');
        this.database.db.prepare(`INSERT INTO work_orders(work_order_id,status,result_json,effect_operation_id,updated_at_ms) VALUES(?,?,?,?,?)
          ON CONFLICT(work_order_id) DO UPDATE SET status=excluded.status,result_json=excluded.result_json,updated_at_ms=excluded.updated_at_ms`).run(operation.work_order_id,input.workOrderStatus,canonicalize(input.result as CanonicalValue),operationId,input.occurredAtMs);
        state = 'COMPLETED';
      } else if (input.outcome === 'NO_EFFECT' || input.outcome === 'REJECTED') state = input.outcome === 'REJECTED' ? 'REJECTED' : 'COMPLETED';
      this.database.db.prepare('UPDATE operations SET state=?,application_outcome=?,application_reference=?,updated_at_ms=? WHERE operation_id=?').run(state,input.outcome,input.applicationReference,input.occurredAtMs,operationId);
      this.database.db.prepare('UPDATE attempts SET status=?,completed_at_ms=?,detail=? WHERE attempt_id=?').run(input.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'SUCCEEDED',input.occurredAtMs,input.applicationReference,attemptId);
      this.addEvidence(operationId,'APPLICATION',input.outcome === 'UNKNOWN' ? 'RECEIVER_ACCEPTED' : input.outcome,input.occurredAtMs,input.applicationReference,input.result);
      let receipt: SignedExecutionReceipt | null = null;
      if (input.outcome !== 'UNKNOWN') {
        receipt = signExecutionReceipt({
          schema:'zungun.execution-receipt.v1',protocolVersion:1,operationId,messageCommitment:operation.message_commitment,receiverId:this.receiverId,
          applicationOutcome:input.outcome,applicationReference:input.applicationReference,scopeType:operation.scope_type,scopeId:operation.scope_id,
          issuedAtMs:input.occurredAtMs,validFromMs:input.occurredAtMs-1,validUntilMs:input.occurredAtMs+86_400_000,replayNonce:operation.replay_nonce,
        },this.keyProvider);
        const receiptId = `receipt_${receipt.payloadSha256.slice(0,32)}`;
        this.database.db.prepare('INSERT OR REPLACE INTO receipts(receipt_id,operation_id,key_id,algorithm,payload_json,signature_base64,payload_sha256,issued_at_ms) VALUES(?,?,?,?,?,?,?,?)').run(receiptId,operationId,receipt.keyId,receipt.algorithm,canonicalize(receipt.payload as unknown as CanonicalValue),receipt.signatureBase64,receipt.payloadSha256,input.occurredAtMs);
        this.addEvidence(operationId,'RECEIVER','SIGNED_RECEIPT',input.occurredAtMs,receiptId,{ keyId: receipt.keyId, payloadSha256: receipt.payloadSha256 });
        this.addEvidence(operationId,'APPLICATION','APPLICATION_ACK',input.occurredAtMs,input.applicationReference,{ outcome: input.outcome });
      }
      return Object.freeze({ state, receipt });
    });
  }

  reconcile(operationId: string, actorId: string, note: string, nowMs: number): ReconciliationResult {
    return this.database.transaction(() => {
      this.requireOperation(operationId);
      const facts = this.listEvidence(operationId).map((row, index): OperationFact => ({
        factId:`fact_${row.evidence_id}_${index}`,operationId,source:row.source,kind:row.kind,occurredAtMs:row.occurred_at_ms,reference:row.reference,payload:JSON.parse(row.payload_json),
      }));
      const result = reconcileFacts(operationId,facts,nowMs);
      const revision = Number((this.database.db.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM reconciliation_reviews WHERE operation_id=?').get(operationId) as any).revision)+1;
      this.database.db.prepare('INSERT INTO reconciliation_reviews(operation_id,revision,verdict,anomalies_json,evidence_fact_ids_json,proof_hash,actor_id,note,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(operationId,revision,result.verdict,JSON.stringify(result.anomalies),JSON.stringify(result.evidenceFactIds),result.proofHash,actorId,note,nowMs);
      this.addEvidence(operationId,'RECONCILER','APPLICATION_ACK',nowMs,`review:${revision}`,{ verdict: result.verdict, proofHash: result.proofHash });
      return result;
    });
  }

  completeness(scopeType: 'ROUTE'|'SHIFT'|'DEVICE'|'BATCH', scopeId: string, nowMs: number) {
    const counts = this.database.db.prepare(`SELECT COUNT(*) AS observed,
      SUM(CASE WHEN state IN ('COMPLETED','REJECTED','EXPIRED','CANCELLED') THEN 1 ELSE 0 END) AS terminal,
      SUM(CASE WHEN application_outcome='UNKNOWN' OR state='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count
      FROM operations WHERE scope_type=? AND scope_id=?`).get(scopeType,scopeId) as any;
    const devices = (this.database.db.prepare('SELECT device_id FROM reporting_devices WHERE scope_type=? AND scope_id=? ORDER BY device_id').all(scopeType,scopeId) as any[]).map((row)=>row.device_id as string);
    return createCompletenessCertificate({ scopeType,scopeId,reportingDeviceIds:devices,observedOperations:Number(counts.observed),terminalOperations:Number(counts.terminal ?? 0),unknownOperations:Number(counts.unknown_count ?? 0),issuedAtMs:nowMs });
  }

  getOperation(operationId: string): Readonly<Record<string, unknown>> {
    const operation = this.requireOperation(operationId);
    const attempts = this.database.db.prepare('SELECT * FROM attempts WHERE operation_id=? ORDER BY started_at_ms').all(operationId);
    const evidence = this.listEvidence(operationId);
    const receipt = parseReceipt(this.database.db.prepare('SELECT * FROM receipts WHERE operation_id=?').get(operationId));
    const reviews = this.database.db.prepare('SELECT * FROM reconciliation_reviews WHERE operation_id=? ORDER BY revision').all(operationId);
    return Object.freeze({ operation: rowObject(operation), attempts, evidence, receipt, reviews });
  }

  listOperations(input: { q?: string; state?: string; limit?: number; offset?: number } = {}): readonly Record<string, unknown>[] {
    const limit = Math.min(Math.max(input.limit ?? 50,1),200); const offset=Math.max(input.offset ?? 0,0);
    const q=`%${input.q ?? ''}%`; const state=input.state ?? '';
    return this.database.db.prepare(`SELECT operation_id,work_order_id,scope_type,scope_id,device_id,state,application_outcome,created_at_ms,updated_at_ms
      FROM operations WHERE (operation_id LIKE ? OR work_order_id LIKE ?) AND (?='' OR state=?) ORDER BY updated_at_ms DESC LIMIT ? OFFSET ?`).all(q,q,state,state,limit,offset) as readonly Record<string,unknown>[];
  }

  cancel(operationId: string, nowMs: number): void {
    this.database.transaction(()=>{ const operation=this.requireOperation(operationId); if (['COMPLETED','REJECTED','EXPIRED','CANCELLED'].includes(String(operation.state))) throw new Error('TERMINAL_OPERATION'); this.database.db.prepare('UPDATE operations SET state=?,cancellation_requested=1,updated_at_ms=? WHERE operation_id=?').run('CANCELLED',nowMs,operationId); this.addEvidence(operationId,'DEVICE','REJECTED',nowMs,'cancel',{ reason:'USER_CANCELLED' }); });
  }

  private requireOperation(operationId: string): any { const row=this.database.db.prepare('SELECT * FROM operations WHERE operation_id=?').get(operationId); if(!row) throw new Error('OPERATION_NOT_FOUND'); return row; }
  private listEvidence(operationId: string): any[] { return this.database.db.prepare('SELECT * FROM evidence WHERE operation_id=? ORDER BY occurred_at_ms,evidence_id').all(operationId) as any[]; }
  private addEvidence(operationId: string, source: string, kind: string, occurredAtMs: number, reference: string, payload: Readonly<Record<string,CanonicalValue>>): void {
    const hash=evidenceHash({source,kind,occurredAtMs,reference,payload});
    this.database.db.prepare('INSERT OR IGNORE INTO evidence(operation_id,source,kind,occurred_at_ms,reference,payload_json,evidence_sha256) VALUES(?,?,?,?,?,?,?)').run(operationId,source,kind,occurredAtMs,reference,canonicalize(payload as CanonicalValue),hash);
  }
}

export function decodeEnvelopeFromStored(operation: Record<string,unknown>): OperationEnvelope { return JSON.parse(String(operation.payload_json)) as OperationEnvelope; }
