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

export interface LogicalWakeExecution<T> {
  readonly logicalExecutionId: string;
  readonly executed: boolean;
  readonly value: T;
}

/**
 * Coalesces duplicate OS/connectivity wakeups onto one logical execution.
 * The completed promise remains keyed for the lifetime of the gate, so a
 * repeated wakeup for the same logical execution cannot re-run the effect.
 */
export class LogicalWakeupGate {
  private readonly executions = new Map<string, Promise<unknown>>();

  run<T>(logicalExecutionId: string, execute: () => Promise<T> | T): Promise<LogicalWakeExecution<T>> {
    if (!/^[A-Za-z0-9._:-]{1,200}$/.test(logicalExecutionId)) throw new Error('LOGICAL_WAKEUP_ID_INVALID');
    const existing = this.executions.get(logicalExecutionId) as Promise<T> | undefined;
    if (existing) {
      return existing.then((value) => Object.freeze({ logicalExecutionId, executed: false, value }));
    }
    const execution = Promise.resolve().then(execute);
    this.executions.set(logicalExecutionId, execution);
    return execution.then((value) => Object.freeze({ logicalExecutionId, executed: true, value }));
  }

  has(logicalExecutionId: string): boolean {
    return this.executions.has(logicalExecutionId);
  }
}
