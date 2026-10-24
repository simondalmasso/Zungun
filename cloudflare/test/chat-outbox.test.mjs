import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../public/chat/outbox.js';

const {
  createStore,
  isRetryableError,
  canSendInternet,
  canUseInternetApi,
  connectionStatusForMode,
  readTransportMode,
  persistTransportMode,
} = globalThis.ZungunOutbox;
const appSource = readFileSync(new URL('../public/chat/app.js', import.meta.url), 'utf8');

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

test('scheduled retries wait for their backoff window', () => {
  const store = createStore(memoryStorage());
  store.enqueue(record());
  store.mark('msg_stable_001', 'usr_one', 'SENDING');
  store.mark('msg_stable_001', 'usr_one', 'QUEUED', 'NETWORK_ERROR', Date.now() + 60_000);
  assert.equal(store.list('usr_one').length, 1);
  assert.equal(store.pending('usr_one').length, 0);
  store.mark('msg_stable_001', 'usr_one', 'QUEUED');
  assert.equal(store.pending('usr_one').length, 1);
});

test('satellite-only messages never enter the Internet retry queue', () => {
  const store = createStore(memoryStorage());
  store.enqueue(record({ messageId: 'msg_satellite_001', transport: 'SATELLITE_ONLY' }));
  store.enqueue(record({ messageId: 'msg_internet_001', transport: 'INTERNET' }));
  assert.deepEqual(store.pending('usr_one', 'INTERNET').map(item => item.messageId), ['msg_internet_001']);
  assert.deepEqual(store.pending('usr_one', 'SATELLITE_ONLY').map(item => item.messageId), ['msg_satellite_001']);
  assert.equal(store.list('usr_one').find(item => item.messageId === 'msg_satellite_001').state, 'QUEUED');
});

test('legacy outbox records without a transport remain Internet records', () => {
  const storage = memoryStorage();
  storage.setItem('zungun-chat-outbox-v1', JSON.stringify([record()]));
  const store = createStore(storage);
  assert.equal(store.pending('usr_one', 'INTERNET').length, 1);
  assert.equal(store.pending('usr_one', 'SATELLITE_ONLY').length, 0);
});

test('Internet sending is fail-closed while satellite-only mode is selected', () => {
  assert.equal(typeof canSendInternet, 'function', 'the transport guard must exist');
  assert.equal(canSendInternet('SATELLITE_ONLY', true, 'INTERNET'), false);
  assert.equal(canSendInternet('SATELLITE_ONLY', true, 'SATELLITE_ONLY'), false);
  assert.equal(canSendInternet('INTERNET', true, 'INTERNET'), true);
  assert.equal(canSendInternet('INTERNET', true, 'SATELLITE_ONLY'), false);
  assert.equal(canSendInternet('INTERNET', false, 'INTERNET'), false);
  assert.equal(canSendInternet('UNKNOWN', true, 'INTERNET'), false);
  assert.equal(canSendInternet('INTERNET', true), true, 'legacy records default to Internet');
});

test('a successful Internet API response cannot make satellite-only mode look connected', () => {
  assert.equal(typeof connectionStatusForMode, 'function', 'connection status must be mode-aware');
  const strictStatus = {
    label: 'Modo satelital exclusivo · tráfico de chat terrestre bloqueado',
    connected: false,
  };
  assert.deepEqual(connectionStatusForMode('SATELLITE_ONLY', 'Conectado', true), strictStatus);
  assert.deepEqual(connectionStatusForMode('SATELLITE_ONLY', 'Sin conexión', false), strictStatus);
  assert.deepEqual(connectionStatusForMode('SATELLITE_ONLY', 'Reconectando', false), strictStatus);
  assert.deepEqual(connectionStatusForMode('INTERNET', 'Conectado', true), {
    label: 'Conectado',
    connected: true,
  });
  assert.deepEqual(connectionStatusForMode('UNKNOWN', 'Conectado', true), {
    label: 'Transporte no verificado',
    connected: false,
  });
});

test('the selected transport mode must be persisted and verified before changing modes', () => {
  assert.equal(typeof readTransportMode, 'function', 'transport mode reader must exist');
  assert.equal(typeof persistTransportMode, 'function', 'transport mode persistence guard must exist');
  const root = { localStorage: memoryStorage() };
  assert.equal(readTransportMode(root), 'INTERNET');
  assert.equal(persistTransportMode(root, 'SATELLITE_ONLY'), true);
  assert.equal(readTransportMode(root), 'SATELLITE_ONLY');
  assert.equal(persistTransportMode(root, 'INTERNET'), true);
  assert.equal(readTransportMode(root), 'INTERNET');

  const storageThatSilentlyDropsWrites = {
    getItem() { return null; },
    setItem() {},
  };
  assert.equal(persistTransportMode({ localStorage: storageThatSilentlyDropsWrites }, 'SATELLITE_ONLY'), false);
});

test('outbox draining re-checks exclusive mode before starting every HTTP send', () => {
  const start = appSource.indexOf('async function drainOutbox()');
  const end = appSource.indexOf('async function poll(', start);
  assert.ok(start >= 0 && end > start, 'outbox drain function must be present');
  const drain = appSource.slice(start, end);
  assert.match(
    drain,
    /for\(const item of state\.outbox\.pending\(state\.me\.userId,'INTERNET'\)\)\{[\s\S]*?if\(!window\.ZungunOutbox\.canSendInternet\(state\.transportMode,navigator\.onLine,item\.transport\)\)break;[\s\S]*?state\.outbox\.mark/
  );
});

test('connection updates and mode toggles are routed through the guarded helpers', () => {
  assert.match(appSource, /connectionStatusForMode\(state\.transportMode,label,connected\)/);
  assert.match(appSource, /if\(!window\.ZungunOutbox\.persistTransportMode\(window,next\)\)/);
});


test('satellite-only mode disables every Internet API call, polling and WebSocket reconnect', () => {
  assert.equal(typeof canUseInternetApi, 'function');
  assert.equal(canUseInternetApi('SATELLITE_ONLY'), false);
  assert.equal(canUseInternetApi('UNKNOWN'), false);
  assert.equal(canUseInternetApi('INTERNET'), true);
  assert.match(appSource, /if\(!window\.ZungunOutbox\.canUseInternetApi\(state\.transportMode\)\)[\s\S]{0,150}TRANSPORT_DISABLED/);
  assert.match(appSource, /async function poll\(initial=false\)\{\s*const current=state\.current;if\(!current\|\|!window\.ZungunOutbox\.canUseInternetApi\(state\.transportMode\)\)return/);
  assert.match(appSource, /function connectSocket\(\)\{\s*if\(!state\.current\|\|!navigator\.onLine\|\|!window\.ZungunOutbox\.canUseInternetApi\(state\.transportMode\)\)return/);
  assert.match(appSource, /state\.transportMode==='INTERNET'&&state\.current\?\.conversationId===conversationId\)state\.retry=setTimeout\(connectSocket,3000\)/);
  assert.match(appSource, /for\(const request of state\.activeRequests\)request\.abort\(\)/);
  assert.match(appSource, /if\(state\.transportMode==='INTERNET'&&'serviceWorker'in navigator/);
  assert.match(appSource, /if\(state\.transportMode!=='INTERNET'\|\|state\.current\?\.conversationId!==current\.conversationId\)return/);
  assert.match(appSource, /state\.transportMode!=='INTERNET'\)return;if\(state\.current\)poll\(false\)/);
  assert.match(appSource, /socket\.onmessage=event=>\{if\(state\.transportMode!=='INTERNET'\|\|event\.data==='pong'\)return/);
  assert.match(appSource, /const controller=new AbortController\(\);state\.activeRequests\.add\(controller\);[\s\S]*?const response=await fetch\([\s\S]*?let data=\{\};try\{data=await response\.json\(\)\}catch\{\}[\s\S]*?if\(!window\.ZungunOutbox\.canUseInternetApi\(state\.transportMode\)\)/);
  assert.match(appSource, /setConnection\('Conectado',true\);return data;[\s\S]*?finally\{state\.activeRequests\.delete\(controller\)\}/);
});
