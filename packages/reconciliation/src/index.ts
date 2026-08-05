import { canonicalize, sha256Hex, type CanonicalValue } from '../../protocol-core/src/canonical.js';

export type FactSource = 'DEVICE' | 'RECEIVER' | 'APPLICATION' | 'MIDDLEWARE' | 'ERP' | 'RECONCILER';
export type FactKind = 'QUEUED' | 'TRANSPORT_ACCEPTED' | 'RECEIVER_ACCEPTED' | 'EFFECT_APPLIED' | 'NO_EFFECT' | 'REJECTED' | 'APPLICATION_ACK' | 'SIGNED_RECEIPT' | 'DUPLICATE' | 'COMPENSATED';
export interface OperationFact {
  readonly factId: string;
  readonly operationId: string;
  readonly source: FactSource;
  readonly kind: FactKind;
  readonly occurredAtMs: number;
  readonly reference: string;
  readonly payload: Readonly<Record<string, CanonicalValue>>;
}
export type ExecutionVerdict = 'EFFECT_CONFIRMED' | 'NO_EFFECT_CONFIRMED' | 'REJECTED' | 'UNKNOWN' | 'DUPLICATE_CONFIRMED' | 'COMPENSATION_REQUIRED';
export type ReconciliationAnomaly = 'MISSING_APPLICATION_ACK' | 'MISSING_SIGNED_RECEIPT' | 'CONTRADICTORY_EFFECT' | 'ORPHAN_EXTERNAL_RECORD' | 'DUPLICATE_FACT' | 'RECEIVER_ONLY_ACCEPTANCE';
export interface ReconciliationResult {
  readonly operationId: string;
  readonly verdict: ExecutionVerdict;
  readonly anomalies: readonly ReconciliationAnomaly[];
  readonly evidenceFactIds: readonly string[];
  readonly derivedAtMs: number;
  readonly proofHash: string;
}

export function normalizeFact(input: OperationFact): Readonly<OperationFact> {
  if (!/^fact_[A-Za-z0-9._:-]{1,128}$/.test(input.factId)) throw new TypeError('invalid factId');
  if (!/^op_[A-Za-z0-9._:-]{1,128}$/.test(input.operationId)) throw new TypeError('invalid operationId');
  if (!Number.isSafeInteger(input.occurredAtMs) || input.occurredAtMs < 0) throw new TypeError('invalid fact time');
  return Object.freeze({ ...input, payload: Object.freeze({ ...input.payload }) });
}

export function reconcileFacts(operationId: string, factsInput: readonly OperationFact[], derivedAtMs: number): ReconciliationResult {
  const facts = factsInput.map(normalizeFact).filter((fact) => fact.operationId === operationId).sort((a,b) => a.occurredAtMs - b.occurredAtMs || a.factId.localeCompare(b.factId));
  const kinds = new Set(facts.map((fact) => fact.kind));
  const anomalies = new Set<ReconciliationAnomaly>();
  const duplicateIds = facts.map((f) => f.factId).filter((id, i, all) => all.indexOf(id) !== i);
  if (duplicateIds.length) anomalies.add('DUPLICATE_FACT');
  if (kinds.has('EFFECT_APPLIED') && kinds.has('NO_EFFECT')) anomalies.add('CONTRADICTORY_EFFECT');
  if (kinds.has('EFFECT_APPLIED') && !kinds.has('APPLICATION_ACK')) anomalies.add('MISSING_APPLICATION_ACK');
  if (kinds.has('APPLICATION_ACK') && !kinds.has('SIGNED_RECEIPT')) anomalies.add('MISSING_SIGNED_RECEIPT');
  if (kinds.has('RECEIVER_ACCEPTED') && !kinds.has('EFFECT_APPLIED') && !kinds.has('NO_EFFECT') && !kinds.has('REJECTED')) anomalies.add('RECEIVER_ONLY_ACCEPTANCE');
  const hasExternalWithoutDevice = facts.some((f) => ['ERP','MIDDLEWARE'].includes(f.source)) && !facts.some((f) => f.source === 'DEVICE');
  if (hasExternalWithoutDevice) anomalies.add('ORPHAN_EXTERNAL_RECORD');

  let verdict: ExecutionVerdict = 'UNKNOWN';
  if (anomalies.has('CONTRADICTORY_EFFECT')) verdict = 'COMPENSATION_REQUIRED';
  else if (kinds.has('COMPENSATED')) verdict = 'NO_EFFECT_CONFIRMED';
  else if (kinds.has('EFFECT_APPLIED') && kinds.has('APPLICATION_ACK') && kinds.has('SIGNED_RECEIPT')) verdict = 'EFFECT_CONFIRMED';
  else if (kinds.has('NO_EFFECT') && (kinds.has('APPLICATION_ACK') || facts.some((f) => f.source === 'ERP'))) verdict = 'NO_EFFECT_CONFIRMED';
  else if (kinds.has('REJECTED')) verdict = 'REJECTED';
  else if (kinds.has('DUPLICATE') && kinds.has('SIGNED_RECEIPT')) verdict = 'DUPLICATE_CONFIRMED';

  const evidenceFactIds = Object.freeze([...new Set(facts.map((f) => f.factId))]);
  const proof: CanonicalValue = { operationId, verdict, anomalies: [...anomalies].sort(), evidenceFactIds: [...evidenceFactIds], derivedAtMs };
  return Object.freeze({ operationId, verdict, anomalies: Object.freeze([...anomalies].sort()), evidenceFactIds, derivedAtMs, proofHash: `sha256:${sha256Hex(canonicalize(proof))}` });
}

export interface CompletenessCertificate {
  readonly schema: 'zungun.completeness.v1';
  readonly scopeType: 'ROUTE' | 'SHIFT' | 'DEVICE' | 'BATCH';
  readonly scopeId: string;
  readonly reportingDeviceIds: readonly string[];
  readonly observedOperations: number;
  readonly terminalOperations: number;
  readonly unknownOperations: number;
  readonly completeWithinDeclaredScope: boolean;
  readonly issuedAtMs: number;
  readonly certificateHash: string;
}

export function createCompletenessCertificate(input: Omit<CompletenessCertificate, 'schema' | 'completeWithinDeclaredScope' | 'certificateHash'>): CompletenessCertificate {
  const completeWithinDeclaredScope = input.observedOperations === input.terminalOperations && input.unknownOperations === 0;
  const base: CanonicalValue = { ...input, reportingDeviceIds: [...input.reportingDeviceIds].sort(), completeWithinDeclaredScope } as CanonicalValue;
  return Object.freeze({ schema: 'zungun.completeness.v1', ...input, reportingDeviceIds: Object.freeze([...input.reportingDeviceIds].sort()), completeWithinDeclaredScope, certificateHash: `sha256:${sha256Hex(canonicalize(base))}` });
}
