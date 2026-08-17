export type DeliveryCertainty = 'NOT_SENT' | 'SENT' | 'UNKNOWN' | 'DURABLY_ACCEPTED' | 'EFFECT_CONFIRMED' | 'REJECTED';
export type ReceiverQueryResult =
  | { readonly kind: 'ACCEPTED'; readonly receiptId: string }
  | { readonly kind: 'EFFECT_CONFIRMED'; readonly receiptId: string; readonly effectReference: string }
  | { readonly kind: 'BOUNDED_NOT_ACCEPTED'; readonly observedThroughMs: number; readonly authoritative: true }
  | { readonly kind: 'NOT_FOUND_UNBOUNDED' }
  | { readonly kind: 'QUERY_FAILED'; readonly code: string };

export interface ReconciliationInput {
  readonly prior: DeliveryCertainty;
  readonly retryContract: 'SAFE_IDEMPOTENT' | 'RECONCILE_BEFORE_RETRY' | 'NO_AUTOMATIC_RETRY';
  readonly query: ReceiverQueryResult;
  readonly operationCreatedAtMs: number;
  readonly nowMs: number;
}

export interface ReconciliationDecision {
  readonly certainty: DeliveryCertainty;
  readonly retryAllowed: boolean;
  readonly secondSideEffectSendAllowed: boolean;
  readonly reason: 'ACCEPTANCE_RECOVERED' | 'EFFECT_RECOVERED' | 'AUTHORITATIVE_NOT_ACCEPTED' | 'REMAINS_UNKNOWN' | 'RETRY_PROHIBITED';
}

export function reconcileAmbiguous(input: ReconciliationInput): ReconciliationDecision {
  if (input.prior !== 'UNKNOWN') throw new Error('RECONCILIATION_REQUIRES_UNKNOWN');
  if (input.query.kind === 'EFFECT_CONFIRMED') {
    return Object.freeze({ certainty: 'EFFECT_CONFIRMED', retryAllowed: false, secondSideEffectSendAllowed: false, reason: 'EFFECT_RECOVERED' });
  }
  if (input.query.kind === 'ACCEPTED') {
    return Object.freeze({ certainty: 'DURABLY_ACCEPTED', retryAllowed: false, secondSideEffectSendAllowed: false, reason: 'ACCEPTANCE_RECOVERED' });
  }
  if (input.retryContract === 'NO_AUTOMATIC_RETRY') {
    return Object.freeze({ certainty: 'UNKNOWN', retryAllowed: false, secondSideEffectSendAllowed: false, reason: 'RETRY_PROHIBITED' });
  }
  if (input.query.kind === 'BOUNDED_NOT_ACCEPTED' && input.query.authoritative && input.query.observedThroughMs >= input.nowMs) {
    return Object.freeze({ certainty: 'NOT_SENT', retryAllowed: true, secondSideEffectSendAllowed: true, reason: 'AUTHORITATIVE_NOT_ACCEPTED' });
  }
  return Object.freeze({ certainty: 'UNKNOWN', retryAllowed: false, secondSideEffectSendAllowed: false, reason: 'REMAINS_UNKNOWN' });
}
