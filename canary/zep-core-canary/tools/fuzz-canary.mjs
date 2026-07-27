import { handleRequest } from '../dist/src/worker.js';

const NOW = 1_800_000_000_000;
const SENTINEL = 'ZUNGUN_FUZZ_SECRET_SENTINEL';
let state = 0x5a17c9e3;
function next() {
  state ^= state << 13; state >>>= 0;
  state ^= state >>> 17; state >>>= 0;
  state ^= state << 5; state >>>= 0;
  return state >>> 0;
}
function pick(values) { return values[next() % values.length]; }
function validInput() {
  return {
    zepVersion: '0.1', messageId: 'msg-fuzz', conversationId: 'conv-fuzz', senderId: 'sender-fuzz',
    recipientIds: ['recipient-a', 'recipient-b'], createdAtMs: NOW - 1000, expiresAtMs: NOW + 60000,
    priority: 2, contentType: 'application/octet-stream', payloadBase64: 'aGVsbG8=',
    receiptPolicy: 'END_RECIPIENT_ACK', messageCommitment: 'commitment-fuzz',
  };
}
function jsonRequest(input, path = '/v1/messages/validate', method = 'POST', contentType = 'application/json') {
  return new Request(`https://canary.invalid${path}`, {
    method,
    headers: contentType === null ? undefined : { 'content-type': contentType },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(input),
  });
}

let cases = 0;
let unexpectedAccepts = 0;
let nativeFailures = 0;
let reflections = 0;
const statusCounts = new Map();
const errorCodes = new Map();

async function adversarial(name, request, expectedNon2xx = true) {
  cases += 1;
  try {
    const response = await handleRequest(request, () => NOW);
    const text = await response.text();
    statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
    if (text.includes(SENTINEL)) reflections += 1;
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    const code = parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object'
      ? parsed.error.code : undefined;
    if (typeof code === 'string') errorCodes.set(code, (errorCodes.get(code) ?? 0) + 1);
    if (response.status >= 500) nativeFailures += 1;
    if (expectedNon2xx && response.status >= 200 && response.status < 300) unexpectedAccepts += 1;
  } catch (error) {
    nativeFailures += 1;
    console.error(JSON.stringify({ type: 'native_failure', name, error: error instanceof Error ? error.message : String(error) }));
  }
}

// Exact allowlist: every injected field must fail and must never be reflected.
for (let i = 0; i < 512; i += 1) {
  const input = validInput();
  input[`private_${i}_${next().toString(16)}`] = `${SENTINEL}_${i}`;
  await adversarial(`unknown-field-${i}`, jsonRequest(input));
}

const invalidByField = {
  zepVersion: [null, true, false, 0, 1, '0.0', '0.2', {}, []],
  messageId: [null, true, 0, '', ' ', 'a b', 'x'.repeat(257), {}, []],
  conversationId: [null, true, 0, '', '\t', 'a b', 'x'.repeat(257), {}, []],
  senderId: [null, true, 0, '', '\n', 'a b', 'x'.repeat(257), {}, []],
  recipientIds: [null, true, 0, '', {}, [], ['a', 'a'], [1], ['a b'], ['x'.repeat(257)]],
  createdAtMs: [null, true, '1', -1, Number.MAX_SAFE_INTEGER, {}, []],
  expiresAtMs: [null, true, '1', -1, NOW - 1, NOW, {}, []],
  priority: [null, true, false, '2', -1, 4, 2.5, {}, []],
  contentType: [null, true, 0, '', 'x'.repeat(129), {}, []],
  payloadBase64: [null, true, 0, {}, [], 'a', 'abc', 'a===', 'aGVsbG8', 'aGVsbG8-'],
  receiptPolicy: [null, true, false, 0, '', 'ACK', {}, []],
  messageCommitment: [null, true, 0, '', ' ', 'a b', 'x'.repeat(257), {}, []],
};
for (const [field, values] of Object.entries(invalidByField)) {
  for (let round = 0; round < 16; round += 1) {
    const input = validInput(); input[field] = pick(values);
    await adversarial(`invalid-${field}-${round}`, jsonRequest(input));
  }
}

// Guaranteed malformed/non-canonical Base64.
for (let i = 0; i < 768; i += 1) {
  const input = validInput();
  const mode = i % 4;
  if (mode === 0) input.payloadBase64 = `${next().toString(36)}-`;
  else if (mode === 1) input.payloadBase64 = 'A'.repeat((next() % 64) * 4 + 1);
  else if (mode === 2) input.payloadBase64 = `=${'A'.repeat(next() % 20)}`;
  else input.payloadBase64 = `AA=${next().toString(16)}`;
  await adversarial(`base64-${i}`, jsonRequest(input));
}

// Recipient-set mutations guaranteed invalid.
for (let i = 0; i < 512; i += 1) {
  const input = validInput();
  switch (i % 6) {
    case 0: input.recipientIds = []; break;
    case 1: input.recipientIds = ['same', 'same']; break;
    case 2: input.recipientIds = [`bad id ${i}`]; break;
    case 3: input.recipientIds = [i]; break;
    case 4: input.recipientIds = ['x'.repeat(257)]; break;
    default: input.recipientIds = null; break;
  }
  await adversarial(`recipients-${i}`, jsonRequest(input));
}

// Invalid paths, query strings, methods and media types.
for (let i = 0; i < 512; i += 1) {
  const mode = i % 4;
  if (mode === 0) await adversarial(`path-${i}`, jsonRequest(validInput(), `/v1/messages/validate/${i}`));
  else if (mode === 1) await adversarial(`query-${i}`, jsonRequest(validInput(), `/v1/messages/validate?x=${i}`));
  else if (mode === 2) await adversarial(`method-${i}`, jsonRequest(validInput(), '/v1/messages/validate', pick(['PUT', 'PATCH', 'DELETE', 'OPTIONS'])));
  else await adversarial(`media-${i}`, jsonRequest(validInput(), '/v1/messages/validate', 'POST', pick([null, 'text/plain', 'application/cbor', 'multipart/form-data'])));
}

// Malformed JSON and invalid UTF-8.
for (let i = 0; i < 512; i += 1) {
  let body;
  if (i % 3 === 0) body = `{${'"x":'.repeat((i % 8) + 1)}`;
  else if (i % 3 === 1) body = new Uint8Array([0xff, 0xfe, next() & 0xff]);
  else body = 'x'.repeat(65_537 + (i % 16));
  const req = new Request('https://canary.invalid/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  await adversarial(`body-${i}`, req);
}

// Deep extensions exceed the audited core limit.
for (let i = 0; i < 256; i += 1) {
  const input = validInput();
  let value = { leaf: SENTINEL };
  for (let depth = 0; depth < 18 + (i % 8); depth += 1) value = { nested: value };
  input.extensions = value;
  await adversarial(`extensions-depth-${i}`, jsonRequest(input));
}

// Positive controls prove the harness still accepts valid requests.
let positivePasses = 0;
for (let i = 0; i < 128; i += 1) {
  cases += 1;
  const input = validInput();
  input.messageId = `valid-${i}`;
  input.payloadBase64 = i % 2 === 0 ? '' : 'AA==';
  const response = await handleRequest(jsonRequest(input), () => NOW);
  const text = await response.text();
  statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
  if (response.status === 200 && !text.includes(SENTINEL)) positivePasses += 1;
  else unexpectedAccepts += 1;
}

const result = {
  seed: '0x5a17c9e3',
  cases,
  adversarialCases: cases - 128,
  positiveControls: 128,
  positivePasses,
  unexpectedAccepts,
  nativeFailures,
  reflections,
  statusCounts: Object.fromEntries([...statusCounts.entries()].sort((a, b) => a[0] - b[0])),
  errorCodes: Object.fromEntries([...errorCodes.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))),
};
console.log(JSON.stringify(result));
if (unexpectedAccepts !== 0 || nativeFailures !== 0 || reflections !== 0 || positivePasses !== 128) process.exit(1);
