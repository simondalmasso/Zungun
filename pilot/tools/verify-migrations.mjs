import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort();
if (JSON.stringify(migrations) !== JSON.stringify(['0001_messages.sql'])) throw new Error('MIGRATION_SET_INVALID');
const sql = migrations.map((name) => fs.readFileSync(path.join(root, 'migrations', name), 'utf8')).join('\n');
const python = String.raw`
import sqlite3, sys, json, hashlib
sql=sys.stdin.read()
outputs=[]
for _ in range(2):
  db=sqlite3.connect(':memory:')
  db.executescript(sql)
  cols=[r[1] for r in db.execute('pragma table_info(messages)')]
  indexes=[r[1] for r in db.execute("select type,name,tbl_name,sql from sqlite_schema where type='index' and tbl_name='messages' order by name")]
  key_cols=[r[1] for r in db.execute('pragma table_info(pilot_internal_keys)')]
  schema=[r[0] for r in db.execute("select sql from sqlite_schema where tbl_name in ('messages','pilot_internal_keys') and sql is not null order by type,name")]
  outputs.append({'columns':cols,'indexes':indexes,'keyColumns':key_cols,'schemaHash':hashlib.sha256('\n'.join(schema).encode()).hexdigest()})
print(json.dumps(outputs,separators=(',',':')))
`;
const run = spawnSync('python3', ['-c', python], { input: sql, encoding:'utf8' });
if (run.status !== 0) throw new Error(`MIGRATION_APPLY_FAILED:${run.stderr}`);
const outputs = JSON.parse(run.stdout);
if (JSON.stringify(outputs[0]) !== JSON.stringify(outputs[1])) throw new Error('MIGRATION_NOT_REPRODUCIBLE');
const required = ['message_id','message_commitment','zep_version','conversation_id','sender_id','recipients_json','content_type','payload_blob','created_at_ms','expires_at_ms','status','stored_at_ms','acknowledged_at_ms','processing_receipt_id','processing_receipt_json'];
for (const column of required) if (!outputs[0].columns.includes(column)) throw new Error(`MISSING_COLUMN:${column}`);
if (!outputs[0].indexes.includes('messages_status_expires_idx') || !outputs[0].indexes.includes('messages_commitment_idx')) throw new Error('INDEXES_MISSING');
if (JSON.stringify(outputs[0].keyColumns) !== JSON.stringify(['key_name','key_blob','created_at_ms'])) throw new Error('INTERNAL_KEY_TABLE_INVALID');
console.log(JSON.stringify({ok:true,migrations,requiredColumns:required.length,internalKeyColumns:outputs[0].keyColumns.length,schemaHash:outputs[0].schemaHash,reproducible:true}));
