import { SyncBurstService } from '../dist/pilot/worker/sync.js';

const TOKEN = 'sync-fuzz-token-0123456789abcdef0123456789abcdef';
const PAYLOAD_MARKER = 'SYNC_FUZZ_PAYLOAD_MARKER';
let seed = 0x61c0ffee;
const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };

class EmptyRepository {
  constructor() { this.cursors = new Map(); this.requests = new Map(); }
  async createOrGet(candidate) { return { record: candidate, created: true }; }
  async get() { return null; }
  async getOrCreateReceiptSigningKey() { return new Uint8Array(32); }
  async acknowledge() { return null; }
  async resolveCursor(token) { return this.cursors.get(token) ?? null; }
  async storeCursor(token, mailboxId, entrySequence) { this.cursors.set(token, { mailboxId, entrySequence }); }
  async pullPending() { return []; }
  async getDeliveriesBySequences() { return []; }
  async acknowledgeMailbox() { return { found: false, idempotent: false, conflict: false, expired: false }; }
  async getSyncRequest(mailboxId, requestId) { return this.requests.get(`${mailboxId}\0${requestId}`) ?? null; }
  async storeSyncRequest(candidate) {
    const key = `${candidate.mailboxId}\0${candidate.requestId}`;
    const existing = this.requests.get(key);
    if (existing) return { record: existing, created: false };
    this.requests.set(key, candidate);
    return { record: candidate, created: true };
  }
}

function randomValue(depth = 0) {
  const choice = next() % (depth > 2 ? 5 : 8);
  if (choice === 0) return null;
  if (choice === 1) return next() % 2 === 0;
  if (choice === 2) return (next() % 200000) - 100000;
  if (choice === 3) return String.fromCharCode(32 + (next() % 90)).repeat(next() % 20);
  if (choice === 4) return [randomValue(depth + 1), randomValue(depth + 1)];
  if (choice === 5) return { x: randomValue(depth + 1), y: randomValue(depth + 1) };
  if (choice === 6) return JSON.parse(`{"__proto__":{"polluted":true},"marker":"${PAYLOAD_MARKER}"}`);
  return {
    syncVersion: '0.1',
    requestId: `fuzz-${next()}`,
    mailboxId: 'mailbox-fuzz',
    cursor: null,
    maxResponseBytes: 65536,
    pullLimit: 0,
    outgoingMessages: [],
    ackMessages: [],
  };
}

const service = new SyncBurstService(new EmptyRepository(), TOKEN, { now: () => 1_800_000_000_000 });
const counts = new Map();
let rawNativeErrors = 0;
let reflections = 0;
let prototypePollution = 0;
for (let index = 0; index < 2048; index += 1) {
  const value = randomValue();
  const request = new Request('https://sync.invalid/v0/sync', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(value),
  });
  try {
    const response = await service.handle(request);
    counts.set(response.status, (counts.get(response.status) ?? 0) + 1);
    const text = await response.text();
    if (text.includes(TOKEN) || text.includes(PAYLOAD_MARKER)) reflections += 1;
    if (![200, 400, 413, 415, 422, 500].includes(response.status)) rawNativeErrors += 1;
  } catch { rawNativeErrors += 1; }
  if ({}.polluted !== undefined) prototypePollution += 1;
}
if (rawNativeErrors !== 0 || reflections !== 0 || prototypePollution !== 0) {
  throw new Error(`SYNC_FUZZ_FAILED:${JSON.stringify({ rawNativeErrors, reflections, prototypePollution })}`);
}
console.log(`SYNC_FUZZ_CASES=2048 RAW_NATIVE_ERRORS=0 REFLECTIONS=0 PROTOTYPE_POLLUTION=0 STATUS_COUNTS=${JSON.stringify(Object.fromEntries([...counts].sort((a, b) => a[0] - b[0])))}`);
