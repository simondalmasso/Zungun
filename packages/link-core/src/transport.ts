import type { RetryContract, TransportCapability } from './types.js';

export type AssuranceTier = 'L0_LINK_ONLY' | 'L1_RECEIVER_PROXY' | 'L2_NATIVE_RECEIVER_EFFECT';

export interface TransportAttemptRecord {
  readonly attemptId: string;
  readonly opId: string;
  readonly adapterId: string;
  readonly networkKey: string | null;
  readonly requestBytes: number;
  readonly startedAtMs: number;
  readonly completedAtMs: number | null;
  readonly status: 'STARTED' | 'RESPONSE' | 'AMBIGUOUS' | 'FAILED';
  readonly httpStatus: number | null;
  readonly responseSha256: string | null;
  readonly errorCode: string | null;
}

export function validateTransportForTier(capability: TransportCapability, tier: AssuranceTier): void {
  if (!capability.available) throw new Error('TRANSPORT_UNAVAILABLE');
  if (tier !== 'L0_LINK_ONLY' && !capability.supportsDurableReceipt) throw new Error('DURABLE_RECEIPT_REQUIRED');
  if (tier === 'L2_NATIVE_RECEIVER_EFFECT' && !capability.supportsReceiverQuery) throw new Error('RECEIVER_QUERY_REQUIRED');
}

export function hedgingAllowed(
  retryContract: RetryContract,
  idempotencyRequired: boolean,
  capability: TransportCapability,
): boolean {
  return retryContract === 'SAFE_IDEMPOTENT' && idempotencyRequired && capability.supportsHedging;
}
