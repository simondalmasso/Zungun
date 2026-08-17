import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReceiverServer } from '../services/receiver/src/server.js';

const knownBase = 'a'.repeat(64);
const token = 'order081c-ingest-token';

test('receiver capabilities are versioned, bounded and exact-base truthful', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zungun-capabilities-'));
  const app = createReceiverServer({
    databasePath: join(dir, 'receiver.sqlite'),
    keyPath: join(dir, 'receipt-key.json'),
    receiverId: 'receiver-capability-test',
    deltaBaseSha256: [knownBase],
    principals: [{ subject: 'android-runtime', token, roles: ['ingest'] }],
  });
  try {
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    assert.ok(address && typeof address === 'object');
    const endpoint = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${token}` };

    const known = await fetch(`${endpoint}/api/v1/capabilities?baseSha256=${knownBase}`, { headers });
    assert.equal(known.status, 200);
    const knownBody = await known.json() as any;
    assert.equal(knownBody.schemaVersion, 'zungun.receiver-capabilities/1');
    assert.equal(knownBody.version, 1);
    assert.equal(knownBody.receiverId, 'receiver-capability-test');
    assert.ok(knownBody.ttlMs > 0 && knownBody.ttlMs <= 3_600_000);
    assert.equal(knownBody.operations.query, true);
    assert.equal(knownBody.operations.durableReceipt, true);
    assert.equal(knownBody.delta.mode, 'EXACT_BASE');
    assert.equal(knownBody.delta.exactBaseAvailable, true);
    assert.equal(knownBody.delta.requestedBaseSha256, knownBase);

    const unknownBase = 'b'.repeat(64);
    const unknown = await fetch(`${endpoint}/api/v1/capabilities?baseSha256=${unknownBase}`, { headers });
    assert.equal(unknown.status, 200);
    assert.equal((await unknown.json() as any).delta.exactBaseAvailable, false);

    const invalid = await fetch(`${endpoint}/api/v1/capabilities?baseSha256=not-a-hash`, { headers });
    assert.equal(invalid.status, 400);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
