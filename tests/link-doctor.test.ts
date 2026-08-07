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

test('Doctor never assumes OpenAPI POST retry safety and produces a draft scaffold', () => {
  const spec = JSON.stringify({ openapi: '3.1.0', paths: { '/close': { post: { responses: { '202': { description: 'ok' } } } } } });
  const report = analyzeOpenApi(spec, 'api.json');
  assert.equal(report.scaffold.operations[0]!.retryContract, 'UNKNOWN_REQUIRES_ANNOTATION');
  assert.equal(report.findings.some((f) => f.ruleId === 'ZL001_UNSAFE_SIDE_EFFECT_RETRY'), true);
});

test('Doctor preserves explicit OpenAPI Zungun retry and idempotency annotations', () => {
  const spec = `openapi: 3.1.0\npaths:\n  /close:\n    post:\n      x-zungun-retry-contract: RECONCILE_BEFORE_RETRY\n      x-zungun-idempotency-required: true\n`;
  const report = analyzeOpenApi(spec, 'api.yaml');
  assert.equal(report.scaffold.operations[0]!.retryContract, 'RECONCILE_BEFORE_RETRY');
  assert.equal(report.scaffold.operations[0]!.idempotencyRequired, true);
  assert.equal(report.findings.length, 0);
});
