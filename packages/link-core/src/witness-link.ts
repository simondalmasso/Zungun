import { sha256Canonical } from './canonical.js';

export type LinkEvidenceKind =
  | 'LINK_SNAPSHOT_OBSERVED'
  | 'TRANSMISSION_PLAN_CREATED'
  | 'CRITICAL_CORE_SENT'
  | 'HEAVY_OBJECT_DEFERRED'
  | 'TRANSPORT_PATH_SELECTED'
  | 'PATH_CHANGED'
  | 'RECONCILIATION_STARTED'
  | 'RECONCILIATION_RESULT'
  | 'DEFERRED_TRANSFER_STARTED'
  | 'DEFERRED_TRANSFER_CHECKPOINT'
  | 'DEFERRED_TRANSFER_COMPLETED'
  | 'PREFETCH_COMPLETED';

export interface LinkDecisionRecord {
  readonly recordVersion: 1;
  readonly operationId: string;
  readonly kind: LinkEvidenceKind;
  readonly occurredAtMs: number;
  readonly planId: string | null;
  readonly snapshotHash: string | null;
  readonly adapterId: string | null;
  readonly networkKey: string | null;
  readonly certainty: 'PLANNED' | 'SENT' | 'RECEIVED' | 'EFFECT_CONFIRMED' | 'UNKNOWN' | 'CONFLICT' | 'PENDING';
  readonly coreComplete: boolean;
  readonly requiredEvidenceComplete: boolean;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly recordSha256: string;
}

export function createLinkDecisionRecord(input: Omit<LinkDecisionRecord, 'recordSha256'>): LinkDecisionRecord {
  if (input.certainty === 'EFFECT_CONFIRMED' && !input.coreComplete) throw new Error('EFFECT_WITHOUT_CORE');
  const recordSha256 = sha256Canonical(input);
  return Object.freeze({ ...input, details: Object.freeze({ ...input.details }), recordSha256 });
}

export interface LinkProofBundle {
  readonly bundleVersion: 2;
  readonly operationId: string;
  readonly records: readonly LinkDecisionRecord[];
  readonly manifestSha256: string;
}

export function createLinkProofBundle(operationId: string, records: readonly LinkDecisionRecord[]): LinkProofBundle {
  if (records.some((record) => record.operationId !== operationId)) throw new Error('CROSS_OPERATION_EVIDENCE');
  const manifestSha256 = sha256Canonical({ operationId, records: records.map((record) => record.recordSha256) });
  return Object.freeze({ bundleVersion: 2, operationId, records: Object.freeze([...records]), manifestSha256 });
}

export function verifyLinkProofBundle(bundle: LinkProofBundle): boolean {
  if (bundle.records.some((record) => sha256Canonical({
    recordVersion: record.recordVersion,
    operationId: record.operationId,
    kind: record.kind,
    occurredAtMs: record.occurredAtMs,
    planId: record.planId,
    snapshotHash: record.snapshotHash,
    adapterId: record.adapterId,
    networkKey: record.networkKey,
    certainty: record.certainty,
    coreComplete: record.coreComplete,
    requiredEvidenceComplete: record.requiredEvidenceComplete,
    details: record.details,
  }) !== record.recordSha256)) return false;
  return createLinkProofBundle(bundle.operationId, bundle.records).manifestSha256 === bundle.manifestSha256;
}
