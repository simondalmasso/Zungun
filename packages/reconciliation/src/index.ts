import { canonicalize, sha256Hex, type CanonicalValue } from '../../protocol-core/src/canonical.js';

export type FactSource =
  | 'DEVICE'
  | 'RECEIVER'
  | 'APPLICATION'
  | 'MIDDLEWARE'
  | 'ERP'
  | 'RECONCILER'
  | 'REVIEWER'
  | 'ADMIN';

export type FactKind =
  | 'QUEUED'
  | 'TRANSPORT_ATTEMPT'
  | 'TRANSPORT_ACCEPTED'
  | 'RECEIVER_ACCEPTED'
  | 'EFFECT_APPLIED'
  | 'NO_EFFECT'
  | 'REJECTED'
  | 'APPLICATION_ACK'
  | 'SIGNED_RECEIPT'
  | 'DUPLICATE'
  | 'COMPENSATED'
  | 'RECONCILIATION_REVIEW'
  | 'MANUAL_RESOLUTION'
  | 'EXTERNAL_ASSERTION'
  | 'UNKNOWN';

export interface OperationFact {
  readonly factId: string;
  readonly operationId: string;
  readonly source: FactSource;
  readonly kind: FactKind;
  readonly occurredAtMs: number;
  readonly reference: string;
  readonly payload: Readonly<Record<string, CanonicalValue>>;
}

export type ExecutionVerdict =
  | 'EFFECT_CONFIRMED'
  | 'NO_EFFECT_CONFIRMED'
  | 'REJECTED'
  | 'UNKNOWN'
  | 'DUPLICATE_CONFIRMED'
  | 'COMPENSATION_REQUIRED';

export type ReconciliationAnomaly =
  | 'MISSING_APPLICATION_ACK'
  | 'MISSING_SIGNED_RECEIPT'
  | 'CONTRADICTORY_EFFECT'
  | 'ORPHAN_EXTERNAL_RECORD'
  | 'DUPLICATE_FACT'
  | 'RECEIVER_ONLY_ACCEPTANCE'
  | 'UNQUALIFIED_MANUAL_RESOLUTION';

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

function isApplicationAck(fact: Readonly<OperationFact>): boolean {
  return fact.source === 'APPLICATION' && fact.kind === 'APPLICATION_ACK';
}

function isQualifyingNoEffect(fact: Readonly<OperationFact>): boolean {
  return (
    fact.kind === 'NO_EFFECT' &&
    (fact.source === 'APPLICATION' || fact.source === 'ERP' || fact.source === 'MIDDLEWARE')
  );
}

export function reconcileFacts(
  operationId: string,
  factsInput: readonly OperationFact[],
  derivedAtMs: number,
): ReconciliationResult {
  const facts = factsInput
    .map(normalizeFact)
    .filter((fact) => fact.operationId === operationId)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.factId.localeCompare(b.factId));

  const evidentiaryFacts = facts.filter((fact) => !['RECONCILIATION_REVIEW', 'MANUAL_RESOLUTION'].includes(fact.kind));
  const kinds = new Set(evidentiaryFacts.map((fact) => fact.kind));
  const anomalies = new Set<ReconciliationAnomaly>();
  const duplicateIds = evidentiaryFacts.map((fact) => fact.factId).filter((id, index, all) => all.indexOf(id) !== index);
  const applicationAck = evidentiaryFacts.some(isApplicationAck);
  const signedReceipt = evidentiaryFacts.some((fact) => fact.source === 'RECEIVER' && fact.kind === 'SIGNED_RECEIPT');
  const effectApplied = evidentiaryFacts.some(
    (fact) => fact.kind === 'EFFECT_APPLIED' && ['APPLICATION', 'ERP', 'MIDDLEWARE'].includes(fact.source),
  );
  const noEffect = evidentiaryFacts.some(isQualifyingNoEffect);
  const rejected = evidentiaryFacts.some(
    (fact) => fact.kind === 'REJECTED' && ['APPLICATION', 'ERP', 'MIDDLEWARE'].includes(fact.source),
  );

  if (duplicateIds.length > 0) anomalies.add('DUPLICATE_FACT');
  if (effectApplied && noEffect) anomalies.add('CONTRADICTORY_EFFECT');
  if (effectApplied && !applicationAck) anomalies.add('MISSING_APPLICATION_ACK');
  if (applicationAck && !signedReceipt) anomalies.add('MISSING_SIGNED_RECEIPT');
  if (kinds.has('RECEIVER_ACCEPTED') && !effectApplied && !noEffect && !rejected) {
    anomalies.add('RECEIVER_ONLY_ACCEPTANCE');
  }
  const hasExternalWithoutDevice = evidentiaryFacts.some((fact) => ['ERP', 'MIDDLEWARE'].includes(fact.source)) &&
    !evidentiaryFacts.some((fact) => fact.source === 'DEVICE');
  if (hasExternalWithoutDevice) anomalies.add('ORPHAN_EXTERNAL_RECORD');

  let verdict: ExecutionVerdict = 'UNKNOWN';
  if (anomalies.has('CONTRADICTORY_EFFECT')) verdict = 'COMPENSATION_REQUIRED';
  else if (evidentiaryFacts.some((fact) => fact.kind === 'COMPENSATED')) verdict = 'NO_EFFECT_CONFIRMED';
  else if (effectApplied && applicationAck && signedReceipt) verdict = 'EFFECT_CONFIRMED';
  else if (noEffect && (applicationAck || evidentiaryFacts.some((fact) => fact.source === 'ERP'))) {
    verdict = 'NO_EFFECT_CONFIRMED';
  } else if (rejected) verdict = 'REJECTED';
  else if (evidentiaryFacts.some((fact) => fact.kind === 'DUPLICATE') && signedReceipt) verdict = 'DUPLICATE_CONFIRMED';

  const evidenceFactIds = Object.freeze([...new Set(evidentiaryFacts.map((fact) => fact.factId))]);
  const proof: CanonicalValue = {
    operationId,
    verdict,
    anomalies: [...anomalies].sort(),
    evidenceFactIds: [...evidenceFactIds],
  };
  return Object.freeze({
    operationId,
    verdict,
    anomalies: Object.freeze([...anomalies].sort()),
    evidenceFactIds,
    derivedAtMs,
    proofHash: `sha256:${sha256Hex(canonicalize(proof))}`,
  });
}

export interface DeclaredScopeInput {
  readonly scopeType: 'ROUTE' | 'SHIFT' | 'DEVICE' | 'BATCH';
  readonly scopeId: string;
  readonly declarationVersion: number;
  readonly expectedReportingDeviceIds: readonly string[];
  readonly expectedOperationIds: readonly string[];
  readonly expectedOperationCount: number | null;
  readonly observedReportingDeviceIds: readonly string[];
  readonly observedOperationIds: readonly string[];
  readonly terminalOperationIds: readonly string[];
  readonly unknownOperationIds: readonly string[];
  readonly declaredAtMs: number;
  readonly declarationProvenance: string;
  readonly issuedAtMs: number;
}

export interface CompletenessCertificate {
  readonly schema: 'zungun.completeness.v2';
  readonly scopeType: DeclaredScopeInput['scopeType'];
  readonly scopeId: string;
  readonly declarationVersion: number;
  readonly expectedReportingDeviceIds: readonly string[];
  readonly observedReportingDeviceIds: readonly string[];
  readonly missingReportingDeviceIds: readonly string[];
  readonly expectedOperationIds: readonly string[];
  readonly observedOperationIds: readonly string[];
  readonly missingOperationIds: readonly string[];
  readonly terminalOperationIds: readonly string[];
  readonly unknownOperationIds: readonly string[];
  readonly expectedOperationCount: number | null;
  readonly observedOperations: number;
  readonly terminalOperations: number;
  readonly unknownOperations: number;
  readonly declaredAtMs: number;
  readonly declarationProvenance: string;
  readonly completeWithinDeclaredScope: boolean;
  readonly issuedAtMs: number;
  readonly certificateHash: string;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

export function createCompletenessCertificate(input: DeclaredScopeInput): CompletenessCertificate {
  if (!Number.isSafeInteger(input.declarationVersion) || input.declarationVersion < 1) {
    throw new TypeError('invalid declarationVersion');
  }
  if (input.expectedOperationCount !== null &&
      (!Number.isSafeInteger(input.expectedOperationCount) || input.expectedOperationCount < 0)) {
    throw new TypeError('invalid expectedOperationCount');
  }

  const expectedDevices = sortedUnique(input.expectedReportingDeviceIds);
  const observedDevices = sortedUnique(input.observedReportingDeviceIds);
  const expectedOperations = sortedUnique(input.expectedOperationIds);
  const observedOperations = sortedUnique(input.observedOperationIds);
  const terminalOperations = sortedUnique(input.terminalOperationIds);
  const unknownOperations = sortedUnique(input.unknownOperationIds);
  const observedDeviceSet = new Set(observedDevices);
  const observedOperationSet = new Set(observedOperations);
  const missingDevices = Object.freeze(expectedDevices.filter((id) => !observedDeviceSet.has(id)));
  const missingOperations = Object.freeze(expectedOperations.filter((id) => !observedOperationSet.has(id)));
  const expectedCountSatisfied = input.expectedOperationCount === null ||
    observedOperations.length >= input.expectedOperationCount;
  const declaredPopulationPresent = missingDevices.length === 0 && missingOperations.length === 0 && expectedCountSatisfied;
  const allObservedTerminal = observedOperations.length === terminalOperations.length;
  const completeWithinDeclaredScope = declaredPopulationPresent && allObservedTerminal && unknownOperations.length === 0;

  const base: CanonicalValue = {
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    declarationVersion: input.declarationVersion,
    expectedReportingDeviceIds: [...expectedDevices],
    observedReportingDeviceIds: [...observedDevices],
    missingReportingDeviceIds: [...missingDevices],
    expectedOperationIds: [...expectedOperations],
    observedOperationIds: [...observedOperations],
    missingOperationIds: [...missingOperations],
    terminalOperationIds: [...terminalOperations],
    unknownOperationIds: [...unknownOperations],
    expectedOperationCount: input.expectedOperationCount,
    declaredAtMs: input.declaredAtMs,
    declarationProvenance: input.declarationProvenance,
    completeWithinDeclaredScope,
    issuedAtMs: input.issuedAtMs,
  };

  return Object.freeze({
    schema: 'zungun.completeness.v2',
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    declarationVersion: input.declarationVersion,
    expectedReportingDeviceIds: expectedDevices,
    observedReportingDeviceIds: observedDevices,
    missingReportingDeviceIds: missingDevices,
    expectedOperationIds: expectedOperations,
    observedOperationIds: observedOperations,
    missingOperationIds: missingOperations,
    terminalOperationIds: terminalOperations,
    unknownOperationIds: unknownOperations,
    expectedOperationCount: input.expectedOperationCount,
    observedOperations: observedOperations.length,
    terminalOperations: terminalOperations.length,
    unknownOperations: unknownOperations.length,
    declaredAtMs: input.declaredAtMs,
    declarationProvenance: input.declarationProvenance,
    completeWithinDeclaredScope,
    issuedAtMs: input.issuedAtMs,
    certificateHash: `sha256:${sha256Hex(canonicalize(base))}`,
  });
}
