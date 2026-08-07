import { compareUrgency } from './planner.js';
import type { DeliveryProfileV2 } from './types.js';

export interface SchedulableOperation {
  readonly opId: string;
  readonly enqueuedAtMs: number;
  readonly profile: DeliveryProfileV2;
  readonly dependenciesSatisfied: boolean;
  readonly deferredBytes: number;
}

export function orderEligibleOperations(operations: readonly SchedulableOperation[]): readonly SchedulableOperation[] {
  return Object.freeze(
    operations
      .filter((operation) => operation.dependenciesSatisfied)
      .slice()
      .sort((a, b) => {
        const urgency = compareUrgency(a.profile.urgency, b.profile.urgency);
        if (urgency !== 0) return urgency;
        const aDeadline = a.profile.deadlineAtMs ?? Number.MAX_SAFE_INTEGER;
        const bDeadline = b.profile.deadlineAtMs ?? Number.MAX_SAFE_INTEGER;
        if (aDeadline !== bDeadline) return aDeadline - bDeadline;
        if (a.enqueuedAtMs !== b.enqueuedAtMs) return a.enqueuedAtMs - b.enqueuedAtMs;
        return a.opId.localeCompare(b.opId);
      }),
  );
}

export function selectNextOperation(
  operations: readonly SchedulableOperation[],
  consecutiveNonBulkDispatches: number,
  goodLink: boolean,
  bulkPromotionThreshold = 8,
): SchedulableOperation | null {
  const ordered = orderEligibleOperations(operations);
  if (ordered.length === 0) return null;
  const critical = ordered.find((operation) => operation.profile.urgency === 'CRITICAL');
  if (critical) return critical;
  if (goodLink && consecutiveNonBulkDispatches >= bulkPromotionThreshold) {
    const bulk = ordered
      .filter((operation) => operation.profile.urgency === 'BULK')
      .sort((a,b) => a.enqueuedAtMs - b.enqueuedAtMs || a.opId.localeCompare(b.opId))[0];
    if (bulk) return bulk;
  }
  return ordered[0] ?? null;
}
