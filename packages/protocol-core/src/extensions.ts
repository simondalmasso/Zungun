import { canonicalize, sha256Hex, type CanonicalValue } from './canonical.js';
import type { ExecutionVerdict } from '../../reconciliation/src/index.js';

export const DELIVERY_EVIDENCE_SCHEMA = 'zungun.delivery-evidence.v1' as const;
export const DECLARED_SCOPE_SCHEMA = 'zungun.declared-scope.v1' as const;
export const MANUAL_RESOLUTION_SCHEMA = 'zungun.manual-resolution.v1' as const;

export type DeliveryEvidenceKind =
  | 'QUEUED'
  | 'TRANSPORT_ATTEMPT'
  | 'RECEIVER_ACCEPTED'
  | 'APPLICATION_ACK'
  | 'SIGNED_RECEIPT'
  | 'UNKNOWN'
  | 'REJECTED';

export interface DeliveryEvidenceRecord {
  readonly schema: typeof DELIVERY_EVIDENCE_SCHEMA;
  readonly operationId: string;
  readonly source: 'DEVICE' | 'RECEIVER' | 'APPLICATION';
  readonly kind: DeliveryEvidenceKind;
  readonly occurredAtMs: number;
  readonly reference: string;
  readonly payload: Readonly<Record<string, CanonicalValue>>;
  readonly evidenceHash: string;
}

export interface DeclaredScopeManifest {
  readonly schema: typeof DECLARED_SCOPE_SCHEMA;
  readonly scopeType: 'ROUTE' | 'SHIFT' | 'DEVICE' | 'BATCH';
  readonly scopeId: string;
  readonly declarationVersion: number;
  readonly expectedReportingDeviceIds: readonly string[];
  readonly expectedOperationIds: readonly string[];
  readonly expectedOperationCount: number | null;
  readonly declaredAtMs: number;
  readonly provenance: string;
  readonly previousManifestHash: string | null;
  readonly manifestHash: string;
}

export interface ManualResolutionRecord {
  readonly schema: typeof MANUAL_RESOLUTION_SCHEMA;
  readonly operationId: string;
  readonly revision: number;
  readonly targetVerdict: ExecutionVerdict;
  readonly rationale: string;
  readonly referencedFactIds: readonly string[];
  readonly previousProofHash: string;
  readonly newProofHash: string;
  readonly actorId: string;
  readonly createdAtMs: number;
}

function opaque(value: string, label: string): string {
  if (!/^[A-Za-z0-9._:+/@-]{1,256}$/.test(value)) throw new Error(`INVALID_${label}`);
  return value;
}

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${label}`);
  return value;
}

export function deliveryEvidenceHash(input: Omit<DeliveryEvidenceRecord, 'schema' | 'evidenceHash'>): string {
  const canonical: CanonicalValue = {
    operationId: opaque(input.operationId, 'OPERATION_ID'),
    source: input.source,
    kind: input.kind,
    occurredAtMs: timestamp(input.occurredAtMs, 'OCCURRED_AT'),
    reference: opaque(input.reference, 'REFERENCE'),
    payload: input.payload,
  };
  return `sha256:${sha256Hex(canonicalize(canonical))}`;
}

export function validateDeliveryEvidence(value: DeliveryEvidenceRecord): Readonly<DeliveryEvidenceRecord> {
  if (value.schema !== DELIVERY_EVIDENCE_SCHEMA) throw new Error('UNSUPPORTED_EVIDENCE_SCHEMA');
  const expected = deliveryEvidenceHash(value);
  if (value.evidenceHash !== expected) throw new Error('EVIDENCE_HASH_MISMATCH');
  return Object.freeze({ ...value, payload: Object.freeze({ ...value.payload }) });
}

export function declaredScopeManifestHash(
  input: Omit<DeclaredScopeManifest, 'schema' | 'manifestHash'>,
): string {
  const expectedDevices = [...new Set(input.expectedReportingDeviceIds.map((id) => opaque(id, 'DEVICE_ID')))].sort();
  const expectedOperations = [...new Set(input.expectedOperationIds.map((id) => opaque(id, 'OPERATION_ID')))].sort();
  if (!Number.isSafeInteger(input.declarationVersion) || input.declarationVersion < 1) {
    throw new Error('INVALID_DECLARATION_VERSION');
  }
  if (input.expectedOperationCount !== null &&
      (!Number.isSafeInteger(input.expectedOperationCount) || input.expectedOperationCount < 0)) {
    throw new Error('INVALID_EXPECTED_OPERATION_COUNT');
  }
  const canonical: CanonicalValue = {
    scopeType: input.scopeType,
    scopeId: opaque(input.scopeId, 'SCOPE_ID'),
    declarationVersion: input.declarationVersion,
    expectedReportingDeviceIds: expectedDevices,
    expectedOperationIds: expectedOperations,
    expectedOperationCount: input.expectedOperationCount,
    declaredAtMs: timestamp(input.declaredAtMs, 'DECLARED_AT'),
    provenance: input.provenance,
    previousManifestHash: input.previousManifestHash,
  };
  return `sha256:${sha256Hex(canonicalize(canonical))}`;
}

export function validateDeclaredScopeManifest(
  value: DeclaredScopeManifest,
): Readonly<DeclaredScopeManifest> {
  if (value.schema !== DECLARED_SCOPE_SCHEMA) throw new Error('UNSUPPORTED_SCOPE_SCHEMA');
  if (value.manifestHash !== declaredScopeManifestHash(value)) throw new Error('MANIFEST_HASH_MISMATCH');
  return Object.freeze({
    ...value,
    expectedReportingDeviceIds: Object.freeze([...value.expectedReportingDeviceIds]),
    expectedOperationIds: Object.freeze([...value.expectedOperationIds]),
  });
}

export function manualResolutionHash(
  input: Omit<ManualResolutionRecord, 'schema' | 'newProofHash'>,
): string {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('INVALID_REVISION');
  if (input.rationale.trim().length < 8) throw new Error('RATIONALE_REQUIRED');
  const factIds = [...new Set(input.referencedFactIds.map((id) => opaque(id, 'FACT_ID')))].sort();
  if (factIds.length < 1) throw new Error('REFERENCED_FACTS_REQUIRED');
  const canonical: CanonicalValue = {
    operationId: opaque(input.operationId, 'OPERATION_ID'),
    revision: input.revision,
    targetVerdict: input.targetVerdict,
    rationale: input.rationale,
    referencedFactIds: factIds,
    previousProofHash: opaque(input.previousProofHash, 'PROOF_HASH'),
    actorId: opaque(input.actorId, 'ACTOR_ID'),
    createdAtMs: timestamp(input.createdAtMs, 'CREATED_AT'),
  };
  return `sha256:${sha256Hex(canonicalize(canonical))}`;
}

export function validateManualResolution(value: ManualResolutionRecord): Readonly<ManualResolutionRecord> {
  if (value.schema !== MANUAL_RESOLUTION_SCHEMA) throw new Error('UNSUPPORTED_RESOLUTION_SCHEMA');
  if (value.newProofHash !== manualResolutionHash(value)) throw new Error('RESOLUTION_HASH_MISMATCH');
  return Object.freeze({ ...value, referencedFactIds: Object.freeze([...value.referencedFactIds]) });
}
