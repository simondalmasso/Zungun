import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/pilot/worker/index.js';
import { SyncBurstService } from '../dist/pilot/worker/sync.js';
import { cloneStored, sameImmutableMessage } from '../dist/pilot/worker/model.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'sync-test-token-0123456789abcdef0123456789abcdef';

class MemoryRepository {
  constructor() {
    this.rows = new Map();
    this.deliveries = [];
    this.cursors = new Map();
    this.requests = new Map();
    this.sequence = 0;
    this.signingKey = Uint8Array.from({ length: 32 }, (_, index) => index);
  }
  async createOrGet(candidate) {
    const existing = this.rows.get(candidate.messageId);
    let created = false;
    let record;
    if (existing) {
      if (!sameImmutableMessage(existing, candidate)) throw new Error('DUPLICATE_CONFLICT');
      record = existing;
    } else {
      record = cloneStored(candidate);
      this.rows.set(candidate.messageId, record);
      created = true;
    }
    for (const mailboxId of record.recipientIds) {
      if (!this.deliveries.some((delivery) => delivery.mailboxId === mailboxId && delivery.message.messageId === record.messageId)) {
        this.deliveries.push({ entrySequence: ++this.sequence, mailboxId, acknowledgedAtMs: null, message: record });
      }
    }
    return Object.freeze({ record: cloneStored(record), created });
  }
  async get(messageId) { const row = this.rows.get(messageId); return row ? cloneStored(row) : null; }
  async getOrCreateReceiptSigningKey() { return this.signingKey.slice(); }
  async acknowledge(messageId, commitment, at, receiptId, receiptJson) {
    const current = this.rows.get(messageId);
    if (!current) return null;
    if (current.messageCommitment !== commitment || current.status !== 'STORED' || current.expiresAtMs <= at) {
      return Object.freeze({ record: cloneStored(current), transitioned: false });
    }
    const next = cloneStored({ ...current, status: 'ACKNOWLEDGED', acknowledgedAtMs: at, processingReceiptId: receiptId, processingReceiptJson: receiptJson });
    this.rows.set(messageId, next);
    for (const delivery of this.deliveries) if (delivery.message.messageId === messageId) delivery.message = next;
    return Object.freeze({ record: cloneStored(next), transitioned: true });
  }
  async resolveCursor(token) { const value = this.cursors.get(token); return value ? { ...value } : null; }
  async storeCursor(token, mailboxId, entrySequence) {
    if (this.cursors.has(token)) throw new Error('D1_CURSOR_CREATE_FAILED');
    this.cursors.set(token, { mailboxId, entrySequence });
  }
  async pullPending(mailboxId, afterSequence, nowMs, limit) {
    return this.deliveries
      .filter((delivery) => delivery.mailboxId === mailboxId && delivery.entrySequence > afterSequence && delivery.acknowledgedAtMs === null && delivery.message.expiresAtMs > nowMs)
      .sort((left, right) => left.entrySequence - right.entrySequence)
      .slice(0, limit)
      .map((delivery) => Object.freeze({ ...delivery, message: cloneStored(delivery.message) }));
  }
  async getDeliveriesBySequences(mailboxId, sequences) {
    return this.deliveries
      .filter((delivery) => delivery.mailboxId === mailboxId && sequences.includes(delivery.entrySequence))
      .sort((left, right) => left.entrySequence - right.entrySequence)
      .map((delivery) => Object.freeze({ ...delivery, message: cloneStored(delivery.message) }));
  }
  async acknowledgeMailbox(mailboxId, messageId, commitment, at) {
    const delivery = this.deliveries.find((item) => item.mailboxId === mailboxId && item.message.messageId === messageId);
    if (!delivery) return { found: false, idempotent: false, conflict: false, expired: false };
    if (delivery.message.messageCommitment !== commitment) return { found: true, idempotent: false, conflict: true, expired: false };
    if (delivery.message.expiresAtMs <= at) return { found: true, idempotent: false, conflict: false, expired: true };
    if (delivery.acknowledgedAtMs !== null) return { found: true, idempotent: true, conflict: false, expired: false };
    delivery.acknowledgedAtMs = at;
    return { found: true, idempotent: false, conflict: false, expired: false };
  }
  async getSyncRequest(mailboxId, requestId) { return this.requests.get(`${mailboxId}\0${requestId}`) ?? null; }
  async storeSyncRequest(candidate) {
    const key = `${candidate.mailboxId}\0${candidate.requestId}`;
    const existing = this.requests.get(key);
    if (existing) {
      if (existing.requestHash !== candidate.requestHash) throw new Error('SYNC_REQUEST_CONFLICT');
      return { record: existing, created: false };
    }
    this.requests.set(key, candidate);
    return { record: candidate, created: true };
  }
}

function message(index, overrides = {}) {
  return {
    zepVersion: '0.1',
    messageId: `sync-message-${index}`,
    conversationId: 'sync-conversation',
    senderId: 'sync-sender',
    recipientIds: ['mailbox-a'],
    createdAtMs: NOW - 1000,
    expiresAtMs: NOW + 600000,
    priority: 2,
    contentType: 'application/octet-stream',
    payloadBase64: Buffer.from(`payload-${index}`).toString('base64'),
    receiptPolicy: 'END_RECIPIENT_ACK',
    messageCommitment: `commitment-${index}`,
    ...overrides,
  };
}

function envelope(requestId, overrides = {}) {
  return {
    syncVersion: '0.1',
    requestId,
    mailboxId: 'mailbox-a',
    cursor: null,
    maxResponseBytes: 65536,
    pullLimit: 64,
    outgoingMessages: [],
    ackMessages: [],
    ...overrides,
  };
}

function request(body, token = TOKEN) {
  return new Request('https://sync.invalid/v0/sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
async function json(response) { return response.json(); }
function service(repo = new MemoryRepository()) { return new SyncBurstService(repo, TOKEN, { now: () => NOW }); }

test('GET /health is public, exact and does not access D1', async () => {
  const DB = new Proxy({}, { get() { throw new Error('D1_ACCESSED'); } });
  const response = await worker.fetch(new Request('https://worker.invalid/health'), { DB, ZUNGUN_PILOT_TOKEN: TOKEN });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, service: 'zungun', version: '0.1', status: 'canary' });
});

test('sync auth, JSON, body and envelope failures map to required HTTP statuses', async () => {
  const svc = service();
  assert.equal((await svc.handle(request(envelope('unauthorized'), 'wrong-token'))).status, 401);
  assert.equal((await svc.handle(request('{'))).status, 400);
  assert.equal((await svc.handle(request(envelope('invalid', { syncVersion: '9.9' })))).status, 422);
  const oversized = new Request('https://sync.invalid/v0/sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ padding: 'A'.repeat(70000) }),
  });
  assert.equal((await svc.handle(oversized)).status, 413);
});

test('sync sends multiple messages and pulls them in stable entry sequence', async () => {
  const repo = new MemoryRepository(); const svc = service(repo);
  const response = await svc.handle(request(envelope('send-pull', { outgoingMessages: [message(1), message(2)] })));
  assert.equal(response.status, 200); const body = await json(response);
  assert.deepEqual(body.outgoingResults.map((result) => result.status), ['ACCEPTED', 'ACCEPTED']);
  assert.deepEqual(body.pendingMessages.map((item) => item.messageId), ['sync-message-1', 'sync-message-2']);
  assert.deepEqual(body.pendingMessages.map((item) => item.entrySequence), [1, 2]);
  assert.equal(body.hasMore, false); assert.match(body.nextCursor, /^sb0_[A-Za-z0-9_-]{32}$/);
});

test('cursor is opaque, mailbox-bound and advances without duplicate delivery', async () => {
  const repo = new MemoryRepository(); const svc = service(repo);
  const first = await json(await svc.handle(request(envelope('cursor-1', { outgoingMessages: [message(1)] }))));
  const second = await json(await svc.handle(request(envelope('cursor-2', { cursor: first.nextCursor }))));
  assert.equal(second.pendingMessages.length, 0);
  const wrongMailbox = envelope('cursor-wrong', { mailboxId: 'mailbox-b', cursor: first.nextCursor });
  assert.equal((await svc.handle(request(wrongMailbox))).status, 422);
});

test('sync acknowledges mailbox deliveries idempotently', async () => {
  const repo = new MemoryRepository(); const svc = service(repo);
  const first = await json(await svc.handle(request(envelope('ack-seed', { outgoingMessages: [message(1)] }))));
  const ackItem = { messageId: 'sync-message-1', messageCommitment: 'commitment-1' };
  const ack = await json(await svc.handle(request(envelope('ack-1', { cursor: first.nextCursor, ackMessages: [ackItem] }))));
  assert.equal(ack.ackResults[0].status, 'ACKNOWLEDGED'); assert.equal(ack.ackResults[0].idempotent, false);
  const retryAck = await json(await svc.handle(request(envelope('ack-2', { ackMessages: [ackItem] }))));
  assert.equal(retryAck.ackResults[0].idempotent, true);
});

test('lost-response retry replays the same cursor and creates no duplicate message or delivery', async () => {
  const repo = new MemoryRepository(); const svc = service(repo);
  const value = envelope('lost-response', { outgoingMessages: [message(1)] });
  const first = await json(await svc.handle(request(value)));
  const second = await json(await svc.handle(request(value)));
  assert.equal(second.idempotent, true); assert.equal(second.nextCursor, first.nextCursor);
  assert.deepEqual(second.pendingMessages, first.pendingMessages);
  assert.equal(repo.rows.size, 1); assert.equal(repo.deliveries.length, 1); assert.equal(repo.requests.size, 1);
});

test('serialized response byte limit stops before the next item and sets hasMore', async () => {
  const repo = new MemoryRepository(); const svc = service(repo);
  const large = message('large', { payloadBase64: Buffer.alloc(3000, 7).toString('base64') });
  await svc.handle(request(envelope('large-seed', { pullLimit: 0, outgoingMessages: [large] })));
  const limited = await svc.handle(request(envelope('large-pull', { maxResponseBytes: 700, pullLimit: 64 })));
  assert.equal(limited.status, 200); const body = await json(limited);
  assert.equal(body.pendingMessages.length, 0); assert.equal(body.hasMore, true);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 700);
});

test('partial item rejection covers malformed, expired, conflict, payload and quota cases', async () => {
  const repo = new MemoryRepository(); const svc = service(repo);
  await svc.handle(request(envelope('conflict-seed', { pullLimit: 0, outgoingMessages: [message('conflict')] })));

  const basic = await json(await svc.handle(request(envelope('rejections-basic', {
    pullLimit: 0,
    outgoingMessages: [
      null,
      message('expired', { expiresAtMs: NOW }),
      message('conflict', { payloadBase64: Buffer.from('different').toString('base64') }),
    ],
  }))));
  assert.equal(basic.outgoingResults[0].error.code, 'MALFORMED_ITEM');
  assert.equal(basic.outgoingResults[1].error.code, 'EXPIRED');
  assert.equal(basic.outgoingResults[2].error.code, 'DUPLICATE_CONFLICT');

  const tooLarge = await json(await svc.handle(request(envelope('rejections-large', {
    pullLimit: 0,
    outgoingMessages: [message('too-large', { payloadBase64: Buffer.alloc(48001).toString('base64') })],
  }))));
  assert.equal(tooLarge.outgoingResults[0].error.code, 'PAYLOAD_TOO_LARGE');

  const quotaItems = Array.from({ length: 17 }, (_, index) => message(`quota-${index}`));
  const quota = await json(await svc.handle(request(envelope('rejections-quota', { pullLimit: 0, outgoingMessages: quotaItems }))));
  assert.equal(quota.outgoingResults[16].error.code, 'QUOTA_EXCEEDED');
});
