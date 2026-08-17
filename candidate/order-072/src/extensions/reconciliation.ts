// PROVENANCE: RECONSTRUCTED_FROM_ORDER; operational interpretation only, not a delivery state machine.
import { failExtension } from './errors.js';
import type { ExecutionEvidence } from './types.js';

export function reconcileOperation(input: {
  readonly deviceState: 'UNKNOWN';
  readonly backendState: 'EFFECT_APPLIED';
  readonly erpState: 'WORK_ORDER_CLOSED';
  readonly evidence: readonly ExecutionEvidence[];
}): { readonly finalVerdict: 'EFFECT_CONFIRMED'; readonly action: 'DO_NOT_RETRY' } {
  const hasReceipt = input.evidence.some((item) => item.kind === 'APPLICATION_ACK');
  const hasBackend = input.evidence.some((item) => item.kind === 'EFFECT_APPLIED');
  const hasErp = input.evidence.some((item) => item.kind === 'WORK_ORDER_CLOSED');
  if (!hasReceipt || !hasBackend || !hasErp) failExtension('INSUFFICIENT_EVIDENCE', 'insufficient evidence for effect confirmation');
  return Object.freeze({ finalVerdict: 'EFFECT_CONFIRMED', action: 'DO_NOT_RETRY' });
}
