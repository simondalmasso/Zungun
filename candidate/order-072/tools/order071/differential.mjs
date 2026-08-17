import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as core from '../../dist/canary/zep-core-canary/vendor/zep-core/src/index.js';
import * as ext from '../../dist/candidate/order-072/src/extensions/index.js';

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof core.ZepError && error.code === code);
}
function capability(overrides = {}) {
  return {
    adapterId: 'A', adapterVersion: '1', maximumPayloadBytes: 4096,
    supportsBinary: true, supportsFragmentation: true, supportsTransportReceipt: true,
    supportsEndRecipientReceipt: true, supportsCancel: true, supportsBackground: true,
    supportsStoreAndForward: false, requiresUserPresence: false, requiresExternalHardware: false,
    requiresOperatorEntitlement: false, availabilityClass: 3, expectedLatencyClass: 1,
    estimatedCompletionDurationMs: 100, monetaryCostClass: 0, energyCostClass: 0,
    privacyMetadataClass: 0, currentEligibility: 'ALLOWED', duplicateSafe: true, ...overrides,
  };
}
function receiptFor(message, recipientId, observedAtMs, receiptId = `r-${recipientId}`) {
  return { receiptId, messageId: message.messageId, messageCommitment: message.messageCommitment,
    recipientId, receiptKind: 'END_RECIPIENT_ACKNOWLEDGED', observedAtMs, adapterId: 'A', authenticated: true };
}
const verifier = Object.freeze({ verify: (_message, receipt) => receipt.authenticated === true });
const vectors = [];
async function vector(id, area, run) {
  try { await run(); vectors.push({ id, area, status: 'PASS' }); }
  catch (error) { vectors.push({ id, area, status: 'FAIL', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }); }
}

await vector('V01', 'message-validation-and-immutability', () => {
  const inputPayload = Uint8Array.of(1, 2, 3); const extensions = { nested: { value: 1 } };
  const base = ext.createWo2841Message();
  const input = {
    zepVersion: base.zepVersion, messageId: 'v01', conversationId: 'c', senderId: 's', recipientIds: ['r'],
    createdAtMs: 1, expiresAtMs: 1000, priority: 1, contentType: 'application/octet-stream', payload: inputPayload,
    receiptPolicy: 'END_RECIPIENT_ACK', messageCommitment: 'commit-v01', extensions,
  };
  const validated = core.validateMessage(input, 1); inputPayload[0] = 9; extensions.nested.value = 9;
  const exposed = validated.payload; exposed[1] = 9;
  assert.deepEqual(validated.payload, Uint8Array.of(1, 2, 3));
  assert.equal(validated.extensions.nested.value, 1); assert.equal(Object.isFrozen(validated.extensions.nested), true);
  expectCode(() => core.validateMessage({ ...input, providerPrivate: 'x' }, 1), 'CORRUPT_RECORD');
});

await vector('V02', 'duplicate-commitment-conflict', () => {
  const store = new core.InMemoryMessageStore(); const message = ext.createWo2841Message();
  assert.equal(store.observe(message, 'one').inserted, true); assert.equal(store.observe(message, 'two').inserted, false);
  const conflicting = core.validateMessage({
    zepVersion: message.zepVersion, messageId: message.messageId, conversationId: message.conversationId,
    senderId: message.senderId, recipientIds: [...message.recipientIds], createdAtMs: message.createdAtMs,
    expiresAtMs: message.expiresAtMs, priority: message.priority, contentType: message.contentType,
    payload: message.payload, receiptPolicy: message.receiptPolicy, messageCommitment: 'different-commitment',
    ...(message.extensions === undefined ? {} : { extensions: message.extensions }),
  }, message.createdAtMs);
  expectCode(() => store.observe(conflicting, 'conflict'), 'DUPLICATE_CONFLICT');
  const receiver = new ext.ReferenceReceiver(); receiver.apply('OP', message, message.createdAtMs + 1);
  expectCode(() => receiver.apply('OP', conflicting, message.createdAtMs + 2), 'DUPLICATE_CONFLICT');
});

await vector('V03', 'expiry-and-effective-clock', () => {
  assert.equal(core.effectiveNow(100, 90), 100); assert.equal(core.effectiveNow(100, 110), 110);
  assert.equal(core.isExpired(100, 99), false); assert.equal(core.isExpired(100, 100), true);
  const message = ext.createWo2841Message(); const machine = new core.DeliveryStateMachine(message);
  assert.equal(machine.current(message.expiresAtMs), 'EXPIRED'); assert.equal(machine.current(message.expiresAtMs - 1), 'EXPIRED');
});

await vector('V04', 'state-machine-contract', () => {
  const message = ext.createWo2841Message(); const machine = new core.DeliveryStateMachine(message);
  expectCode(() => machine.transition('ELIGIBLE', { atMs: message.createdAtMs + 1, providerPrivate: 'x' }), 'CORRUPT_RECORD');
  machine.transition('ELIGIBLE', { atMs: message.createdAtMs + 1 }); machine.transition('SENDING', { atMs: message.createdAtMs + 2 });
  expectCode(() => machine.transition('ACKNOWLEDGED', { atMs: message.createdAtMs + 3 }), 'INVALID_STATE_TRANSITION');
  assert.equal(machine.history().length, 2);
});

await vector('V05', 'recipient-acknowledgement', () => {
  const base = ext.createWo2841Message();
  const message = core.validateMessage({
    zepVersion: base.zepVersion, messageId: 'v05', conversationId: base.conversationId, senderId: base.senderId,
    recipientIds: ['r1', 'r2'], createdAtMs: base.createdAtMs, expiresAtMs: base.expiresAtMs, priority: base.priority,
    contentType: base.contentType, payload: base.payload, receiptPolicy: base.receiptPolicy, messageCommitment: 'v05-commit',
  }, base.createdAtMs);
  const machine = new core.DeliveryStateMachine(message);
  const first = core.verifyEndRecipientReceipt(message, receiptFor(message, 'r1', message.createdAtMs + 1), verifier);
  assert.deepEqual(machine.recordVerifiedRecipientAcknowledgement(first), { newlyAcknowledged: true, allAcknowledged: false });
  assert.deepEqual(machine.pendingRecipientIds(), ['r2']); assert.equal(machine.acknowledgementHistory().length, 1);
  const second = core.verifyEndRecipientReceipt(message, receiptFor(message, 'r2', message.createdAtMs + 2), verifier);
  assert.equal(machine.recordVerifiedRecipientAcknowledgement(second).allAcknowledged, true);
});

await vector('V06', 'receipt-authentication-and-expiry', () => {
  const message = ext.createWo2841Message(); const machine = new core.DeliveryStateMachine(message);
  const valid = receiptFor(message, message.recipientIds[0], message.createdAtMs + 1);
  expectCode(() => machine.recordVerifiedRecipientAcknowledgement({ receipt: valid }), 'RECEIPT_INVALID');
  expectCode(() => core.verifyEndRecipientReceipt(message, { ...valid, observedAtMs: message.expiresAtMs }, verifier), 'EXPIRED');
  expectCode(() => core.verifyEndRecipientReceipt(message, valid, { verify: () => false }), 'AUTHENTICATION_FAILED');
  const reference = ext.createDemoReceiptReference({ operationId: 'OP', applicationAcknowledgement: 'EFFECT_APPLIED', receipt: valid });
  expectCode(() => core.verifyEndRecipientReceipt(message, valid, { verify: () => false }), 'AUTHENTICATION_FAILED');
  const token = core.verifyEndRecipientReceipt(message, valid, ext.createDemoReceiptVerifier(reference));
  assert.equal(core.assertVerifiedEndRecipientReceipt(token, message).receiptId, valid.receiptId);
});

await vector('V07', 'routing-deadline', () => {
  const message = ext.createWo2841Message();
  const requirements = { fragmentBytes: message.payload.byteLength, fragmentCount: 1, requiresBinary: true, requiresFragmentation: false, requiresTransportReceipt: false, requiresEndRecipientReceipt: true };
  const policy = { version: 'p', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9, maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false };
  expectCode(() => core.selectRoute(message, requirements, [capability({ estimatedCompletionDurationMs: 2 })], policy, message.expiresAtMs - 1), 'DEADLINE_NOT_FEASIBLE');
  assert.equal(core.selectRoute(message, requirements, [capability({ estimatedCompletionDurationMs: 1 })], policy, message.expiresAtMs - 2).adapterId, 'A');
});

await vector('V08', 'unknown-retry', () => {
  const unsafe = capability({ duplicateSafe: false }); expectCode(() => core.authorizeUnknownRetry(unsafe, false), 'OUTCOME_UNKNOWN');
  core.authorizeUnknownRetry(unsafe, true);
  const message = ext.createWo2841Message(); const machine = new core.DeliveryStateMachine(message);
  machine.transition('ELIGIBLE', { atMs: message.createdAtMs + 1 }); machine.transition('SENDING', { atMs: message.createdAtMs + 2 });
  core.applySendResult(machine, message, { kind: 'unknown', reasonCode: 'LOST' }, { atMs: message.createdAtMs + 3, attemptId: 'a', capability: unsafe, alternativeEligibleRouteExists: false });
  assert.equal(machine.current(), 'UNKNOWN');
});

await vector('V09', 'fragment-reassembly', () => {
  const fragments = [
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 0, fragmentCount: 2, byteOffset: 0, fragmentPayload: Uint8Array.of(1, 2), authenticated: true, expiresAtMs: 100 },
    { messageId: 'm', messageCommitment: 'c', fragmentIndex: 1, fragmentCount: 2, byteOffset: 2, fragmentPayload: Uint8Array.of(3), authenticated: true, expiresAtMs: 100 },
  ];
  assert.deepEqual(core.reassembleFragments(fragments, 1), Uint8Array.of(1, 2, 3));
  expectCode(() => core.reassembleFragments([{ ...fragments[0], fragmentCount: 1 }, fragments[1]], 1), 'FRAGMENT_SET_MISMATCH');
});

await vector('V10', 'safe-errors-and-extensions', () => {
  const safe = core.createSafeErrorRecord({ errorCode: 'CORRUPT_RECORD', messageId: null, attemptId: null, adapterId: null, atMs: 1, retryable: false, publicDetail: 'safe', privateDiagnosticReference: null });
  assert.equal(Object.isFrozen(safe), true);
  expectCode(() => core.createSafeErrorRecord({ ...safe, publicDetail: 'Authorization: Bearer secret' }), 'UNSAFE_LOGGING_ATTEMPT');
  let deep = {}; for (let i = 0; i < 18; i += 1) deep = { nested: deep };
  expectCode(() => core.normalizeExtensions(deep), 'UNTRUSTED_EXTENSION');
});

const pass = vectors.filter((v) => v.status === 'PASS').length; const fail = vectors.length - pass;
const output = { orderId: 'ZUNGUN-AUD-ARQ-CANONICAL-CANDIDATE-MATERIALIZATION-072', total: vectors.length, pass, fail, breakingRegressions: fail, vectors };
const text = `${JSON.stringify(output, null, 2)}\n`;
fs.mkdirSync('evidence/order072', { recursive: true }); fs.writeFileSync('evidence/order072/differential-results-072.json', text);
console.log(JSON.stringify({ ok: fail === 0 && pass === 10, total: vectors.length, pass, fail, breakingRegressions: fail }));
if (fail !== 0 || pass !== 10) process.exit(1);
