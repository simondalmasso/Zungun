import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
const exactKeys = ['$schema','compatibility_date','d1_databases','main','name','observability','preview_urls','workers_dev'].sort();
const actualKeys = Object.keys(config).sort();
const fail = (code) => { console.error(code); process.exit(1); };
if (JSON.stringify(actualKeys) !== JSON.stringify(exactKeys)) fail(`CONFIG_KEYS:${actualKeys.join(',')}`);
if (config.name !== 'zungun-zep-cloudflare-pilot-v0' || config.main !== 'worker/index.ts') fail('CONFIG_IDENTITY');
if (config.workers_dev !== false || config.preview_urls !== false) fail('PUBLIC_ROUTE_ENABLED');
if (config.observability?.enabled !== false || config.observability?.head_sampling_rate !== 0) fail('OBSERVABILITY_ENABLED');
if (!Array.isArray(config.d1_databases) || config.d1_databases.length !== 1) fail('D1_BINDING_COUNT');
const db = config.d1_databases[0];
const dbKeys = ['binding','database_id','database_name','migrations_dir','migrations_table','preview_database_id'].sort();
if (JSON.stringify(Object.keys(db).sort()) !== JSON.stringify(dbKeys)) fail('D1_BINDING_KEYS');
if (db.binding !== 'DB' || db.database_name !== 'zungun-pilot-v0-local-only') fail('D1_BINDING_IDENTITY');
if (db.database_id !== '00000000-0000-0000-0000-000000000000' || db.preview_database_id !== db.database_id) fail('REMOTE_D1_ID_PRESENT');
if (db.migrations_dir !== 'migrations' || db.migrations_table !== 'd1_migrations') fail('MIGRATION_CONFIG');
const index = fs.readFileSync(path.join(root, 'worker/index.ts'), 'utf8');
if (!index.includes('ZUNGUN_PILOT_TOKEN') || !index.includes('readonly DB')) fail('EXPECTED_BINDINGS_MISSING');
for (const forbidden of ['kv_namespaces','r2_buckets','durable_objects','queues','analytics_engine_datasets','routes','route','custom_domains','vars','services','hyperdrive','vectorize','ai']) {
  if (Object.prototype.hasOwnProperty.call(config, forbidden)) fail(`FORBIDDEN_BINDING:${forbidden}`);
}
console.log(JSON.stringify({ ok:true, worker:config.name, bindings:['D1:DB','SECRET_NAME:ZUNGUN_PILOT_TOKEN'], remoteDatabaseConfigured:false, routes:0, workersDev:false }));
