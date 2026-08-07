import { canonicalize, type CanonicalValue } from '../../../packages/protocol-core/src/canonical.js';
import {
  appendWitnessEvidence,
  buildIncidentProofBundle,
  parseWitnessEvidenceInput,
  reconcileWitnessHistories,
  verifyWitnessChain,
  type IncidentProofBundle,
  type WitnessEvidence,
  type WitnessEvidenceInput,
  type WitnessReconciliation,
} from '../../../packages/protocol-core/src/witness.js';
import { ReceiverDatabase } from './database.js';

const SENDER_STATES = new Set(['DETECTED', 'COMMITTED_LOCAL', 'CUSTODY_ACCEPTED']);
const RESERVED_ATTESTATION_STATES = new Set(['DETECTED', 'COMMITTED_LOCAL', 'CUSTODY_ACCEPTED', 'DELIVERED_DURABLY', 'RECONCILED']);

function parseEvidence(raw: unknown): WitnessEvidence {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('WITNESS_INVALID_EVIDENCE');
  return raw as WitnessEvidence;
}

export class WitnessReceiver {
  constructor(
    readonly database: ReceiverDatabase,
    readonly receiverId = 'receiver_local_1',
  ) {}

  chain(operationId: string): readonly WitnessEvidence[] {
    this.requireOperation(operationId);
    const rows = this.database.db.prepare(
      'SELECT evidence_json FROM witness_evidence WHERE operation_id=? ORDER BY chain_position',
    ).all(operationId) as Array<{ evidence_json: string }>;
    const chain = Object.freeze(rows.map((row) => JSON.parse(row.evidence_json) as WitnessEvidence));
    if (chain.length > 0) verifyWitnessChain(chain);
    return chain;
  }

  ingestSender(operationId: string, rawChain: unknown, nowMs: number): readonly WitnessEvidence[] {
    if (!Array.isArray(rawChain) || rawChain.length < 1) throw new Error('WITNESS_SENDER_CHAIN_REQUIRED');
    const sender = Object.freeze(rawChain.map(parseEvidence));
    verifyWitnessChain(sender);
    if (sender.some((item) => item.incidentId !== operationId)) throw new Error('WITNESS_INCIDENT_MISMATCH');
    if (sender.some((item) => !SENDER_STATES.has(item.state))) throw new Error('WITNESS_SENDER_BOUNDARY_EXCEEDED');
    if (sender.at(-1)?.state !== 'CUSTODY_ACCEPTED') throw new Error('WITNESS_CUSTODY_REQUIRED');

    return this.database.transaction(() => {
      this.requireOperation(operationId);
      const existing = this.chainWithinTransaction(operationId);
      if (existing.length > 0) {
        for (let index = 0; index < sender.length; index += 1) {
          if (existing[index]?.evidenceHash !== sender[index]?.evidenceHash) throw new Error('WITNESS_DIVERGENT_HISTORY');
        }
        if (existing.some((item) => item.state === 'DELIVERED_DURABLY')) return existing;
        if (existing.length !== sender.length) throw new Error('WITNESS_DIVERGENT_HISTORY');
      } else {
        sender.forEach((item) => this.persist(operationId, item, nowMs));
      }
      const base = existing.length > 0 ? existing : sender;
      const previous = base.at(-1)!;
      const durable = appendWitnessEvidence(base, {
        incidentId: operationId,
        evidenceId: `receiver:${operationId}:durable`,
        state: 'DELIVERED_DURABLY',
        evidenceClass: 'MACHINE_ASSERTION',
        emitterId: `receiver:${this.receiverId}`,
        authorizationScope: 'witness:receiver',
        observedAtMs: nowMs,
        monotonicMs: previous.monotonicMs + 1,
        provenance: 'receiver:sqlite',
        reasonCode: 'RECEIVER_DURABLE_COMMIT',
        claims: Object.freeze({
          boundaryRole: 'RECEIVER',
          receiverId: this.receiverId,
          durableReceiptRef: `sqlite:witness_evidence:${operationId}`,
        }),
      });
      this.persist(operationId, durable, nowMs);
      return Object.freeze([...base, durable]);
    });
  }

  attest(operationId: string, raw: unknown, actorId: string, nowMs: number): WitnessEvidence {
    const input = parseWitnessEvidenceInput(raw);
    if (input.incidentId !== operationId) throw new Error('WITNESS_INCIDENT_MISMATCH');
    if (RESERVED_ATTESTATION_STATES.has(input.state)) throw new Error('WITNESS_RESERVED_TRANSITION');
    if (input.authorizationScope !== 'witness:attest') throw new Error('WITNESS_ATTEST_SCOPE_REQUIRED');
    return this.database.transaction(() => {
      const chain = this.chainWithinTransaction(operationId);
      if (!chain.some((item) => item.state === 'DELIVERED_DURABLY')) throw new Error('WITNESS_RECEIVER_DURABILITY_REQUIRED');
      const next = appendWitnessEvidence(chain, Object.freeze({
        ...input,
        emitterId: input.emitterId || `actor:${actorId}`,
        observedAtMs: input.observedAtMs || nowMs,
      }) as WitnessEvidenceInput);
      this.persist(operationId, next, nowMs);
      return next;
    });
  }

  reconcile(operationId: string, rawSenderChain: unknown): WitnessReconciliation {
    if (!Array.isArray(rawSenderChain)) throw new Error('WITNESS_SENDER_CHAIN_REQUIRED');
    const sender = Object.freeze(rawSenderChain.map(parseEvidence));
    const receiver = this.chain(operationId);
    return reconcileWitnessHistories(sender, receiver);
  }

  bundle(operationId: string): IncidentProofBundle {
    const chain = this.chain(operationId);
    if (chain.length === 0) throw new Error('WITNESS_EMPTY_INCIDENT');
    return buildIncidentProofBundle(chain);
  }

  private chainWithinTransaction(operationId: string): readonly WitnessEvidence[] {
    this.requireOperation(operationId);
    const rows = this.database.db.prepare(
      'SELECT evidence_json FROM witness_evidence WHERE operation_id=? ORDER BY chain_position',
    ).all(operationId) as Array<{ evidence_json: string }>;
    const chain = Object.freeze(rows.map((row) => JSON.parse(row.evidence_json) as WitnessEvidence));
    if (chain.length > 0) verifyWitnessChain(chain);
    return chain;
  }

  private persist(operationId: string, item: WitnessEvidence, persistedAtMs: number): void {
    const json = canonicalize(item as unknown as CanonicalValue);
    this.database.db.prepare(`INSERT INTO witness_evidence(
      evidence_id,incident_id,operation_id,chain_position,state,evidence_json,evidence_sha256,previous_hash,persisted_at_ms
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      item.evidenceId,
      item.incidentId,
      operationId,
      item.chainPosition,
      item.state,
      json,
      item.evidenceHash,
      item.previousHash,
      persistedAtMs,
    );
  }

  private requireOperation(operationId: string): void {
    const row = this.database.db.prepare('SELECT operation_id FROM operations WHERE operation_id=?').get(operationId);
    if (!row) throw new Error('OPERATION_NOT_FOUND');
  }
}
