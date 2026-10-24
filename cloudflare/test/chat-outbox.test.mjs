import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/chat/outbox.js';

const { createStore, isRetryableError } = globalThis.ZungunOutbox;

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function record(overrides = {}) {
  return {
    userId: 'usr_one',
    conversationId: 'conv_one',
    messageId: 'msg_stable_001',
    body: 'Mensaje que debe sobrevivir al corte',
    clientCreatedAtMs: Date.now(),
    queuedAtMs: Date.now(),
    state: 'QUEUED',
    ...overrides,
  };
}

test('outbox persists queued messages and scopes them by user and conversation', () => {
  const storage = memoryStorage();
  const first = createStore(storage);
  first.enqueue(record());
  first.enqueue(record());

  const afterReload = createStore(storage);
  assert.equal(afterReload.list('usr_one', 'conv_one').length, 1);
  assert.equal(afterReload.list('usr_one', 'conv_other').length, 0);
  assert.equal(afterReload.list('usr_two', 'conv_one').length, 0);
  assert.equal(afterReload.pending('usr_one').length, 1);
});

test('outbox preserves stable message IDs and removes a confirmed message', () => {
  const store = createStore(memoryStorage());
  store.enqueue(record());
  assert.equal(store.list('usr_one')[0].messageId, 'msg_stable_001');
  assert.equal(store.remove('msg_stable_001', 'usr_two'), false);
  assert.equal(store.remove('msg_stable_001', 'usr_one'), true);
  assert.equal(store.list('usr_one').length, 0);
});

test('permanent failures remain visible but are not automatically retried', () => {
  const store = createStore(memoryStorage());
  store.enqueue(record());
  store.mark('msg_stable_001', 'usr_one', 'FAILED', 'FORBIDDEN');
  assert.equal(store.list('usr_one')[0].state, 'FAILED');
  assert.equal(store.pending('usr_one').length, 0);
});

test('network, rate-limit, timeout and server errors are retryable; other client errors are not', () => {
  assert.equal(isRetryableError(new TypeError('Failed to fetch')), true);
  assert.equal(isRetryableError({ status: 408 }), true);
  assert.equal(isRetryableError({ status: 429 }), true);
  assert.equal(isRetryableError({ status: 503 }), true);
  assert.equal(isRetryableError({ status: 403 }), false);
  assert.equal(isRetryableError({ status: 400 }), false);
});
