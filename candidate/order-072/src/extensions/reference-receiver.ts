// PROVENANCE: RECONSTRUCTED_FROM_ORDER; demo-only, in-memory extension over the historical oracle.
import {
  InMemoryMessageStore,
  assertValidatedMessage,
  fail,
  requireEpochMs,
  requireOpaqueId,
  validateReceipt,
  type LogicalMessage,
  type Receipt,
} from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';
import { createDemoReceiptReference } from './receipts.js';
import type { ReferenceReceiverResult } from './types.js';

function receiptId(operationId: string): string {
  return operationId === 'OP-DEMO-WO-2841-001' ? 'RCP-DEMO-2841' : `RCP-DEMO-${operationId}`;
}

export class ReferenceReceiver {
  readonly label = 'REFERENCE_DEMO_ONLY' as const;
  private readonly messageStore = new InMemoryMessageStore();
  private readonly effects = new Map<string, { commitment: string; result: ReferenceReceiverResult }>();

  apply(operationIdInput: string, message: LogicalMessage, observedAtMsInput: number): ReferenceReceiverResult {
    assertValidatedMessage(message);
    const operationId = requireOpaqueId(operationIdInput, 'operationId');
    const observedAtMs = requireEpochMs(observedAtMsInput, 'observedAtMs');
    const existing = this.effects.get(operationId);
    if (existing !== undefined) {
      if (existing.commitment !== message.messageCommitment) {
        fail('DUPLICATE_CONFLICT', 'operation identity reused with another commitment');
      }
      return Object.freeze({ ...existing.result, duplicate: true, effectApplied: false });
    }
    this.messageStore.observe(message, `apply:${operationId}`);
    const receipt: Receipt = Object.freeze({
      receiptId: receiptId(operationId),
      messageId: message.messageId,
      messageCommitment: message.messageCommitment,
      recipientId: message.recipientIds[0]!,
      receiptKind: 'END_RECIPIENT_ACKNOWLEDGED',
      observedAtMs,
      adapterId: 'REFERENCE_RECEIVER',
      externalReference: operationId,
      authenticated: true,
    });
    validateReceipt(message, receipt);
    const receiptReference = createDemoReceiptReference({
      operationId,
      applicationAcknowledgement: 'EFFECT_APPLIED',
      receipt,
    });
    const result = Object.freeze({ operationId, effectApplied: true, duplicate: false, receiptReference });
    this.effects.set(operationId, { commitment: message.messageCommitment, result });
    return result;
  }

  status(operationIdInput: string): ReferenceReceiverResult | null {
    const operationId = requireOpaqueId(operationIdInput, 'operationId');
    return this.effects.get(operationId)?.result ?? null;
  }

  effectCount(): number { return this.effects.size; }
}
