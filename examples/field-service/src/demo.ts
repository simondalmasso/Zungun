import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { stableOperationId } from '../../../packages/protocol-core/src/operation.js';

const TOKENS = Object.freeze({
  ingest: 'demo-ingest-token-order076',
  reader: 'demo-reader-token-order076',
  worker: 'demo-worker-token-order076',
  admin: 'demo-admin-token-order076',
});
const principals = [
  { subject: 'demo-ingest', token: TOKENS.ingest, roles: ['ingest'] },
  { subject: 'demo-reader', token: TOKENS.reader, roles: ['reader'] },
  { subject: 'demo-worker', token: TOKENS.worker, roles: ['worker'] },
  { subject: 'demo-admin', token: TOKENS.admin, roles: ['admin'] },
];

async function waitReady(origin: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${origin}/ready`);
      if (response.ok) return;
    } catch { /* process not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('RECEIVER_NOT_READY');
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function jsonRequest(origin: string, method: string, path: string, token: string, body?: unknown) {
  const init: RequestInit = {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${origin}${path}`, init);
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return payload as any;
}

const directory = mkdtempSync(join(tmpdir(), 'zungun-field-demo-'));
const origin = 'http://127.0.0.1:18791';
const databasePath = join(directory, 'receiver.sqlite');
const keyPath = join(directory, 'receipt-key.json');
const deviceOutbox = join(directory, 'android-room-snapshot.json');
const env = {
  ...process.env,
  RECEIVER_HOST: '127.0.0.1',
  RECEIVER_PORT: '18791',
  RECEIVER_DB: databasePath,
  RECEIVER_KEY_FILE: keyPath,
  ZUNGUN_RECEIVER_ID: 'receiver_field_demo',
  ZUNGUN_PRINCIPALS_JSON: JSON.stringify(principals),
};
const start = () => spawn(process.execPath, ['dist/services/receiver/src/server.js'], {
  cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
});

let server = start();
try {
  await waitReady(origin);
  const now = Date.now();
  const operationId = stableOperationId({
    tenantId: 'tenant_demo', deviceId: 'device_17', localSequence: 76, createdAtMs: now,
  });
  const envelope = {
    protocol: 'zungun.operation.v1', wireVersion: 1, operationId,
    idempotencyKey: `idem_${operationId}`, tenantId: 'tenant_demo', scopeType: 'SHIFT',
    scopeId: 'shift_field_demo_076', workOrderId: 'WO-2841', messageId: 'msg_2841',
    messageCommitment: 'sha256:field_demo_076',
    payloadBase64: Buffer.from(JSON.stringify({ action: 'COMPLETE', notes: 'pump inspected' })).toString('base64'),
    contentType: 'application/json',
    policy: { priority: 2, createdAtMs: now, expiresAtMs: now + 3_600_000, retryBudget: 8,
      cancellationAllowed: true, semanticRevalidationRequired: true, maxPayloadBytes: 16_384 },
    replayNonce: `nonce_${operationId}`,
    extensions: { deviceId: 'device_17', clientVersion: 'android-order076' },
  };

  writeFileSync(deviceOutbox, `${JSON.stringify(envelope)}\n`);
  await jsonRequest(origin, 'POST', '/api/v1/scopes/declarations', TOKENS.admin, {
    scopeType: 'SHIFT', scopeId: envelope.scopeId, declarationVersion: 1,
    expectedReportingDeviceIds: ['device_17'], expectedOperationIds: [operationId],
    expectedOperationCount: 1, declaredAtMs: now - 1,
    provenance: 'field-service-dispatch:v76', previousManifestHash: null,
  });
  const recoveredEnvelope = JSON.parse(readFileSync(deviceOutbox, 'utf8'));
  const acceptance = await jsonRequest(origin, 'POST', '/api/v1/operations', TOKENS.ingest, recoveredEnvelope);

  await stop(server);
  server = start();
  await waitReady(origin);

  const claim = await jsonRequest(origin, 'POST', `/api/v1/operations/${operationId}/claim`, TOKENS.worker, {
    ownerId: 'field-service-application', nowMs: now + 20, leaseMs: 30_000,
  });
  await jsonRequest(origin, 'POST', `/api/v1/operations/${operationId}/effect`, TOKENS.worker, {
    attemptId: claim.attemptId,
    fencingToken: claim.fencingToken,
    effect: {
      outcome: 'EFFECT_APPLIED', applicationAcknowledged: true,
      applicationReference: 'erp:WO-2841:v76', workOrderStatus: 'CLOSED',
      result: { completed: true, technician: 'TECH-17' }, occurredAtMs: now + 30,
    },
  });
  const duplicateWithReceipt = await jsonRequest(origin, 'POST', '/api/v1/operations', TOKENS.ingest, recoveredEnvelope);
  const detail = await jsonRequest(origin, 'GET', `/api/v1/operations/${operationId}`, TOKENS.reader);
  const completeness = await jsonRequest(
    origin,
    'GET',
    `/api/v1/completeness?scopeType=SHIFT&scopeId=${encodeURIComponent(envelope.scopeId)}`,
    TOKENS.reader,
  );

  const result = {
    ok: true,
    schema: 'zungun.field-service-demo.v2',
    androidOutboxPersisted: true,
    receiverProcessRestarted: true,
    receiverAccepted: acceptance.state === 'RECEIVER_ACCEPTED',
    duplicateDetected: duplicateWithReceipt.duplicate === true,
    signedReceiptReturnedToRetryingClient: Boolean(duplicateWithReceipt.receipt),
    applicationOutcome: detail.operation.application_outcome,
    evidenceKinds: detail.evidence.map((entry: any) => entry.kind),
    completeWithinDeclaredScope: completeness.completeWithinDeclaredScope,
  };
  if (!result.signedReceiptReturnedToRetryingClient ||
      result.applicationOutcome !== 'EFFECT_APPLIED' ||
      !result.completeWithinDeclaredScope) throw new Error(`DEMO_INCOMPLETE:${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  await stop(server);
  rmSync(directory, { recursive: true, force: true });
}
