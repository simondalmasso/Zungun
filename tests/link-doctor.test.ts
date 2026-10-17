import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeOpenApi, analyzeSource } from '../tools/link-doctor/src/analyze.js';

test('Doctor flags stale connectivity, raw diagnostic risk, missing expiry and reconciliation', () => {
  const source = `val connected = cm.activeNetwork != null\nLog.d("net", "token payload=" + payload)\nfun submit(){ post(body); retry() }`;
  const ids = new Set(analyzeSource('Client.kt', source).map((f) => f.ruleId));
  assert.equal(ids.has('ZL003_STALE_CONNECTIVITY_BOOLEAN'), true);
  assert.equal(ids.has('ZL013_SECRET_OR_PAYLOAD_DIAGNOSTIC_RISK'), true);
  assert.equal(ids.has('ZL014_NO_OPERATION_EXPIRY'), true);
  assert.equal(ids.has('ZL015_NO_RECEIVER_RECONCILIATION_PATH'), true);
});

test('Doctor never assumes OpenAPI POST retry safety and reports objective request signals', () => {
  const spec = JSON.stringify({ openapi: '3.1.0', paths: { '/close': { post: {
    requestBody: { content: { 'application/json': { schema: { type: 'string', maxLength: 4096 } } } },
    responses: { '202': { description: 'ok' } },
  } } } });
  const report = analyzeOpenApi(spec, 'api.json');
  const operation = report.scaffold.operations[0]!;
  assert.equal(operation.retryContract, 'UNKNOWN_REQUIRES_ANNOTATION');
  assert.equal(operation.idempotencyRequired, false);
  assert.deepEqual(operation.requestMediaTypes, ['application/json']);
  assert.equal(operation.bodySizeHintBytes, 4096);
  assert.equal(operation.binaryOrMultipart, false);
  assert.equal(report.findings.some((f) => f.ruleId === 'ZL001_UNSAFE_SIDE_EFFECT_RETRY'), true);
});

test('Doctor recognizes declared idempotency header, multipart/binary and body-size bound without guessing retry safety', () => {
  const spec = `openapi: 3.1.0\npaths:\n  /upload:\n    post:\n      x-zungun-retry-contract: RECONCILE_BEFORE_RETRY\n      x-zungun-max-body-bytes: 1048576\n      parameters:\n        - in: header\n          name: Idempotency-Key\n          required: true\n      requestBody:\n        content:\n          multipart/form-data:\n            schema:\n              type: object\n              properties:\n                file:\n                  type: string\n                  format: binary\n`;
  const report = analyzeOpenApi(spec, 'api.yaml');
  const operation = report.scaffold.operations[0]!;
  assert.equal(operation.retryContract, 'RECONCILE_BEFORE_RETRY');
  assert.equal(operation.idempotencyRequired, true);
  assert.equal(operation.idempotencyHeaderDeclared, true);
  assert.deepEqual(operation.requestMediaTypes, ['multipart/form-data']);
  assert.equal(operation.binaryOrMultipart, true);
  assert.equal(operation.bodySizeHintBytes, 1_048_576);
  assert.equal(report.findings.length, 0);
});

test('Doctor leaves binary/multipart retry semantics unknown and warns when body bound is absent', () => {
  const spec = JSON.stringify({ openapi: '3.1.0', paths: { '/blob': { post: {
    requestBody: { content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
  } } } });
  const report = analyzeOpenApi(spec, 'binary.json');
  assert.equal(report.scaffold.operations[0]!.retryContract, 'UNKNOWN_REQUIRES_ANNOTATION');
  assert.equal(report.scaffold.operations[0]!.binaryOrMultipart, true);
  assert.equal(report.scaffold.operations[0]!.bodySizeHintBytes, null);
  assert.equal(report.findings.some((f) => f.ruleId === 'ZL008_MONOLITHIC_LARGE_MUTATION'), true);
});
