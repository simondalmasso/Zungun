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
const terminalAuditStatuses = new Set(['PASS', 'PASS_WITH_FINDINGS']);
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
const worksetStatus = current.workset?.status;
if (worksetStatus !== 'ACTIVE' && worksetStatus !== 'CLOSED') fail('workset must be ACTIVE or CLOSED');
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
const events = [];
for (const [index, line] of lines.entries()) {
  let event; try { event = JSON.parse(line); } catch (error) { fail(`event ${index + 1}: ${error.message}`); }
  if (event.schema_version !== 'gaos-lean.event.v1') fail(`event ${index + 1} schema`);
  const expectedSeq = index + 1;
  if (!Number.isInteger(event.seq) || event.seq !== expectedSeq) fail(`event ${index + 1} sequence must equal ${expectedSeq}`);
  if (!event.event_id || ids.has(event.event_id)) fail(`event ${index + 1} id`);
  if (typeof event.type !== 'string' || !allowedEventTypeSet.has(event.type)) fail(`event ${index + 1} type ${JSON.stringify(event.type)}`);
  ids.add(event.event_id);
  events.push(event);
}
if (worksetStatus === 'CLOSED') {
  if (current.workset?.phase !== 'CLOSED') fail('closed workset phase');
  if (current.claim?.status !== 'INACTIVE') fail('closed claim status');
  if (current.claim?.autonomy !== 'NONE_WORKSET_CLOSED') fail('closed claim autonomy');
  if (current.next_action !== 'IDLE_AWAIT_HUMAN_WORKSET') fail('closed next action');
  if (current.checkpoint?.status !== 'PASS' || checkpoint.status !== 'PASS') fail('closed checkpoint must be PASS');
  if (!terminalAuditStatuses.has(current.checkpoint?.audit_status)) fail('closed CURRENT audit status');
  if (!terminalAuditStatuses.has(checkpoint.audit?.status)) fail('closed checkpoint audit status');
  if (!terminalAuditStatuses.has(checkpoint.audit?.verdict)) fail('closed checkpoint audit verdict');
  if (current.checkpoint?.checkpoint_accepted !== true || checkpoint.audit?.checkpoint_accepted !== true) fail('closed checkpoint acceptance');
  if (current.checkpoint?.blocking_findings !== 0 || checkpoint.audit?.blocking_findings !== 0) fail('closed blocking findings');
  if (current.checkpoint?.release_blockers !== 0 || checkpoint.audit?.release_blockers !== 0) fail('closed release blockers');
  if (checkpoint.closure?.status !== 'CLOSED') fail('checkpoint closure status');
  if (events.length < 2) fail('closed event tail');
  const penultimate = events.at(-2);
  const last = events.at(-1);
  if (penultimate?.type !== 'AUDIT_DECIDED') fail('penultimate event must be AUDIT_DECIDED');
  if (last?.type !== 'WORKSET_CLOSED') fail('last event must be WORKSET_CLOSED');
  if (last.data?.workset_status !== 'CLOSED' || last.data?.claim_status !== 'INACTIVE') fail('closed event terminal statuses');
  for (const key of ['merge','deploy','release','cloudflare_write','production_change']) {
    if (last.data?.[key] !== false) fail(`closed event ${key} boundary`);
  }
  for (const key of ['write_authorized','deploy_authorized','release_authorized','production_change_authorized']) {
    if (current.platform?.[key] !== false) fail(`closed platform ${key}`);
  }
  if (release.status !== 'NOT_AUTHORIZED') fail('closed release status');
  for (const value of Object.values(release.authorization ?? {})) if (value !== false) fail('closed release authorization');
}
const policy = fs.readFileSync(path.join(root, 'ops/POLICY.md'), 'utf8');
for (const phrase of ['/ops/CURRENT.json','last 20','FAIL_CLOSED','Real remote HEAD',allowedEventTypesText]) if (!policy.includes(phrase)) fail(`POLICY missing ${phrase}`);
console.log(JSON.stringify({ok:true,project:current.project,workset:current.workset.id,worksetStatus,events:lines.length,allowedEventTypes:allowedEventTypes.length,checkpoint:checkpoint.checkpoint_id,checkpointStatus:checkpoint.status,auditStatus:checkpoint.audit?.status,releaseStatus:release.status}));
