import test from 'node:test';
import assert from 'node:assert/strict';
import { PilotService } from '../dist/pilot/worker/service.js';
import { cloneStored, sameImmutableMessage } from '../dist/pilot/worker/model.js';
import { issueProcessingReceipt, verifyProcessingReceipt } from '../dist/pilot/worker/receipt.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'pilot-test-token-0123456789abcdef0123456789abcdef';

class MemoryRepository {
  constructor(seed) { this.rows = seed ?? new Map(); this.signingKey = Uint8Array.from({ length: 32 }, (_, index) => index); }
  async createOrGet(candidate) {
    const existing = this.rows.get(candidate.messageId);
    if (existing) {
      if (!sameImmutableMessage(existing, candidate)) throw new Error('DUPLICATE_CONFLICT');
      return Object.freeze({ record: cloneStored(existing), created: false });
    }
    const stored = cloneStored(candidate);
    this.rows.set(candidate.messageId, stored);
    return Object.freeze({ record: cloneStored(stored), created: true });
  }
  async get(messageId) { const value = this.rows.get(messageId); return value ? cloneStored(value) : null; }
  async getOrCreateReceiptSigningKey() { return this.signingKey.slice(); }
  async acknowledge(messageId, commitment, at, receiptId, receiptJson) {
    const current = this.rows.get(messageId);
    if (!current) return null;
    if (current.messageCommitment !== commitment || current.status !== 'STORED' || current.expiresAtMs <= at) {
      return Object.freeze({ record: cloneStored(current), transitioned: false });
    }
    const next = cloneStored({ ...current, status: 'ACKNOWLEDGED', acknowledgedAtMs: at, processingReceiptId: receiptId, processingReceiptJson: receiptJson });
    this.rows.set(messageId, next);
    return Object.freeze({ record: cloneStored(next), transitioned: true });
  }
}

function input(overrides = {}) {
  return {
    zepVersion: '0.1', messageId: 'msg-pilot-001', conversationId: 'conv-pilot-001',
    senderId: 'sender-pilot-001', recipientIds: ['recipient-pilot-001'],
    createdAtMs: NOW - 1000, expiresAtMs: NOW + 60000, priority: 2,
    contentType: 'application/octet-stream', payloadBase64: 'AAEC/f7/',
    receiptPolicy: 'END_RECIPIENT_ACK', messageCommitment: 'commitment-pilot-001',
    ...overrides,
  };
}
function auth(value = TOKEN) { return { authorization: `Bearer ${value}` }; }
function request(path, { method = 'GET', body, token = TOKEN, headers = {} } = {}) {
  const init = { method, headers: { ...auth(token), ...headers } };
  if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  return new Request(`https://pilot.invalid${path}`, init);
}
async function json(response) { return await response.json(); }
function service(repo = new MemoryRepository(), options = {}) { return new PilotService(repo, TOKEN, { now: () => NOW, ...options }); }

async function create(svc, value = input()) { return svc.handle(request('/v0/messages', { method: 'POST', body: value })); }

for (const [name, header] of [['missing', null], ['invalid', 'Bearer wrong-token-that-is-long-enough-000000']]) {
  test(`authentication ${name} is rejected`, async () => {
    const req = new Request('https://pilot.invalid/v0/messages/missing', { headers: header === null ? {} : { authorization: header } });
    const res = await service().handle(req); assert.equal(res.status, 401); assert.equal((await json(res)).error.code, 'UNAUTHORIZED');
  });
}

test('valid create persists safe metadata without payload reflection', async () => {
  const repo = new MemoryRepository(); const svc = service(repo); const res = await create(svc);
  assert.equal(res.status, 201); const body = await json(res); assert.equal(body.result.status, 'STORED');
  const text = JSON.stringify(body); assert.equal(text.includes('AAEC/f7/'), false); assert.equal(text.includes(TOKEN), false);
  const stored = await repo.get('msg-pilot-001'); assert.deepEqual([...stored.payload], [0,1,2,253,254,255]);
});

test('valid query returns metadata and no payload', async () => {
  const svc = service(); await create(svc); const res = await svc.handle(request('/v0/messages/msg-pilot-001'));
  assert.equal(res.status, 200); const body = await json(res); assert.equal(body.result.messageCommitment, 'commitment-pilot-001');
  assert.equal(Object.hasOwn(body.result, 'payload'), false);
});

test('valid acknowledge persists and returns an authenticated receipt', async () => {
  const repo = new MemoryRepository(); const svc = service(repo); await create(svc);
  const res = await svc.handle(request('/v0/messages/msg-pilot-001/ack', { method: 'POST' })); assert.equal(res.status, 200);
  const body = await json(res); assert.equal(body.result.status, 'ACKNOWLEDGED');
  const receipt = body.result.processingReceipt; assert.equal(receipt.messageId, 'msg-pilot-001');
  assert.equal(receipt.messageCommitment, 'commitment-pilot-001');
  await verifyProcessingReceipt(receipt, repo.signingKey, { messageId: receipt.messageId, messageCommitment: receipt.messageCommitment });
});

test('exact create duplicate is idempotent and preserves state', async () => {
  const svc = service(); assert.equal((await create(svc)).status, 201); const duplicate = await create(svc);
  assert.equal(duplicate.status, 200); assert.equal((await json(duplicate)).idempotent, true);
});

test('conflicting duplicate is rejected even when commitment is reused', async () => {
  const svc = service(); await create(svc); const conflict = await create(svc, input({ payloadBase64: 'AQID' }));
  assert.equal(conflict.status, 409); assert.equal((await json(conflict)).error.code, 'DUPLICATE_CONFLICT');
});

test('ack is idempotent and returns the same authoritative receipt', async () => {
  const svc = service(); await create(svc); const first = await json(await svc.handle(request('/v0/messages/msg-pilot-001/ack', { method: 'POST' })));
  const second = await json(await svc.handle(request('/v0/messages/msg-pilot-001/ack', { method: 'POST' })));
  assert.equal(second.idempotent, true); assert.deepEqual(second.result.processingReceipt, first.result.processingReceipt);
});

test('two simultaneous acknowledgements converge on one receipt', async () => {
  const svc = service(); await create(svc);
  const [a,b] = await Promise.all([
    svc.handle(request('/v0/messages/msg-pilot-001/ack', { method: 'POST' })),
    svc.handle(request('/v0/messages/msg-pilot-001/ack', { method: 'POST' })),
  ]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const [ja,jb] = await Promise.all([json(a),json(b)]); assert.deepEqual(ja.result.processingReceipt, jb.result.processingReceipt);
});

test('missing query and missing ack return 404', async () => {
  const svc = service(); assert.equal((await svc.handle(request('/v0/messages/nope'))).status, 404);
  assert.equal((await svc.handle(request('/v0/messages/nope/ack', { method: 'POST' }))).status, 404);
});

test('expired create and expired ack are rejected', async () => {
  const svc = service(); assert.equal((await create(svc, input({ expiresAtMs: NOW }))).status, 410);
  let now = NOW; const repo = new MemoryRepository(); const moving = new PilotService(repo, TOKEN, { now: () => now });
  await moving.handle(request('/v0/messages', { method: 'POST', body: input({ expiresAtMs: NOW + 1 }) })); now += 1;
  assert.equal((await moving.handle(request('/v0/messages/msg-pilot-001/ack', { method: 'POST' }))).status, 410);
});

test('future creation timestamp is rejected before persistence', async () => {
  const res = await create(service(), input({ messageId:'msg-future', createdAtMs:NOW+1, expiresAtMs:NOW+60000 }));
  assert.equal(res.status, 422); assert.equal((await json(res)).error.code, 'INVALID_TIMESTAMP');
});

test('payload limit passes and one byte over fails', async () => {
  const limit = Buffer.alloc(48000).toString('base64'); const over = Buffer.alloc(48001).toString('base64');
  assert.equal((await create(service(), input({ payloadBase64: limit }))).status, 201);
  assert.equal((await create(service(), input({ messageId: 'msg-over', payloadBase64: over }))).status, 413);
});

test('malformed JSON and UTF-8 are normalized', async () => {
  const svc = service();
  const malformed = new Request('https://pilot.invalid/v0/messages', { method:'POST', headers:{...auth(),'content-type':'application/json'}, body:'{' });
  assert.equal((await svc.handle(malformed)).status, 400);
  const invalidUtf8 = new Request('https://pilot.invalid/v0/messages', { method:'POST', headers:{...auth(),'content-type':'application/json'}, body:Uint8Array.of(0xff,0xfe) });
  assert.equal((await svc.handle(invalidUtf8)).status, 400);
});

test('unknown fields and __proto__ are rejected without pollution', async () => {
  const svc = service(); assert.equal((await create(svc, { ...input(), unknown: 'x' })).status, 400);
  const raw = JSON.stringify(input()).replace(/}$/, ',"__proto__":{"polluted":true}}');
  const res = await svc.handle(request('/v0/messages', { method:'POST', body:raw })); assert.equal(res.status, 400);
  assert.equal({}.polluted, undefined);
});

test('token and payload are never reflected on internal failure', async () => {
  const processor = { async process(){ throw new Error(`${TOKEN}:AAEC/f7/`); } };
  const svc = service(new MemoryRepository(), { processor }); await create(svc);
  const res = await svc.handle(request('/v0/messages/msg-pilot-001/ack', { method:'POST' }));
  const text = await res.text(); assert.equal(res.status, 500); assert.equal(text.includes(TOKEN), false); assert.equal(text.includes('AAEC/f7/'), false);
});

test('restart with the same repository preserves authoritative state', async () => {
  const rows = new Map(); const first = service(new MemoryRepository(rows)); await create(first); await first.handle(request('/v0/messages/msg-pilot-001/ack', { method:'POST' }));
  const second = service(new MemoryRepository(rows)); const res = await second.handle(request('/v0/messages/msg-pilot-001'));
  assert.equal(res.status, 200); assert.equal((await json(res)).result.status, 'ACKNOWLEDGED');
});

test('receipt is not emitted or persisted when processing fails', async () => {
  const repo = new MemoryRepository(); const svc = service(repo, { processor: { async process(){ throw new Error('fail'); } } }); await create(svc);
  assert.equal((await svc.handle(request('/v0/messages/msg-pilot-001/ack', { method:'POST' }))).status, 500);
  const stored = await repo.get('msg-pilot-001'); assert.equal(stored.status, 'STORED'); assert.equal(stored.processingReceiptId, null);
});

test('fabricated or modified receipt is unverifiable', async () => {
  const record = { messageId:'m', messageCommitment:'c' }; const key = Uint8Array.from({ length:32 },(_,i)=>i); const issued = await issueProcessingReceipt(record, NOW, key);
  await assert.rejects(() => verifyProcessingReceipt({ ...issued, receiptId:'zpr0_fabricated' }, key, record), /INVALID_PROCESSING_RECEIPT/);
  await assert.rejects(() => verifyProcessingReceipt(issued, Uint8Array.from({ length:32 },()=>9), record), /INVALID_PROCESSING_RECEIPT/);
});

test('canonical HMAC identities do not collide on delimiter-like identifiers', async () => {
  const key = Uint8Array.from({ length:32 },(_,i)=>i);
  const a = await issueProcessingReceipt({ messageId:'a:b', messageCommitment:'c' }, NOW, key);
  const b = await issueProcessingReceipt({ messageId:'a', messageCommitment:'b:c' }, NOW, key);
  assert.notEqual(a.receiptId, b.receiptId);
});

test('receipt verification is bound to the exact commitment', async () => {
  const key = Uint8Array.from({ length:32 },(_,i)=>i); const record = { messageId:'m', messageCommitment:'c1' }; const issued = await issueProcessingReceipt(record, NOW, key);
  await assert.rejects(() => verifyProcessingReceipt(issued, key, { messageId:'m', messageCommitment:'c2' }), /INVALID_PROCESSING_RECEIPT/);
});
