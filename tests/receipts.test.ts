import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  InMemoryReceiptKeyProvider,
  LocalFileReceiptKeyProvider,
  receiptVectorHash,
  signExecutionReceipt,
  verifyExecutionReceipt,
  verifyExecutionReceiptBinding,
  type ExecutionReceiptPayload,
} from '../packages/security/src/receipts.js';
import { BASE_TIME } from './helpers.js';

const payload = (): ExecutionReceiptPayload => ({
  schema: 'zungun.execution-receipt.v1',
  protocolVersion: 1,
  operationId: 'op_test_1',
  messageCommitment: 'sha256:abc',
  receiverId: 'receiver_1',
  applicationOutcome: 'EFFECT_APPLIED',
  applicationReference: 'erp_123',
  scopeType: 'SHIFT',
  scopeId: 'shift_1',
  issuedAtMs: BASE_TIME,
  validFromMs: BASE_TIME - 1,
  validUntilMs: BASE_TIME + 100_000,
  replayNonce: 'nonce_1',
});

test('P-256 receipt verifies with full binding', () => {
  const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
  const receipt = signExecutionReceipt(payload(), provider);
  assert.equal(verifyExecutionReceipt(receipt, provider, BASE_TIME + 1), true);
  assert.equal(verifyExecutionReceiptBinding(receipt, provider, BASE_TIME + 1, {
    operationId: 'op_test_1',
    messageCommitment: 'sha256:abc',
    receiverId: 'receiver_1',
    scopeType: 'SHIFT',
    scopeId: 'shift_1',
    replayNonce: 'nonce_1',
    allowedOutcomes: ['EFFECT_APPLIED'],
  }), true);
});

test('signature, payload, digest and binding tampering fail', () => {
  const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
  const receipt = signExecutionReceipt(payload(), provider);
  assert.equal(verifyExecutionReceipt({ ...receipt, signatureBase64: `${receipt.signatureBase64.slice(0, -2)}AA` }, provider, BASE_TIME + 1), false);
  assert.equal(verifyExecutionReceipt({ ...receipt, payload: { ...receipt.payload, applicationReference: 'erp_other' } }, provider, BASE_TIME + 1), false);
  assert.equal(verifyExecutionReceipt({ ...receipt, payloadSha256: '0'.repeat(64) }, provider, BASE_TIME + 1), false);
  assert.equal(verifyExecutionReceiptBinding(receipt, provider, BASE_TIME + 1, {
    operationId: 'op_wrong',
    messageCommitment: 'sha256:abc',
    receiverId: 'receiver_1',
    scopeType: 'SHIFT',
    scopeId: 'shift_1',
    replayNonce: 'nonce_1',
  }), false);
});

test('unknown, revoked, stale and expired keys fail', () => {
  const first = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
  const second = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
  const receipt = signExecutionReceipt(payload(), first);
  assert.equal(verifyExecutionReceipt(receipt, second, BASE_TIME + 1), false);
  first.revoke(receipt.keyId, BASE_TIME);
  assert.equal(verifyExecutionReceipt(receipt, first, BASE_TIME + 1), false);
  const future = new InMemoryReceiptKeyProvider(BASE_TIME + 100);
  assert.throws(() => signExecutionReceipt(payload(), future), /active signing key/);
  const valid = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
  const expiring = signExecutionReceipt(payload(), valid);
  assert.equal(verifyExecutionReceipt(expiring, valid, BASE_TIME + 100_001), false);
});

test('file provider persists rotation and revocation across restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zungun-keys-'));
  const path = join(dir, 'keys.json');
  try {
    const provider = new LocalFileReceiptKeyProvider(path, BASE_TIME - 100, 100_000);
    const original = provider.current(BASE_TIME).keyId;
    const rotated = provider.rotate(BASE_TIME + 1, 100_000);
    provider.revoke(original, BASE_TIME + 2);
    const restarted = new LocalFileReceiptKeyProvider(path, BASE_TIME + 3, 100_000);
    assert.equal(restarted.current(BASE_TIME + 3).keyId, rotated);
    assert.equal(restarted.resolve(original)?.revokedAtMs, BASE_TIME + 2);
    assert.equal(restarted.list().length, 2);
    assert.equal((Number((readFileSync(path, 'utf8').match(/"revision": (\d+)/)?.[1]))), 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt file provider fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zungun-keys-corrupt-'));
  const path = join(dir, 'keys.json');
  try {
    writeFileSync(path, '{"schema":"wrong"}');
    assert.throws(() => new LocalFileReceiptKeyProvider(path, BASE_TIME), /KEY_STORE_CORRUPT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('payload hash and vector hash are deterministic', () => {
  const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
  const first = signExecutionReceipt(payload(), provider);
  const second = signExecutionReceipt(payload(), provider);
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.match(receiptVectorHash(first), /^[0-9a-f]{64}$/);
});

test('invalid validity and custom algorithms are rejected', () => {
  const provider = new InMemoryReceiptKeyProvider(BASE_TIME - 100);
  assert.throws(() => signExecutionReceipt({ ...payload(), validUntilMs: BASE_TIME }, provider), /validity/);
  const receipt = signExecutionReceipt(payload(), provider);
  assert.equal(verifyExecutionReceipt({ ...receipt, algorithm: 'CUSTOM' as any }, provider, BASE_TIME + 1), false);
});
