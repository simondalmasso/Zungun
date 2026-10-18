import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createReceiverServer } from '../services/receiver/src/server.js';
import { makeEnvelope } from './helpers.js';
import { appendWitnessEvidence, verifyIncidentProofBundle, type WitnessEvidence } from '../packages/protocol-core/src/witness.js';

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
  assert.equal(ready.database.migrationCount, 5);
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


test('Witness HTTP routes enforce separate least-privilege roles and return receiver durability', async () => withServer(async (origin) => {
  const now = Date.now();
  const envelope = makeEnvelope({
    operationId: 'op_server_witness_080',
    idempotencyKey: 'idem_server_witness_080',
    replayNonce: 'nonce_server_witness_080',
    messageId: 'msg_server_witness_080',
    workOrderId: 'WO-WITNESS-080',
    policy: { ...makeEnvelope().policy, createdAtMs: now - 1_000, expiresAtMs: now + 3_600_000 },
  });
  assert.equal((await fetch(`${origin}/api/v1/operations`, { method:'POST', headers:headers(TOKENS.ingest), body:JSON.stringify(envelope) })).status, 202);
  const chain: WitnessEvidence[]=[];
  const add=(input: Parameters<typeof appendWitnessEvidence>[1])=>chain.push(appendWitnessEvidence(chain,input));
  add({incidentId:envelope.operationId,evidenceId:'http-detected',state:'DETECTED',evidenceClass:'OBSERVED_FACT',emitterId:'sensor:http',authorizationScope:'witness:source',observedAtMs:now,monotonicMs:1,provenance:'server-test',reasonCode:'HTTP_DETECTED',claims:{boundaryRole:'SENSOR_OR_SOURCE',sourceId:'sensor:http'}});
  add({incidentId:envelope.operationId,evidenceId:'http-local',state:'COMMITTED_LOCAL',evidenceClass:'MACHINE_ASSERTION',emitterId:'device:http',authorizationScope:'witness:local',observedAtMs:now+1,monotonicMs:2,provenance:'server-test',reasonCode:'LOCAL_DURABLE_COMMIT',claims:{boundaryRole:'ZUNGUN_WITNESS',localCommitRef:'room:http'}});
  add({incidentId:envelope.operationId,evidenceId:'http-custody',state:'CUSTODY_ACCEPTED',evidenceClass:'MACHINE_ASSERTION',emitterId:'transport:http',authorizationScope:'witness:transport',observedAtMs:now+2,monotonicMs:3,provenance:'server-test',reasonCode:'HTTP_CUSTODY',claims:{boundaryRole:'TRANSPORT',transportKind:'HTTP_WEBHOOK',routeId:'route:http',custodyRef:'http:accepted'}});
  assert.equal((await fetch(`${origin}/api/v1/operations/${envelope.operationId}/witness/ingest`, {method:'POST',headers:headers(TOKENS.reader),body:JSON.stringify({chain,nowMs:now+3})})).status,403);
  const ingested=await fetch(`${origin}/api/v1/operations/${envelope.operationId}/witness/ingest`, {method:'POST',headers:headers(TOKENS.ingest),body:JSON.stringify({chain,nowMs:now+3})});
  assert.equal(ingested.status,202);
  const ingestedBody=await ingested.json() as any;
  assert.equal(ingestedBody.chain.at(-1).state,'DELIVERED_DURABLY');
  const read=await fetch(`${origin}/api/v1/operations/${envelope.operationId}/witness`, {headers:headers(TOKENS.reader)});
  assert.equal(read.status,200);
  const readBody=await read.json() as any;
  assert.equal(readBody.chain.length,4);
  const ownership={incidentId:envelope.operationId,evidenceId:'http-owned',state:'OWNED_BY_RESPONDER',evidenceClass:'HUMAN_ATTESTATION',emitterId:'responder:http',authorizationScope:'witness:attest',observedAtMs:now+4,monotonicMs:5,provenance:'server-test',reasonCode:'RESPONDER_OWNED',claims:{boundaryRole:'RESPONDER',responderId:'worker',ownershipRef:'ack:http'}};
  assert.equal((await fetch(`${origin}/api/v1/operations/${envelope.operationId}/witness/attest`, {method:'POST',headers:headers(TOKENS.admin),body:JSON.stringify({evidence:ownership,nowMs:now+4})})).status,403);
  assert.equal((await fetch(`${origin}/api/v1/operations/${envelope.operationId}/witness/attest`, {method:'POST',headers:headers(TOKENS.worker),body:JSON.stringify({evidence:ownership,nowMs:now+4})})).status,201);
  const reconciliation=await fetch(`${origin}/api/v1/operations/${envelope.operationId}/witness/reconcile`, {method:'POST',headers:headers(TOKENS.reviewer),body:JSON.stringify({senderChain:chain})});
  assert.equal(reconciliation.status,200);
  assert.equal((await reconciliation.json() as any).code,'RECEIVER_DURABLE_EVIDENCE_RECOVERED');
  const bundleResponse=await fetch(`${origin}/api/v1/operations/${envelope.operationId}/witness/bundle`, {headers:headers(TOKENS.reader)});
  assert.equal(bundleResponse.status,200);
  assert.equal(verifyIncidentProofBundle(await bundleResponse.json() as any).ok,true);
}));
