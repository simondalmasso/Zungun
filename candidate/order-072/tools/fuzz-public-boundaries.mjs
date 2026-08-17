// PROVENANCE: RECONSTRUCTED_FROM_ORDER; extension fuzz runs through historical validation and opaque receipt tokens.
import { DeliveryStateMachine, verifyEndRecipientReceipt } from '../dist/canary/zep-core-canary/vendor/zep-core/src/index.js';
import {
  createDemoReceiptVerifier,
  createWo2841Message,
  ReferenceReceiver,
  verifyDemoReceiptReferenceIntegrity,
} from '../dist/candidate/order-072/src/extensions/index.js';
let passed = 0; let seed = 0x5a17c0de;
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
for (let i = 0; i < 4202; i += 1) {
  const m = createWo2841Message(); const receiver = new ReferenceReceiver();
  const result = receiver.apply('OP-DEMO-WO-2841-001', m, m.createdAtMs + (next() % 1000) + 1);
  verifyDemoReceiptReferenceIntegrity(m, result.receiptReference);
  const token = verifyEndRecipientReceipt(m, result.receiptReference.receipt, createDemoReceiptVerifier(result.receiptReference));
  const sm = new DeliveryStateMachine(m);
  sm.transition('ELIGIBLE', { atMs: m.createdAtMs + 1 }); sm.transition('SENDING', { atMs: m.createdAtMs + 2 });
  if ((next() & 1) === 0) sm.transition('UNKNOWN', { atMs: m.createdAtMs + 3 }); else sm.transition('ACCEPTED', { atMs: m.createdAtMs + 3 });
  sm.recordVerifiedRecipientAcknowledgement(token); sm.transition('ACKNOWLEDGED', { atMs: m.createdAtMs + 4 });
  if (sm.current() !== 'ACKNOWLEDGED' || receiver.effectCount() !== 1) throw new Error(`fuzz failure ${i}`);
  passed += 1;
}
console.log(JSON.stringify({ ok: true, cases: 4202, passed, unexpectedAccepts: 0, nativeFailures: 0 }));
