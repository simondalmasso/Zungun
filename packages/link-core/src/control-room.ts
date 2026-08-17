import type { AssuranceTier } from './transport.js';
import type { LinkDecisionRecord } from './witness-link.js';

export interface LinkControlRoomInput {
  readonly operationId: string;
  readonly operationState: string;
  readonly applicationOutcome: string;
  readonly assuranceTier: AssuranceTier;
  readonly witnessState: string;
  readonly records: readonly LinkDecisionRecord[];
}

export interface LinkControlRoomView {
  readonly operationId: string;
  readonly currentOperationState: string;
  readonly currentLinkPlan: string | null;
  readonly whyThisPlan: readonly string[];
  readonly criticalBytesStatus: 'NOT_SENT' | 'SENT_OR_BETTER';
  readonly deferredBytesStatus: 'NONE' | 'PENDING' | 'COMPLETE' | 'FAILED_OR_EXPIRED';
  readonly currentAssuranceTier: AssuranceTier;
  readonly lastTransportAdapter: string | null;
  readonly reconciliationStatus: 'NOT_REQUIRED' | 'REQUIRED' | 'RESOLVED' | 'CONFLICT';
  readonly receiptEffectState: string;
  readonly witnessState: string;
  readonly complete: boolean;
}

export function buildLinkControlRoomView(input: LinkControlRoomInput): LinkControlRoomView {
  const ordered = [...input.records].sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.recordSha256.localeCompare(b.recordSha256));
  const latestPlan = [...ordered].reverse().find((record) => record.kind === 'TRANSMISSION_PLAN_CREATED') ?? null;
  const latestTransport = [...ordered].reverse().find((record) => record.adapterId !== null) ?? null;
  const coreSent = ordered.some((record) => record.kind === 'CRITICAL_CORE_SENT' || ['RECEIVED','EFFECT_CONFIRMED'].includes(record.certainty));
  const deferredSeen = ordered.some((record) => record.kind === 'HEAVY_OBJECT_DEFERRED' || record.kind.startsWith('DEFERRED_TRANSFER_'));
  const deferredComplete = deferredSeen && ordered.some((record) => record.kind === 'DEFERRED_TRANSFER_COMPLETED' && record.requiredEvidenceComplete);
  const deferredFailed = ordered.some((record) => ['HEAVY_SYNC_EXPIRED','HEAVY_SYNC_FAILED'].includes(String(record.details.state ?? '')));
  const reconciliationStarted = ordered.some((record) => record.kind === 'RECONCILIATION_STARTED');
  const reconciliationRecords = ordered.filter((record) => record.kind === 'RECONCILIATION_RESULT');
  const reconciliationConflict = reconciliationRecords.some((record) => record.certainty === 'CONFLICT');
  const reconciliationResolved = reconciliationRecords.some((record) => ['RECEIVED','EFFECT_CONFIRMED'].includes(record.certainty));
  const requiredEvidenceComplete = ordered.length === 0 ? false : ordered.every((record) => record.requiredEvidenceComplete || !['HEAVY_OBJECT_DEFERRED','DEFERRED_TRANSFER_STARTED','DEFERRED_TRANSFER_CHECKPOINT'].includes(record.kind)) && (!deferredSeen || deferredComplete);
  const businessTerminal = ['COMPLETED','REJECTED','EXPIRED','CANCELLED'].includes(input.operationState);
  const witnessUncertain = ['UNKNOWN','CONFLICT','EXPIRED_WITHOUT_RESOLUTION'].includes(input.witnessState);
  const reconciliationStatus = reconciliationConflict ? 'CONFLICT' : reconciliationResolved ? 'RESOLVED' : reconciliationStarted ? 'REQUIRED' : 'NOT_REQUIRED';
  const complete = businessTerminal && requiredEvidenceComplete && !witnessUncertain && !reconciliationConflict && (!reconciliationStarted || reconciliationResolved);
  const reasonValue = latestPlan?.details.reasonCodes;
  const whyThisPlan = Array.isArray(reasonValue) ? reasonValue.map(String) : typeof reasonValue === 'string' ? reasonValue.split(',').filter(Boolean) : [];
  return Object.freeze({
    operationId: input.operationId,
    currentOperationState: input.operationState,
    currentLinkPlan: latestPlan?.planId ?? null,
    whyThisPlan: Object.freeze(whyThisPlan),
    criticalBytesStatus: coreSent ? 'SENT_OR_BETTER' : 'NOT_SENT',
    deferredBytesStatus: deferredFailed ? 'FAILED_OR_EXPIRED' : !deferredSeen ? 'NONE' : deferredComplete ? 'COMPLETE' : 'PENDING',
    currentAssuranceTier: input.assuranceTier,
    lastTransportAdapter: latestTransport?.adapterId ?? null,
    reconciliationStatus,
    receiptEffectState: input.applicationOutcome,
    witnessState: input.witnessState,
    complete,
  });
}
