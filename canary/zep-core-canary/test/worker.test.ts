import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/worker.js';

const NOW = 1_800_000_000_000;
const SOURCE_SHA = 'f1df15fac64354ad51c297e3e4d0fca1c94e3bad01f1c5383bcb1dc367f133ec';

function validInput(): Record<string, unknown> {
  return {
    zepVersion: '0.1',
    messageId: 'msg-001',
    conversationId: 'conv-001',
    senderId: 'sender-001',
    recipientIds: ['recipient-001', 'recipient-002'],
    createdAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    priority: 2,
    contentType: 'application/octet-stream',
    payloadBase64: 'aGVsbG8=',
    receiptPolicy: 'END_RECIPIENT_ACK',
    messageCommitment: 'commitment-001',
  };
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://canary.invalid${path}`, init);
}

function jsonRequest(input: unknown, path = '/v1/messages/validate', headers?: HeadersInit): Request {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers).entries()) },
    body: JSON.stringify(input),
  });
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
  assert.equal(response.status, status);
  const body = await responseJson(response);
  assert.equal(body.ok, false);
  const error = body.error as Record<string, unknown>;
  assert.equal(error.code, code);
  assert.equal(error.retryable, false);
}

test('GET /health returns deterministic source identity', async () => {
  const response = await handleRequest(request('/health'), () => NOW);
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'healthy');
  const source = body.source as Record<string, unknown>;
  assert.equal(source.archiveSha256, SOURCE_SHA);
});

test('health response has strict security and cache headers', async () => {
  const response = await handleRequest(request('/health'), () => NOW);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
});

test('POST /health is rejected with Allow: GET', async () => {
  const response = await handleRequest(request('/health', { method: 'POST' }), () => NOW);
  await expectError(response, 405, 'METHOD_NOT_ALLOWED');
  assert.equal(response.headers.get('allow'), 'GET');
});

test('query parameters are not accepted on health', async () => {
  await expectError(await handleRequest(request('/health?debug=true'), () => NOW), 404, 'NOT_FOUND');
});

test('unknown path is 404', async () => {
  await expectError(await handleRequest(request('/missing'), () => NOW), 404, 'NOT_FOUND');
});

test('valid message is accepted without payload echo', async () => {
  const response = await handleRequest(jsonRequest(validInput()), () => NOW);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('aGVsbG8='), false);
  assert.equal(text.includes('hello'), false);
  const body = JSON.parse(text) as Record<string, unknown>;
  const result = body.result as Record<string, unknown>;
  assert.equal(result.messageId, 'msg-001');
  assert.equal(result.recipientCount, 2);
  assert.equal(result.payloadBytes, 5);
  assert.equal(result.extensionsPresent, false);
});

test('valid extensions are accepted but not echoed', async () => {
  const input = validInput();
  input.extensions = { privateProviderField: 'do-not-echo', nested: [1, true, null] };
  const response = await handleRequest(jsonRequest(input), () => NOW);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('do-not-echo'), false);
  const body = JSON.parse(text) as Record<string, unknown>;
  const result = body.result as Record<string, unknown>;
  assert.equal(result.extensionsPresent, true);
});

test('content type with charset is accepted', async () => {
  const response = await handleRequest(jsonRequest(validInput(), '/v1/messages/validate', {
    'content-type': 'application/json; charset=utf-8',
  }), () => NOW);
  assert.equal(response.status, 200);
});

test('GET validate endpoint is rejected with Allow: POST', async () => {
  const response = await handleRequest(request('/v1/messages/validate'), () => NOW);
  await expectError(response, 405, 'METHOD_NOT_ALLOWED');
  assert.equal(response.headers.get('allow'), 'POST');
});

test('OPTIONS does not enable CORS', async () => {
  const response = await handleRequest(request('/v1/messages/validate', { method: 'OPTIONS' }), () => NOW);
  await expectError(response, 405, 'METHOD_NOT_ALLOWED');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-methods'), null);
});

test('missing content type is rejected', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST',
    body: JSON.stringify(validInput()),
  }), () => NOW);
  await expectError(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('non-JSON content type is rejected', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}',
  }), () => NOW);
  await expectError(response, 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('empty body is invalid JSON', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '',
  }), () => NOW);
  await expectError(response, 400, 'INVALID_JSON');
});

test('malformed JSON is normalized', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  }), () => NOW);
  await expectError(response, 400, 'INVALID_JSON');
});

test('invalid UTF-8 is normalized', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0xff, 0xfe]),
  }), () => NOW);
  await expectError(response, 400, 'INVALID_UTF8');
});

test('null body object is rejected', async () => {
  await expectError(await handleRequest(jsonRequest(null), () => NOW), 400, 'INVALID_JSON_OBJECT');
});

test('array body object is rejected', async () => {
  await expectError(await handleRequest(jsonRequest([]), () => NOW), 400, 'INVALID_JSON_OBJECT');
});

test('unknown top-level field is rejected and not reflected', async () => {
  const input = validInput();
  input.privateToken = 'super-secret-value';
  const response = await handleRequest(jsonRequest(input), () => NOW);
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.equal(text.includes('privateToken'), false);
  assert.equal(text.includes('super-secret-value'), false);
  const body = JSON.parse(text) as Record<string, unknown>;
  const error = body.error as Record<string, unknown>;
  assert.equal(error.code, 'UNSUPPORTED_FIELD');
});

test('__proto__ top-level field is rejected', async () => {
  const raw = JSON.stringify(validInput()).replace(/}$/, ',"__proto__":{"polluted":true}}');
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
  }), () => NOW);
  await expectError(response, 400, 'UNSUPPORTED_FIELD');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('every required field is enforced', async () => {
  for (const key of Object.keys(validInput())) {
    const input = validInput();
    delete input[key];
    const response = await handleRequest(jsonRequest(input), () => NOW);
    await expectError(response, 400, 'MISSING_FIELD');
  }
});

test('body larger than 64 KiB is rejected while streaming', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(65_537),
  }), () => NOW);
  await expectError(response, 413, 'REQUEST_BODY_TOO_LARGE');
});

test('declared oversized body is rejected before parsing', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '65537' },
    body: '{}',
  }), () => NOW);
  await expectError(response, 413, 'REQUEST_BODY_TOO_LARGE');
});

test('invalid content-length is rejected', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': 'NaN' },
    body: '{}',
  }), () => NOW);
  await expectError(response, 400, 'INVALID_CONTENT_LENGTH');
});

test('declared content length must match bytes read', async () => {
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': '1' },
    body: '{}',
  }), () => NOW);
  await expectError(response, 400, 'CONTENT_LENGTH_MISMATCH');
});

test('payloadBase64 must be a string', async () => {
  const input = validInput(); input.payloadBase64 = 123;
  await expectError(await handleRequest(jsonRequest(input), () => NOW), 400, 'INVALID_BASE64');
});

test('non-canonical and malformed base64 corpora are rejected', async () => {
  const invalidValues = ['a', 'abc', 'a===', 'aGVsbG8', 'aGVsbG8=\n', 'aGVsbG8-', '====', 'AA=A'];
  for (const value of invalidValues) {
    const input = validInput(); input.payloadBase64 = value;
    await expectError(await handleRequest(jsonRequest(input), () => NOW), 400, 'INVALID_BASE64');
  }
});

test('empty base64 payload is accepted', async () => {
  const input = validInput(); input.payloadBase64 = '';
  const response = await handleRequest(jsonRequest(input), () => NOW);
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  const result = body.result as Record<string, unknown>;
  assert.equal(result.payloadBytes, 0);
});

test('invalid ZEP version is normalized', async () => {
  const input = validInput(); input.zepVersion = '0.2';
  await expectError(await handleRequest(jsonRequest(input), () => NOW), 422, 'INVALID_VERSION');
});

test('expired message maps to 410', async () => {
  const input = validInput(); input.expiresAtMs = NOW;
  await expectError(await handleRequest(jsonRequest(input), () => NOW), 410, 'EXPIRED');
});

test('duplicate recipients are rejected', async () => {
  const input = validInput(); input.recipientIds = ['recipient-001', 'recipient-001'];
  await expectError(await handleRequest(jsonRequest(input), () => NOW), 422, 'INVALID_IDENTIFIER');
});

test('empty recipient set is rejected', async () => {
  const input = validInput(); input.recipientIds = [];
  await expectError(await handleRequest(jsonRequest(input), () => NOW), 422, 'INVALID_IDENTIFIER');
});

test('truthy priority is not accepted', async () => {
  const input = validInput(); input.priority = '2';
  await expectError(await handleRequest(jsonRequest(input), () => NOW), 422, 'INVALID_PRIORITY');
});

test('truthy receipt policy is not accepted', async () => {
  const input = validInput(); input.receiptPolicy = true;
  await expectError(await handleRequest(jsonRequest(input), () => NOW), 422, 'UNSUPPORTED_RECEIPT_POLICY');
});

test('unsafe extension objects are rejected by core normalization', async () => {
  const input = validInput(); input.extensions = { nested: { token: undefined } };
  // JSON serialization drops undefined, so use an unsupported number instead.
  input.extensions = { nested: Number.NaN };
  const raw = JSON.stringify(input).replace('null', '1e400');
  const response = await handleRequest(request('/v1/messages/validate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: raw,
  }), () => NOW);
  assert.ok([400, 422].includes(response.status));
});

test('core error responses never include internal diagnostic messages', async () => {
  const input = validInput(); input.recipientIds = [];
  const response = await handleRequest(jsonRequest(input), () => NOW);
  const text = await response.text();
  assert.equal(text.includes('At least one recipient'), false);
  assert.equal(text.includes('stack'), false);
});

test('successful response is deterministic for identical input and clock', async () => {
  const first = await (await handleRequest(jsonRequest(validInput()), () => NOW)).text();
  const second = await (await handleRequest(jsonRequest(validInput()), () => NOW)).text();
  assert.equal(first, second);
});

test('health response is deterministic', async () => {
  const first = await (await handleRequest(request('/health'), () => NOW)).text();
  const second = await (await handleRequest(request('/health'), () => NOW + 99_999)).text();
  assert.equal(first, second);
});
