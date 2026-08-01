import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort();
if (JSON.stringify(migrations) !== JSON.stringify(['0001_messages.sql', '0002_syncburst.sql'])) throw new Error('MIGRATION_SET_INVALID');
const sql = migrations.map((name) => fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).join('\n');
const python = String.raw`
import sqlite3, sys, json, hashlib
sql=sys.stdin.read()
outputs=[]
for _ in range(2):
  db=sqlite3.connect(':memory:')
  db.executescript(sql)
  tables=['messages','pilot_internal_keys','mailbox_deliveries','sync_cursors','sync_requests']
  columns={t:[r[1] for r in db.execute(f'pragma table_info({t})')] for t in tables}
  indexes={t:[r[1] for r in db.execute("select type,name,tbl_name,sql from sqlite_schema where type='index' and tbl_name=? order by name",(t,))] for t in tables}
  schema=[r[0] for r in db.execute("select sql from sqlite_schema where tbl_name in ('messages','pilot_internal_keys','mailbox_deliveries','sync_cursors','sync_requests') and sql is not null order by type,name")]
  payload_columns=[c for t in ('mailbox_deliveries','sync_cursors','sync_requests') for c in columns[t] if 'payload' in c.lower()]
  outputs.append({'columns':columns,'indexes':indexes,'payloadColumns':payload_columns,'schemaHash':hashlib.sha256('\n'.join(schema).encode()).hexdigest()})
print(json.dumps(outputs,separators=(',',':')))
`;
const run = spawnSync('python3', ['-c', python], { input: sql, encoding: 'utf8' });
if (run.status !== 0) throw new Error(`MIGRATION_APPLY_FAILED:${run.stderr}`);
const outputs = JSON.parse(run.stdout);
if (JSON.stringify(outputs[0]) !== JSON.stringify(outputs[1])) throw new Error('MIGRATION_NOT_REPRODUCIBLE');
const result = outputs[0];
for (const column of ['entry_sequence','mailbox_id','message_id','enqueued_at_ms','acknowledged_at_ms']) {
  if (!result.columns.mailbox_deliveries.includes(column)) throw new Error(`MISSING_DELIVERY_COLUMN:${column}`);
}
for (const column of ['cursor_token','mailbox_id','entry_sequence','created_at_ms']) {
  if (!result.columns.sync_cursors.includes(column)) throw new Error(`MISSING_CURSOR_COLUMN:${column}`);
}
for (const column of ['mailbox_id','request_id','request_hash','cursor_token','cursor_sequence','has_more','outgoing_results_json','ack_results_json','delivery_sequences_json','max_response_bytes','created_at_ms']) {
  if (!result.columns.sync_requests.includes(column)) throw new Error(`MISSING_REQUEST_COLUMN:${column}`);
}
if (!result.indexes.mailbox_deliveries.includes('mailbox_deliveries_pull_idx')) throw new Error('DELIVERY_INDEX_MISSING');
if (!result.indexes.sync_cursors.includes('sync_cursors_mailbox_idx')) throw new Error('CURSOR_INDEX_MISSING');
if (result.payloadColumns.length !== 0) throw new Error('PAYLOAD_DUPLICATION_SCHEMA_DETECTED');
console.log(JSON.stringify({ ok: true, migrations, tables: Object.keys(result.columns), schemaHash: result.schemaHash, reproducible: true, payloadDuplication: false }));
