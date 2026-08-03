// PROVENANCE: RECONSTRUCTED_FROM_ORDER; all operation messages and delivery state use the historical oracle types.
import type { LogicalMessage, Receipt } from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';

export type { LogicalMessage, Receipt } from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';

export interface DemoReceiptReference {
  readonly schemaVersion: 'zungun.demo-receipt-reference.v1';
  readonly provenance: 'GENERATED_ARTIFACT';
  readonly operationId: string;
  readonly applicationAcknowledgement: 'EFFECT_APPLIED' | 'NO_EFFECT' | 'REJECTED';
  readonly receipt: Receipt;
  readonly integrityDigest: string;
  readonly cryptography: 'DEMO_LOCAL_INTEGRITY_REFERENCE_ONLY_NOT_AUTHENTICATION';
}

export interface ExecutionEvidence {
  readonly sequence: number;
  readonly atMs: number;
  readonly source: 'DEVICE' | 'RECEIVER' | 'BACKEND' | 'ERP' | 'RECONCILER';
  readonly kind: string;
  readonly detail: string;
  readonly reference: string;
}

export interface ExecutionProof {
  readonly schemaVersion: 'zungun.execution-proof.v1';
  readonly provenance: 'GENERATED_ARTIFACT';
  readonly semanticSourceProvenance: 'EXACT_HISTORICAL_TYPESCRIPT_ORACLE';
  readonly dataClassification: 'FICTIONAL_DEMO_ONLY';
  readonly operationId: string;
  readonly workOrderId: string;
  readonly caseId: string;
  readonly technicianId: string;
  readonly deviceId: string;
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly deviceState: 'UNKNOWN';
  readonly backendState: 'EFFECT_APPLIED';
  readonly erpState: 'WORK_ORDER_CLOSED';
  readonly finalVerdict: 'EFFECT_CONFIRMED';
  readonly action: 'DO_NOT_RETRY';
  readonly receiptReference: DemoReceiptReference;
  readonly evidence: readonly ExecutionEvidence[];
  readonly limitations: readonly string[];
}

export interface ReferenceReceiverResult {
  readonly operationId: string;
  readonly effectApplied: boolean;
  readonly duplicate: boolean;
  readonly receiptReference: DemoReceiptReference;
}

export interface TransportProfile {
  readonly id: string;
  readonly available: boolean;
  readonly maxPayloadBytes: number;
  readonly estimatedCompletionDurationMs: number;
  readonly costClass: 'LOW' | 'METERED' | 'HIGH';
  readonly supportsApplicationAck: boolean;
}

export interface BoundOperation {
  readonly operationId: string;
  readonly message: LogicalMessage;
}
