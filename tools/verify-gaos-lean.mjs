import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.');
const required = [
  'ops/POLICY.md',
  'ops/CURRENT.json',
  'ops/EVENTS.ndjson',
  'ops/evidence/GAOS-LEAN-BASELINE-CP001.json',
  'ops/releases/GAOS-LEAN-BASELINE-001.json',
  'docs/product-baseline.md'
];
const allowedEventTypes = Object.freeze([
  'WORKSET_OPENED',
  'CLAIM_ASSIGNED',
  'STOP',
  'TAKEOVER',
  'RISK_ESCALATED',
  'CHECKPOINT_REQUESTED',
  'CHECKPOINT_ACCEPTED',
  'AUDIT_DECIDED',
  'RELEASE_AUTHORIZED',
  'DEPLOYMENT_RECORDED',
  'INCIDENT_RECORDED',
  'WORKSET_CLOSED'
]);
const allowedEventTypeSet = new Set(allowedEventTypes);
const allowedEventTypesText = allowedEventTypes.join('|');
const fail = (message) => { console.error(`GAOS_LEAN_INVALID: ${message}`); process.exit(1); };
for (const file of required) if (!fs.existsSync(path.join(root, file))) fail(`missing ${file}`);
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { fail(`${file}: ${error.message}`); }
};
const current = readJson('ops/CURRENT.json');
const checkpoint = readJson('ops/evidence/GAOS-LEAN-BASELINE-CP001.json');
const release = readJson('ops/releases/GAOS-LEAN-BASELINE-001.json');
if (current.schema_version !== 'gaos-lean.current.v1') fail('CURRENT schema');
if (current.project !== 'ZUNGUN' || current.system !== 'GAOS_ARQ_AUD') fail('CURRENT identity');
if (current.authority?.sole_active_operational_state !== '/ops/CURRENT.json') fail('CURRENT authority');
if (current.authority?.event_tail?.read_last !== 20) fail('event tail must be 20');
if (current.authority?.fail_closed !== true) fail('fail_closed must be true');
if (current.workset?.status !== 'ACTIVE') fail('workset must be ACTIVE');
if (current.workset?.mission_base_sha !== '5c49374d5fa54858108cffe437520b793d0cfeb4') fail('base SHA');
if (current.workset?.implementation_branch !== 'feat/gaos-lean-product-baseline-v1') fail('branch');
if (current.baseline?.runtime_behavior_change !== false) fail('runtime behavior boundary');
if (current.checkpoint?.path !== '/ops/evidence/GAOS-LEAN-BASELINE-CP001.json') fail('checkpoint path');
if (checkpoint.checkpoint_id !== current.checkpoint.latest_id) fail('checkpoint id mismatch');
if (checkpoint.scope?.runtime_behavior_change !== false) fail('checkpoint runtime boundary');
for (const key of ['merge','deploy','release','production_change','cloudflare_write']) {
  if (checkpoint.boundaries?.[key] !== false) fail(`checkpoint ${key} boundary`);
}
if (release.status === 'AUTHORIZED') fail('release unexpectedly authorized');
for (const value of Object.values(release.actions ?? {})) if (value !== false) fail('release action enabled');
const lines = fs.readFileSync(path.join(root, 'ops/EVENTS.ndjson'), 'utf8').trim().split('\n').filter(Boolean);
if (lines.length < 4) fail('insufficient events');
const ids = new Set();
for (const [index, line] of lines.entries()) {
  let event; try { event = JSON.parse(line); } catch (error) { fail(`event ${index + 1}: ${error.message}`); }
  if (event.schema_version !== 'gaos-lean.event.v1') fail(`event ${index + 1} schema`);
  const expectedSeq = index + 1;
  if (!Number.isInteger(event.seq) || event.seq !== expectedSeq) fail(`event ${index + 1} sequence must equal ${expectedSeq}`);
  if (!event.event_id || ids.has(event.event_id)) fail(`event ${index + 1} id`);
  if (typeof event.type !== 'string' || !allowedEventTypeSet.has(event.type)) fail(`event ${index + 1} type ${JSON.stringify(event.type)}`);
  ids.add(event.event_id);
}
const policy = fs.readFileSync(path.join(root, 'ops/POLICY.md'), 'utf8');
for (const phrase of ['/ops/CURRENT.json','last 20','FAIL_CLOSED','Real remote HEAD',allowedEventTypesText]) if (!policy.includes(phrase)) fail(`POLICY missing ${phrase}`);
console.log(JSON.stringify({ok:true,project:current.project,workset:current.workset.id,events:lines.length,allowedEventTypes:allowedEventTypes.length,checkpoint:checkpoint.checkpoint_id,checkpointStatus:checkpoint.status,auditStatus:checkpoint.audit?.status,releaseStatus:release.status}));
