// PROVENANCE: RECONSTRUCTED_FROM_ORDER; commitment helper for the historical LogicalMessageInput.
import type { LogicalMessageInput } from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';
import { canonicalJson, sha256 } from './canonical.js';

export function computeMessageCommitment(input: Omit<LogicalMessageInput, 'messageCommitment'>): string {
  return `sha256:${sha256(canonicalJson({
    zepVersion: input.zepVersion,
    messageId: input.messageId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    recipientIds: [...input.recipientIds],
    createdAtMs: input.createdAtMs,
    expiresAtMs: input.expiresAtMs,
    priority: input.priority,
    contentType: input.contentType,
    payload: input.payload,
    receiptPolicy: input.receiptPolicy,
    extensions: input.extensions ?? null,
  }))}`;
}
