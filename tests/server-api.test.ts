import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReceiverServer } from '../services/receiver/src/server.js';
import { makeEnvelope } from './helpers.js';

const TOKENS = Object.freeze({
  ingest: 'server-ingest-token-order076',
  reader: 'server-reader-token-order076',
  worker: 'server-worker-token-order076',
  reviewer: 'server-reviewer-token-order076',
  admin: 'server-admin-token-order076',
});
const principals = Object.freeze([
  { subject: 'ingest', token: TOKENS.ingest, roles: ['ingest'] as const },
  { subject: 'reader', token: TOKENS.reader, roles: ['reader'] as const },
  { subject: 'worker', token: TOKENS.worker, roles: ['worker'] as const },
  { subject: 'reviewer', token: TOKENS.reviewer, roles: ['reviewer'] as const },
  { subject: 'admin', token: TOKENS.admin, roles: ['admin'] as const },
]);

const headers = (token: string) => ({
  'content-type': 'application/json',
  authorization: `Bearer ${token}`,
});

async function withServer(fn: (origin: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'zungun-server-'));
  const app = createReceiverServer({
    databasePath: join(dir, 'db.sqlite'),
    keyPath: join(dir, 'key.json'),
    principals,
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address() as any;
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('health and readiness perform real checks while APIs require authentication', async () => withServer(async (origin) => {
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  const ready = await (await fetch(`${origin}/ready`)).json() as any;
  assert.equal(ready.database.queryOk, true);
  assert.equal(ready.database.migrationCount, 4);
  assert.match(ready.activeKeyId, /^key_/);
  assert.equal((await fetch(`${origin}/api/v1/operations`)).status, 401);
}));

test('role-specific routes deny cross-role access and audit decisions without credentials', async () => withServer(async (origin) => {
  const envelope = makeEnvelope({
    policy: { ...makeEnvelope().policy, createdAtMs: Date.now() - 1_000, expiresAtMs: Date.now() + 3_600_000 },
  });
  assert.equal((await fetch(`${origin}/api/v1/operations`, {
    method: 'POST',
    headers: headers(TOKENS.reader),
    body: JSON.stringify(envelope),
  })).status, 403);
  assert.equal((await fetch(`${origin}/api/v1/operations`, {
    method: 'POST',
    headers: headers(TOKENS.ingest),
    body: JSON.stringify(envelope),
  })).status, 202);
  assert.equal((await fetch(`${origin}/api/v1/operations/${envelope.operationId}/claim`, {
    method: 'POST',
    headers: headers(TOKENS.reviewer),
    body: JSON.stringify({ ownerId: 'reviewer', nowMs: Date.now(), leaseMs: 30_000 }),
  })).status, 403);
  assert.equal((await fetch(`${origin}/api/v1/keys/rotate`, {
    method: 'POST',
    headers: headers(TOKENS.worker),
    body: JSON.stringify({ nowMs: Date.now(), validityMs: 86_400_000 }),
  })).status, 403);
  const auditResponse = await fetch(`${origin}/api/v1/auth-audit`, { headers: headers(TOKENS.admin) });
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json() as any;
  assert.ok(audit.items.some((entry: any) => entry.allowed === 0));
  assert.equal(JSON.stringify(audit).includes(TOKENS.reader), false);
  assert.equal(JSON.stringify(audit).includes(TOKENS.worker), false);
}));

test('typed request validation rejects malformed claim and effect bodies', async () => withServer(async (origin) => {
  const envelope = makeEnvelope({
    policy: { ...makeEnvelope().policy, createdAtMs: Date.now() - 1_000, expiresAtMs: Date.now() + 3_600_000 },
  });
  await fetch(`${origin}/api/v1/operations`, {
    method: 'POST', headers: headers(TOKENS.ingest), body: JSON.stringify(envelope),
  });
  const claim = await fetch(`${origin}/api/v1/operations/${envelope.operationId}/claim`, {
    method: 'POST', headers: headers(TOKENS.worker), body: JSON.stringify({ ownerId: '', leaseMs: -1 }),
  });
  assert.equal(claim.status, 400);
  const effect = await fetch(`${origin}/api/v1/operations/${envelope.operationId}/effect`, {
    method: 'POST', headers: headers(TOKENS.worker), body: JSON.stringify({ attemptId: 'x' }),
  });
  assert.equal(effect.status, 400);
}));

test('declared completeness and global pagination are backend-derived', async () => withServer(async (origin) => {
  const now = Date.now();
  const first = makeEnvelope({
    operationId: 'op_server_page_1', idempotencyKey: 'idem_server_page_1', replayNonce: 'nonce_server_page_1',
    policy: { ...makeEnvelope().policy, createdAtMs: now - 1_000, expiresAtMs: now + 3_600_000 },
  });
  const second = makeEnvelope({
    operationId: 'op_server_page_2', idempotencyKey: 'idem_server_page_2', replayNonce: 'nonce_server_page_2',
    messageId: 'msg_server_page_2', workOrderId: 'WO-SERVER-2',
    policy: { ...makeEnvelope().policy, createdAtMs: now - 900, expiresAtMs: now + 3_600_000 },
  });
  for (const envelope of [first, second]) {
    assert.equal((await fetch(`${origin}/api/v1/operations`, {
      method: 'POST', headers: headers(TOKENS.ingest), body: JSON.stringify(envelope),
    })).status, 202);
  }
  const page = await (await fetch(`${origin}/api/v1/operations?limit=1`, { headers: headers(TOKENS.reader) })).json() as any;
  assert.equal(page.items.length, 1);
  assert.equal(page.total, 2);
  assert.equal(page.nextOffset, 1);

  const declaration = await fetch(`${origin}/api/v1/scopes/declarations`, {
    method: 'POST',
    headers: headers(TOKENS.admin),
    body: JSON.stringify({
      scopeType: first.scopeType,
      scopeId: first.scopeId,
      declarationVersion: 1,
      expectedReportingDeviceIds: ['device_17', 'silent_device'],
      expectedOperationIds: [first.operationId, second.operationId],
      expectedOperationCount: 2,
      declaredAtMs: now - 2_000,
      provenance: 'dispatch-manifest:server-test',
      previousManifestHash: null,
    }),
  });
  assert.equal(declaration.status, 201);
  const completeness = await (await fetch(
    `${origin}/api/v1/completeness?scopeType=SHIFT&scopeId=${first.scopeId}`,
    { headers: headers(TOKENS.reader) },
  )).json() as any;
  assert.equal(completeness.completeWithinDeclaredScope, false);
  assert.deepEqual(completeness.missingReportingDeviceIds, ['silent_device']);
}));

test('oversized request and traversal attempts fail closed', async () => withServer(async (origin) => {
  const oversized = await fetch(`${origin}/api/v1/operations`, {
    method: 'POST', headers: headers(TOKENS.ingest), body: 'x'.repeat(1_000_001),
  });
  assert.equal(oversized.status, 413);
  assert.equal((await fetch(`${origin}/..%2F..%2Fetc%2Fpasswd`)).status, 404);
}));
