// PROVENANCE: RECONSTRUCTED_FROM_ORDER; evidence/report extension over one historical LogicalMessage.
import { assertValidatedMessage, type LogicalMessage } from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';
import { reconcileOperation } from './reconciliation.js';
import type { DemoReceiptReference, ExecutionEvidence, ExecutionProof } from './types.js';

export function buildExecutionProof(
  message: LogicalMessage,
  receiptReference: DemoReceiptReference,
  evidence: readonly ExecutionEvidence[],
): ExecutionProof {
  assertValidatedMessage(message);
  const ordered = Object.freeze([...evidence].sort((a, b) => a.sequence - b.sequence));
  const reconciliation = reconcileOperation({
    deviceState: 'UNKNOWN', backendState: 'EFFECT_APPLIED', erpState: 'WORK_ORDER_CLOSED', evidence: ordered,
  });
  return Object.freeze({
    schemaVersion: 'zungun.execution-proof.v1',
    provenance: 'GENERATED_ARTIFACT',
    semanticSourceProvenance: 'EXACT_HISTORICAL_TYPESCRIPT_ORACLE',
    dataClassification: 'FICTIONAL_DEMO_ONLY',
    operationId: receiptReference.operationId,
    workOrderId: 'WO-2841',
    caseId: 'CASE-DEMO-2841',
    technicianId: 'FIELD-017',
    deviceId: 'DEV-DEMO-017',
    messageId: message.messageId,
    messageCommitment: message.messageCommitment,
    deviceState: 'UNKNOWN',
    backendState: 'EFFECT_APPLIED',
    erpState: 'WORK_ORDER_CLOSED',
    finalVerdict: reconciliation.finalVerdict,
    action: reconciliation.action,
    receiptReference,
    evidence: ordered,
    limitations: Object.freeze([
      'REFERENCE_DEMO_ONLY',
      'NO_ANDROID_RUNTIME',
      'NO_PRODUCTION_PERSISTENCE',
      'NO_NETWORK_CALLS',
      'NO_DATABASE',
      'NO_PRODUCTION_CRYPTOGRAPHY',
      'DEMO_RECEIPT_REFERENCE_REQUIRES_EXPLICIT_ORACLE_VERIFIER',
      'NO_UNIVERSAL_EXACTLY_ONCE_CLAIM',
    ]),
  });
}
