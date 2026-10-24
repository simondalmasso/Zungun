import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(import.meta.dirname,'../..');const worker=fs.readFileSync(path.join(root,'cloudflare/src/worker.mjs'),'utf8');const migration=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_order083_product.sql'),'utf8');
test('D1 migration is additive and enforces identity/idempotency boundaries',()=>{assert.doesNotMatch(migration,/\bDROP\s+(?:TABLE|INDEX)\b/i);const db=new DatabaseSync(':memory:');db.exec(migration);db.exec("INSERT INTO identities(user_id,display_name,pairing_code,created_at_ms) VALUES('u1','A','ABCDEFGH',1),('u2','B','BCDEFGH2',1)");db.exec("INSERT INTO work_orders(work_order_id,creator_user_id,assignee_user_id,title,description,expires_at_ms,status,revision,created_at_ms,updated_at_ms) VALUES('wo1','u1','u2','T','',9999999999999,'OPEN',1,1,1)");db.exec("INSERT INTO field_operations(operation_id,idempotency_key,work_order_id,user_id,envelope_hash,message_commitment,replay_nonce,action,note,expected_revision,state,application_outcome,accepted_at_ms,applied_at_ms) VALUES('op1','idem1','wo1','u2','h','m','n','COMPLETE','',1,'COMPLETED','EFFECT_APPLIED',1,1)");const applied=db.prepare("SELECT status,effect_operation_id,revision FROM work_orders WHERE work_order_id='wo1'").get();assert.equal(applied.status,'COMPLETED');assert.equal(applied.effect_operation_id,'op1');assert.equal(applied.revision,2);assert.throws(()=>db.exec("INSERT INTO field_operations(operation_id,idempotency_key,work_order_id,user_id,envelope_hash,message_commitment,replay_nonce,action,note,expected_revision,state,application_outcome,accepted_at_ms,applied_at_ms) VALUES('op2','idem1','wo1','u2','h2','m2','n2','COMPLETE','',1,'COMPLETED','EFFECT_APPLIED',1,1)"));});
test('Worker keeps browser state truthful and has pilot-only ambiguity injection',()=>{for(const required of ['SENT','DELIVERED','MESSAGE_ID_CONFLICT','SEMANTIC_REVALIDATION_FAILED','DROP_AFTER_DURABLE_ACCEPT','ZUNGUN_PILOT_TOKEN','ConversationDurableObject','ctx.storage.sql','RECIPIENT_DELIVERY_ACK','MESSAGE_COMMITMENT_MISMATCH'])assert.ok(worker.includes(required),required);assert.match(worker,/deliveredAtMs\?"DELIVERED":"SENT"/);assert.doesNotMatch(worker,/read[_ -]?receipt/i);assert.doesNotMatch(worker,/presence/i);const android=fs.readFileSync(path.join(root,'android/app/src/main/java/com/zungun/app/MessageStore.kt'),'utf8');assert.ok(android.includes("'QUEUED','UNKNOWN','SENT','DELIVERED','CONFLICT'"));});
test('Session storage is hash-only on D1',()=>{assert.match(migration,/session_hash TEXT PRIMARY KEY/);assert.doesNotMatch(migration,/session_token|raw_token/i);assert.match(worker,/sha256Hex\(token\)/);});
test('Static pages avoid inline JavaScript under strict CSP',()=>{const html=[];const walk=p=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isDirectory())walk(q);else if(e.name.endsWith('.html'))html.push(q)}};walk(path.join(root,'cloudflare/public'));for(const f of html){const s=fs.readFileSync(f,'utf8');assert.doesNotMatch(s,/<script(?![^>]*\bsrc=)(?![^>]*\btype="application\/ld\+json")[^>]*>/i,path.relative(root,f));}});

test('Android witness ingest is authenticated, bounded, hash-validated, and never promoted to verified evidence',()=>{
  assert.ok(worker.includes('\\/witness\\/ingest$/.exec(path)'));
  for(const required of ['WITNESS_CHAIN_INVALID','WITNESS_SCOPE_MISMATCH','WITNESS_PREVIOUS_HASH_MISMATCH','WITNESS_HASH_MISMATCH','ANDROID_WITNESS_','"OBSERVED"']) assert.ok(worker.includes(required),required);
  assert.match(worker,/field\.user_id !== user\.user_id/);
  assert.doesNotMatch(worker,/ANDROID_WITNESS_\$\{item\.state\}[^;]{0,180}"VERIFIED"/s);
});

test('Zungun chat route loads the real chat and offline outbox under strict CSP',()=>{
  const html=fs.readFileSync(path.join(root,'cloudflare/public/chat/index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'cloudflare/public/chat/app.css'),'utf8');
  const js=fs.readFileSync(path.join(root,'cloudflare/public/chat/app.js'),'utf8');
  const outbox=fs.readFileSync(path.join(root,'cloudflare/public/chat/outbox.js'),'utf8');
  const sw=fs.readFileSync(path.join(root,'cloudflare/public/chat/sw.js'),'utf8');
  assert.ok(worker.includes('path==="/chat"'));
  assert.ok(worker.includes('path==="/chat/"'));
  assert.ok(html.includes('<link rel="stylesheet" href="./app.css">'));
  assert.ok(html.includes('<script src="./outbox.js" defer></script>'));
  assert.ok(html.includes('<script src="./app.js" defer></script>'));
  assert.ok(!html.includes('<style>'));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html));
  assert.ok(!html.includes(' style='));
  assert.ok(css.includes('.composer'));
  assert.ok(js.includes("'/api/v1/conversations/'+current.conversationId+'/messages"));
  assert.ok(js.includes('window.ZungunOutbox.createStore'));
  assert.ok(js.includes('drainOutbox'));
  assert.ok(outbox.includes('MAX_MESSAGES'));
  assert.ok(outbox.includes('messageId'));
  assert.ok(sw.includes("'/chat/app.js'"));
  assert.ok(sw.includes("'/chat/outbox.js'"));
  assert.ok(sw.includes("'/chat/app.css'"));
});
