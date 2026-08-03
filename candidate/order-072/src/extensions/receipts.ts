// PROVENANCE: RECONSTRUCTED_FROM_ORDER; demo references cannot mint historical verified-receipt tokens.
import {
  validateReceipt,
  type LogicalMessage,
  type Receipt,
  type ReceiptVerifier,
} from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';
import { canonicalJson, sha256 } from './canonical.js';
import { failExtension } from './errors.js';
import type { DemoReceiptReference } from './types.js';

function unsigned(reference: Omit<DemoReceiptReference, 'integrityDigest' | 'cryptography'>): unknown {
  return {
    schemaVersion: reference.schemaVersion,
    provenance: reference.provenance,
    operationId: reference.operationId,
    applicationAcknowledgement: reference.applicationAcknowledgement,
    receipt: reference.receipt,
  };
}

export function createDemoReceiptReference(input: {
  readonly operationId: string;
  readonly applicationAcknowledgement: DemoReceiptReference['applicationAcknowledgement'];
  readonly receipt: Receipt;
}): DemoReceiptReference {
  const base = Object.freeze({
    schemaVersion: 'zungun.demo-receipt-reference.v1' as const,
    provenance: 'GENERATED_ARTIFACT' as const,
    operationId: input.operationId,
    applicationAcknowledgement: input.applicationAcknowledgement,
    receipt: Object.freeze({ ...input.receipt }),
  });
  return Object.freeze({
    ...base,
    integrityDigest: sha256(canonicalJson(unsigned(base))),
    cryptography: 'DEMO_LOCAL_INTEGRITY_REFERENCE_ONLY_NOT_AUTHENTICATION' as const,
  });
}

export function verifyDemoReceiptReferenceIntegrity(
  message: LogicalMessage,
  reference: DemoReceiptReference,
): DemoReceiptReference {
  validateReceipt(message, reference.receipt);
  if (reference.cryptography !== 'DEMO_LOCAL_INTEGRITY_REFERENCE_ONLY_NOT_AUTHENTICATION') {
    failExtension('TAMPER_DETECTED', 'unsupported demo receipt-reference mode');
  }
  const { integrityDigest, cryptography: _mode, ...base } = reference;
  if (integrityDigest !== sha256(canonicalJson(unsigned(base)))) {
    failExtension('TAMPER_DETECTED', 'demo receipt-reference digest mismatch');
  }
  return reference;
}

export function createDemoReceiptVerifier(reference: DemoReceiptReference): ReceiptVerifier {
  return Object.freeze({
    verify(message: LogicalMessage, receipt: Receipt): boolean {
      try {
        const verified = verifyDemoReceiptReferenceIntegrity(message, reference);
        return canonicalJson(verified.receipt) === canonicalJson(receipt);
      } catch {
        return false;
      }
    },
  });
}
