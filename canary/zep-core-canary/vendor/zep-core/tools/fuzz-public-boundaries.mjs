import * as core from '../dist/src/index.js';

let seed = 0x5a17c0de;
function randomU32() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}
function pick(values) { return values[randomU32() % values.length]; }

const encoder = new TextEncoder();
const validMessageInput = () => ({
  zepVersion: '0.1',
  messageId: 'fuzz-message',
  conversationId: 'fuzz-conversation',
  senderId: 'fuzz-sender',
  recipientIds: ['recipient-1', 'recipient-2'],
  createdAtMs: 1000,
  expiresAtMs: 100000,
  priority: 1,
  contentType: 'application/octet-stream',
  payload: encoder.encode('fuzz'),
  receiptPolicy: 'END_RECIPIENT_ACK',
  messageCommitment: 'commitment-fuzz',
});
const validCapability = () => ({
  adapterId: 'FUZZ_ADAPTER', adapterVersion: '1', maximumPayloadBytes: 4096,
  supportsBinary: true, supportsFragmentation: true, supportsTransportReceipt: true,
  supportsEndRecipientReceipt: true, supportsCancel: true, supportsBackground: true,
  supportsStoreAndForward: true, requiresUserPresence: false, requiresExternalHardware: false,
  requiresOperatorEntitlement: false, availabilityClass: 1, expectedLatencyClass: 1,
  estimatedCompletionDurationMs: 1000, monetaryCostClass: 0, energyCostClass: 0,
  privacyMetadataClass: 0, currentEligibility: 'ALLOWED', duplicateSafe: true,
});
const validFragment = () => ({
  messageId: 'fuzz-message', messageCommitment: 'commitment-fuzz', fragmentIndex: 0,
  fragmentCount: 1, byteOffset: 0, fragmentPayload: Uint8Array.of(1), authenticated: true,
  expiresAtMs: 100000,
});
const validReceipt = () => ({
  receiptId: 'receipt-fuzz', messageId: 'fuzz-message', messageCommitment: 'commitment-fuzz',
  recipientId: 'recipient-1', receiptKind: 'END_RECIPIENT_ACKNOWLEDGED', observedAtMs: 2000,
  adapterId: 'FUZZ_ADAPTER', authenticated: true,
});
const validRouteRequirements = () => ({
  fragmentBytes: 1, fragmentCount: 1, requiresBinary: true, requiresFragmentation: false,
  requiresTransportReceipt: false, requiresEndRecipientReceipt: true,
});
const validRoutePolicy = () => ({
  version: 'fuzz-policy', maximumMonetaryCostClass: 9, maximumEnergyCostClass: 9,
  maximumPrivacyMetadataClass: 9, acceptsDuplicationRisk: false,
});
const verifier = Object.freeze({ verify: (_message, receipt) => receipt.authenticated === true });

const primitiveCorpus = [
  undefined, null, true, false, 0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY,
  '', 'yes', 'false', 1n, Symbol('fuzz'), () => undefined, [], new Date(0), /x/,
];

let cases = 0;
let normalizedErrors = 0;
let safeReturns = 0;
let rawNativeErrors = 0;
let unexpectedAccepts = 0;
const failures = [];

async function expectNormalized(label, operation, allowReturn = false) {
  cases += 1;
  try {
    const result = await operation();
    if (allowReturn) safeReturns += 1;
    else {
      unexpectedAccepts += 1;
      failures.push(`${label}: unexpectedly accepted`);
    }
    return result;
  } catch (error) {
    if (error instanceof core.ZepError) normalizedErrors += 1;
    else {
      rawNativeErrors += 1;
      failures.push(`${label}: raw ${error?.constructor?.name ?? typeof error}: ${String(error)}`);
    }
    return undefined;
  }
}

const validMessage = core.validateMessage(validMessageInput(), 1000);
const machine = new core.DeliveryStateMachine(validMessage);
const store = new core.InMemoryMessageStore();
const adapter = {
  async capabilities(context) { return validCapability(context); },
  async status(context) { return { adapterId: 'FUZZ_ADAPTER', observedAtMs: context.nowMs, availability: 'AVAILABLE', currentEligibility: 'ALLOWED' }; },
  async send(_fragment, context) { return { kind: 'accepted', acceptedAtMs: context.nowMs }; },
  async receive(_cursor, context) { return { cursor: null, items: [], observedAtMs: context.nowMs, hasMore: false }; },
  async cancel(_messageId, _attemptId, context) { return { kind: 'cancelled', cancelledAtMs: context.nowMs }; },
};

const firstArgumentFuzzers = new Map([
  ['DeliveryStateMachine', (v) => new core.DeliveryStateMachine(v)],
  ['adapterCancel', (v) => core.adapterCancel(v, 'm', 'a', { nowMs: 2000 })],
  ['adapterCapabilities', (v) => core.adapterCapabilities(v, { nowMs: 2000 })],
  ['adapterReceive', (v) => core.adapterReceive(v, null, { nowMs: 2000, limit: 1 })],
  ['adapterSend', (v) => core.adapterSend(v, validFragment(), { nowMs: 2000, attemptId: 'a', idempotencyKey: 'i', deadlineMs: 100000 })],
  ['adapterStatus', (v) => core.adapterStatus(v, { nowMs: 2000 })],
  ['applySendResult', (v) => core.applySendResult(v, validMessage, { kind: 'permanentlyRejected', reasonCode: 'NO' }, { atMs: 2000, attemptId: 'a', capability: validCapability(), alternativeEligibleRouteExists: false })],
  ['assertValidatedMessage', (v) => core.assertValidatedMessage(v)],
  ['assertVerifiedEndRecipientReceipt', (v) => core.assertVerifiedEndRecipientReceipt(v)],
  ['authorizeUnknownRetry', (v) => core.authorizeUnknownRetry(v, false)],
  ['checkedAddMs', (v) => core.checkedAddMs(v, 1, 'fuzz')],
  ['createSafeErrorRecord', (v) => core.createSafeErrorRecord(v)],
  ['effectiveNow', (v) => core.effectiveNow(v, 1)],
  ['isExpired', (v) => core.isExpired(v, 1)],
  ['normalizeExtensions', (v) => core.normalizeExtensions(v)],
  ['provesEndRecipientAcknowledgement', (v) => core.provesEndRecipientAcknowledgement(v, validReceipt(), verifier)],
  ['reassembleFragments', (v) => core.reassembleFragments(v, 2000)],
  ['requireBoolean', (v) => core.requireBoolean(v, 'fuzz')],
  ['requireEnum', (v) => core.requireEnum(v, 'fuzz', ['A'])],
  ['requireEpochMs', (v) => core.requireEpochMs(v, 'fuzz')],
  ['requireNonNegativeSafeInteger', (v) => core.requireNonNegativeSafeInteger(v, 'fuzz')],
  ['requireOpaqueId', (v) => core.requireOpaqueId(v, 'fuzz')],
  ['requireOptionalOpaqueId', (v) => core.requireOptionalOpaqueId(v, 'fuzz')],
  ['requirePositiveSafeInteger', (v) => core.requirePositiveSafeInteger(v, 'fuzz')],
  ['requireReasonCode', (v) => core.requireReasonCode(v)],
  ['requireUint8Array', (v) => core.requireUint8Array(v, 'fuzz')],
  ['resolveAcceptedTimeout', (v) => core.resolveAcceptedTimeout(v, 2000)],
  ['selectRoute', (v) => core.selectRoute(v, validRouteRequirements(), [validCapability()], validRoutePolicy(), 2000)],
  ['validateAdapterContext', (v) => core.validateAdapterContext(v)],
  ['validateAttemptContext', (v) => core.validateAttemptContext(v)],
  ['validateCancelResult', (v) => core.validateCancelResult(v)],
  ['validateEpochMs', (v) => core.validateEpochMs(v, 'fuzz')],
  ['validateFragment', (v) => core.validateFragment(v)],
  ['validateMessage', (v) => core.validateMessage(v, 1000)],
  ['validateReceipt', (v) => core.validateReceipt(v, validReceipt())],
  ['validateReceiptShape', (v) => core.validateReceiptShape(v)],
  ['validateReceiveBatch', (v) => core.validateReceiveBatch(v)],
  ['validateReceiveContext', (v) => core.validateReceiveContext(v)],
  ['validateSendResult', (v) => core.validateSendResult(v)],
  ['validateTransportCapabilities', (v) => core.validateTransportCapabilities(v)],
  ['validateTransportStatus', (v) => core.validateTransportStatus(v)],
  ['verifyEndRecipientReceipt', (v) => core.verifyEndRecipientReceipt(v, validReceipt(), verifier)],
]);

for (const [name, invoke] of firstArgumentFuzzers) {
  for (let iteration = 0; iteration < 64; iteration += 1) {
    await expectNormalized(`${name}[${iteration}]`, () => invoke(pick(primitiveCorpus)), true);
  }
}

// Safe predicates / nullable helpers have defined non-error cases.
await expectNormalized('isValidatedMessage(null)', () => core.isValidatedMessage(null), true);
await expectNormalized('requireOptionalOpaqueId(undefined)', () => core.requireOptionalOpaqueId(undefined, 'fuzz'), true);

const exactObjectValidators = [
  ['LogicalMessageInput', validMessageInput, (v) => core.validateMessage(v, 1000)],
  ['Fragment', validFragment, (v) => core.validateFragment(v)],
  ['Receipt', validReceipt, (v) => core.validateReceiptShape(v)],
  ['TransportCapabilities', validCapability, (v) => core.validateTransportCapabilities(v)],
  ['TransportStatus', () => ({ adapterId: 'FUZZ_ADAPTER', observedAtMs: 2000, availability: 'AVAILABLE', currentEligibility: 'ALLOWED' }), (v) => core.validateTransportStatus(v)],
  ['SendResult', () => ({ kind: 'permanentlyRejected', reasonCode: 'NO' }), (v) => core.validateSendResult(v)],
  ['ReceiveBatch', () => ({ cursor: null, items: [], observedAtMs: 2000, hasMore: false }), (v) => core.validateReceiveBatch(v)],
  ['CancelResult', () => ({ kind: 'unsupported', reasonCode: 'NO' }), (v) => core.validateCancelResult(v)],
  ['AdapterContext', () => ({ nowMs: 2000 }), (v) => core.validateAdapterContext(v)],
  ['AttemptContext', () => ({ nowMs: 2000, attemptId: 'a', idempotencyKey: 'i', deadlineMs: 100000 }), (v) => core.validateAttemptContext(v)],
  ['ReceiveContext', () => ({ nowMs: 2000, limit: 1 }), (v) => core.validateReceiveContext(v)],
];
for (const [name, make, validate] of exactObjectValidators) {
  for (let iteration = 0; iteration < 128; iteration += 1) {
    const value = make();
    value[`providerPrivate_${iteration}`] = `secret_${randomU32()}`;
    await expectNormalized(`${name}.extra[${iteration}]`, () => validate(value));
  }
}

// AUD-026 targeted invariants.
for (let recipientCount = 2; recipientCount <= 12; recipientCount += 1) {
  const recipients = Array.from({ length: recipientCount }, (_, index) => `r-${index}`);
  const full = core.validateMessage({ ...validMessageInput(), messageId: `full-${recipientCount}`, recipientIds: recipients }, 1000);
  const delivery = new core.DeliveryStateMachine(full);
  const subset = core.validateMessage({ ...validMessageInput(), messageId: `full-${recipientCount}`, recipientIds: recipients.slice(0, recipientCount - 1) }, 1000);
  const receipt = { ...validReceipt(), messageId: full.messageId, recipientId: recipients[0], messageCommitment: full.messageCommitment };
  const proof = core.verifyEndRecipientReceipt(subset, receipt, verifier);
  await expectNormalized(`identity-substitution-${recipientCount}`, () => delivery.recordVerifiedRecipientAcknowledgement(proof));
}

const falseBooleanCorpus = ['yes', 'no', 'true', 'false', 0, 1, -1, [], {}, null, undefined, new Boolean(true)];
for (const candidate of falseBooleanCorpus) {
  const message = core.validateMessage({ ...validMessageInput(), messageId: `truth-${String(randomU32())}`, recipientIds: ['recipient-1'] }, 1000);
  const delivery = new core.DeliveryStateMachine(message);
  delivery.transition('ELIGIBLE', { atMs: 1500 });
  await expectNormalized(`OutcomeContext.boolean.${String(candidate)}`, () => core.applySendResult(
    delivery,
    message,
    { kind: 'permanentlyRejected', reasonCode: 'NO' },
    { atMs: 2000, attemptId: 'a', capability: validCapability(), alternativeEligibleRouteExists: candidate },
  ));
  if (delivery.current() !== 'ELIGIBLE') {
    failures.push(`OutcomeContext.boolean.${String(candidate)} mutated state`);
    unexpectedAccepts += 1;
  }
  await expectNormalized(`authorizeUnknownRetry.boolean.${String(candidate)}`, () => core.authorizeUnknownRetry({ ...validCapability(), duplicateSafe: false }, candidate));
}

// Adapter exceptions must never escape as native provider errors.
for (const method of ['capabilities', 'status', 'send', 'receive', 'cancel']) {
  const hostile = { ...adapter, [method]: async () => { throw new TypeError(`provider-${method}`); } };
  const operation = method === 'capabilities' ? () => core.adapterCapabilities(hostile, { nowMs: 2000 })
    : method === 'status' ? () => core.adapterStatus(hostile, { nowMs: 2000 })
    : method === 'send' ? () => core.adapterSend(hostile, validFragment(), { nowMs: 2000, attemptId: 'a', idempotencyKey: 'i', deadlineMs: 100000 })
    : method === 'receive' ? () => core.adapterReceive(hostile, null, { nowMs: 2000, limit: 1 })
    : () => core.adapterCancel(hostile, 'm', 'a', { nowMs: 2000 });
  await expectNormalized(`adapter-native-${method}`, operation);
}

const runtimeExports = Object.keys(core).sort();
const classified = new Set([
  ...firstArgumentFuzzers.keys(),
  'ALLOWED_TRANSITIONS', 'DELIVERY_STATES', 'TERMINAL_STATES', 'InMemoryMessageStore', 'ZepError',
  'adapterCancel', 'adapterCapabilities', 'adapterReceive', 'adapterSend', 'adapterStatus',
  'fail', 'isValidatedMessage', 'requireOptionalOpaqueId',
]);
const unclassified = runtimeExports.filter((name) => !classified.has(name));
if (unclassified.length > 0) failures.push(`unclassified runtime exports: ${unclassified.join(',')}`);

console.log(`FUZZ_SEED=0x${(0x5a17c0de).toString(16)}`);
console.log(`PUBLIC_RUNTIME_EXPORTS=${runtimeExports.length}`);
console.log(`FUZZ_CASES=${cases}`);
console.log(`NORMALIZED_ZEP_ERRORS=${normalizedErrors}`);
console.log(`SAFE_RETURNS=${safeReturns}`);
console.log(`RAW_NATIVE_ERRORS=${rawNativeErrors}`);
console.log(`UNEXPECTED_ACCEPTS=${unexpectedAccepts}`);
console.log(`UNCLASSIFIED_EXPORTS=${unclassified.length}`);
if (failures.length > 0) {
  console.error(failures.slice(0, 50).join('\n'));
  process.exit(1);
}
