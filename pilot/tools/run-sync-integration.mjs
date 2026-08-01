import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const root = process.cwd();
const wrangler = path.join(root, 'node_modules', '.bin', 'wrangler');
const persist = path.join(root, '.wrangler-sync-integration');
const varsPath = path.join(root, '.dev.vars');
const token = `sync_${randomBytes(32).toString('hex')}`;
const port = 8792;
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_D1_WARNING: 'true' };
const redact = (value) => String(value).split(token).join('[REDACTED]');

function run(args) {
  const result = spawnSync(wrangler, args, { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`WRANGLER_FAILED:${args.join(' ')}\n${redact(result.stdout)}\n${redact(result.stderr)}`);
  return result.stdout;
}
function authenticated(pathname, init = {}) {
  return fetch(`${base}${pathname}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
}
async function jsonResponse(response, expected) {
  const text = await response.text();
  if (response.status !== expected) throw new Error(`HTTP_${response.status}_EXPECTED_${expected}:${redact(text)}`);
  return JSON.parse(text);
}
async function waitReady(child) {
  for (let index = 0; index < 100; index += 1) {
    if (child.exitCode !== null) throw new Error(`WRANGLER_DEV_EXITED:${child.exitCode}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.status === 200) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('WRANGLER_DEV_NOT_READY');
}
async function start() {
  const output = [];
  const child = spawn(wrangler, ['dev', '--local', '--port', String(port), '--persist-to', persist, '--config', 'wrangler.jsonc', '--log-level', 'error'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  try { await waitReady(child); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}\n${redact(output.join(''))}`); }
  return { child, output };
}
async function stop(runtime) {
  if (runtime.child.exitCode === null) runtime.child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => runtime.child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (runtime.child.exitCode === null) runtime.child.kill('SIGKILL');
}
function parseWranglerJson(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* find JSON */ }
  const start = Math.min(...['[', '{'].map((character) => {
    const index = trimmed.indexOf(character);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!Number.isFinite(start)) throw new Error(`D1_JSON_NOT_FOUND:${redact(trimmed)}`);
  return JSON.parse(trimmed.slice(start));
}
function message(index, now, overrides = {}) {
  return {
    zepVersion: '0.1',
    messageId: `sync-d1-message-${index}`,
    conversationId: 'sync-d1-conversation',
    senderId: 'sync-d1-sender',
    recipientIds: ['sync-d1-mailbox'],
    createdAtMs: now - 1000,
    expiresAtMs: now + 600000,
    priority: 2,
    contentType: 'application/octet-stream',
    payloadBase64: Buffer.from(`sync-payload-${index}`).toString('base64'),
    receiptPolicy: 'END_RECIPIENT_ACK',
    messageCommitment: `sync-d1-commitment-${index}`,
    ...overrides,
  };
}
function envelope(requestId, overrides = {}) {
  return {
    syncVersion: '0.1',
    requestId,
    mailboxId: 'sync-d1-mailbox',
    cursor: null,
    maxResponseBytes: 65536,
    pullLimit: 64,
    outgoingMessages: [],
    ackMessages: [],
    ...overrides,
  };
}
async function sync(body, expected = 200) {
  return jsonResponse(await authenticated('/v0/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), expected);
}

fs.rmSync(persist, { recursive: true, force: true });
fs.writeFileSync(varsPath, `ZUNGUN_PILOT_TOKEN=${token}\n`, { mode: 0o600 });
let runtime;
try {
  run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist, '--config', 'wrangler.jsonc']);
  run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist, '--config', 'wrangler.jsonc']);
  runtime = await start();

  const health = await jsonResponse(await fetch(`${base}/health`), 200);
  if (JSON.stringify(health) !== JSON.stringify({ ok: true, service: 'zungun', version: '0.1', status: 'canary' })) throw new Error('HEALTH_INVALID');
  await jsonResponse(await fetch(`${base}/v0/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), 401);

  const now = Date.now();
  const lostEnvelope = envelope('sync-d1-lost-response', { outgoingMessages: [message(1, now), message(2, now)] });
  const first = await sync(lostEnvelope);
  if (first.outgoingResults.length !== 2 || first.pendingMessages.length !== 2 || first.hasMore !== false) throw new Error('SYNC_SEND_PULL_INVALID');
  if (first.pendingMessages[0].entrySequence >= first.pendingMessages[1].entrySequence) throw new Error('SYNC_ORDER_INVALID');
  const retry = await sync(lostEnvelope);
  if (retry.idempotent !== true || retry.nextCursor !== first.nextCursor || JSON.stringify(retry.pendingMessages) !== JSON.stringify(first.pendingMessages)) throw new Error('SYNC_LOST_RESPONSE_RETRY_INVALID');

  const noDuplicate = await sync(envelope('sync-d1-cursor', { cursor: first.nextCursor }));
  if (noDuplicate.pendingMessages.length !== 0) throw new Error('SYNC_CURSOR_DUPLICATE');

  const ackItem = { messageId: 'sync-d1-message-1', messageCommitment: 'sync-d1-commitment-1' };
  const ack = await sync(envelope('sync-d1-ack', { cursor: first.nextCursor, ackMessages: [ackItem] }));
  if (ack.ackResults[0]?.status !== 'ACKNOWLEDGED' || ack.ackResults[0]?.idempotent !== false) throw new Error('SYNC_ACK_INVALID');
  const ackRetry = await sync(envelope('sync-d1-ack-retry', { ackMessages: [ackItem] }));
  if (ackRetry.ackResults[0]?.idempotent !== true) throw new Error('SYNC_ACK_IDEMPOTENCY_INVALID');

  const conflict = await sync(envelope('sync-d1-conflict', {
    pullLimit: 0,
    outgoingMessages: [message(1, now, { payloadBase64: Buffer.from('different').toString('base64') })],
  }));
  if (conflict.outgoingResults[0]?.error?.code !== 'DUPLICATE_CONFLICT') throw new Error('SYNC_CONFLICT_INVALID');
  const expired = await sync(envelope('sync-d1-expired', {
    pullLimit: 0,
    outgoingMessages: [message('expired', now, { expiresAtMs: now })],
  }));
  if (expired.outgoingResults[0]?.error?.code !== 'EXPIRED') throw new Error('SYNC_EXPIRED_INVALID');

  const largeMessage = message('large', now, { payloadBase64: Buffer.alloc(3000, 7).toString('base64') });
  await sync(envelope('sync-d1-large-seed', { pullLimit: 0, outgoingMessages: [largeMessage] }));
  const limitedResponse = await authenticated('/v0/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope('sync-d1-large-pull', { maxResponseBytes: 700, pullLimit: 64 })),
  });
  const limitedText = await limitedResponse.text();
  if (limitedResponse.status !== 200 || Buffer.byteLength(limitedText) > 700) throw new Error('SYNC_RESPONSE_LIMIT_INVALID');
  const limited = JSON.parse(limitedText);
  if (limited.pendingMessages.length !== 0 || limited.hasMore !== true) throw new Error('SYNC_HAS_MORE_INVALID');

  const legacyInput = message('legacy', now, { messageId: 'sync-d1-legacy', messageCommitment: 'sync-d1-legacy-commitment' });
  const legacyCreate = await jsonResponse(await authenticated('/v0/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(legacyInput) }), 201);
  if (legacyCreate.result.status !== 'STORED') throw new Error('LEGACY_CREATE_INVALID');
  const legacyGet = await jsonResponse(await authenticated('/v0/messages/sync-d1-legacy'), 200);
  if (legacyGet.result.status !== 'STORED') throw new Error('LEGACY_GET_INVALID');
  const legacyAck = await jsonResponse(await authenticated('/v0/messages/sync-d1-legacy/ack', { method: 'POST' }), 200);
  if (legacyAck.result.status !== 'ACKNOWLEDGED') throw new Error('LEGACY_ACK_INVALID');

  await stop(runtime); runtime = undefined;
  const query = run(['d1', 'execute', 'DB', '--local', '--persist-to', persist, '--config', 'wrangler.jsonc', '--command', "SELECT (SELECT COUNT(*) FROM messages) AS messages_count, (SELECT COUNT(*) FROM mailbox_deliveries) AS deliveries_count, (SELECT COUNT(*) FROM sync_requests) AS requests_count, (SELECT COUNT(*) FROM sync_cursors) AS cursors_count", '--json']);
  const parsed = parseWranglerJson(query); const result = Array.isArray(parsed) ? parsed[0] : parsed; const row = result?.results?.[0];
  if (!row || row.messages_count < 4 || row.deliveries_count !== row.messages_count || row.requests_count < 8 || row.cursors_count < row.requests_count) throw new Error(`D1_SYNC_PERSISTENCE_INVALID:${redact(JSON.stringify(row))}`);

  runtime = await start();
  const recovered = await sync(lostEnvelope);
  if (recovered.idempotent !== true || recovered.nextCursor !== first.nextCursor || JSON.stringify(recovered.pendingMessages) !== JSON.stringify(first.pendingMessages)) throw new Error('SYNC_RESTART_RECOVERY_INVALID');
  await stop(runtime); runtime = undefined;

  console.log(JSON.stringify({
    ok: true,
    migrationsAppliedTwice: true,
    healthPublic: true,
    syncSendMultiple: true,
    syncPull: true,
    syncAck: true,
    syncCursor: true,
    syncMaxResponseBytes: true,
    syncHasMore: true,
    lostResponseRetry: true,
    noDuplicate: true,
    duplicateConflict: true,
    expiredFilter: true,
    unauthorized: true,
    legacyRegression: true,
    restartRecovery: true,
    payloadDuplicated: false,
    cloudflareWrite: 0,
  }));
} finally {
  if (runtime) await stop(runtime).catch(() => undefined);
  fs.rmSync(varsPath, { force: true });
}
