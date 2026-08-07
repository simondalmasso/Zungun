import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Android prefetch is durable declarative and provider-key based rather than arbitrary URL crawling',()=>{
 const db=readFileSync('android/runtime/src/main/java/com/zungun/runtime/db/ZungunDatabase.kt','utf8');
 const worker=readFileSync('android/runtime/src/main/java/com/zungun/runtime/link/LinkPrefetch.kt','utf8');
 const runtime=readFileSync('android/runtime/src/main/java/com/zungun/runtime/delivery/CriticalOperationRuntime.kt','utf8');
 assert.ok(db.includes('CREATE TABLE IF NOT EXISTS link_prefetch_hints'));
 assert.ok(runtime.includes('prefetchHints: List<LinkPrefetchSpec>'));
 assert.ok(worker.includes('providerKey: String'));
 assert.ok(!worker.includes('URL('));
 assert.ok(worker.includes('snapshot.validated'));
 assert.ok(worker.includes('!snapshot.metered || snapshot.temporarilyUnmetered'));
});
