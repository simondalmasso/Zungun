import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] ?? '.');
const fail = (message) => { console.error(`GAOS_LEAN_INVALID: ${message}`); process.exit(1); };
const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch (error) { fail(`git ${args.join(' ')}: ${error.message}`); }
};
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { fail(`${file}: ${error.message}`); }
};
const requiredStatic = [
  'ops/POLICY.md',
  'ops/CURRENT.json',
  'ops/EVENTS.ndjson',
  'ops/releases/GAOS-LEAN-BASELINE-001.json',
  'docs/product-baseline.md',
];
for (const file of requiredStatic) if (!fs.existsSync(path.join(root, file))) fail(`missing ${file}`);

const current = readJson('ops/CURRENT.json');
const checkpointPath = current.checkpoint?.path?.replace(/^\//, '');
if (typeof checkpointPath !== 'string' || !checkpointPath.startsWith('ops/evidence/')) fail('checkpoint path');
if (!fs.existsSync(path.join(root, checkpointPath))) fail(`missing ${checkpointPath}`);
const checkpoint = readJson(checkpointPath);
const release = readJson('ops/releases/GAOS-LEAN-BASELINE-001.json');

const allowedEventTypes = Object.freeze([
  'WORKSET_OPENED','CLAIM_ASSIGNED','STOP','TAKEOVER','RISK_ESCALATED','CHECKPOINT_REQUESTED',
  'CHECKPOINT_ACCEPTED','AUDIT_DECIDED','RELEASE_AUTHORIZED','DEPLOYMENT_RECORDED','INCIDENT_RECORDED','WORKSET_CLOSED',
]);
const allowedEventTypeSet = new Set(allowedEventTypes);
const allowedEventTypesText = allowedEventTypes.join('|');
const terminalAuditStatuses = new Set(['PASS', 'PASS_WITH_FINDINGS']);

if (current.schema_version !== 'gaos-lean.current.v1') fail('CURRENT schema');
if (current.project !== 'ZUNGUN' || current.system !== 'GAOS_ARQ_AUD') fail('CURRENT identity');
if (current.authority?.sole_active_operational_state !== '/ops/CURRENT.json') fail('CURRENT authority');
if (current.authority?.event_tail?.read_last !== 20) fail('event tail must be 20');
if (current.authority?.fail_closed !== true) fail('fail_closed must be true');
if (current.authority?.latest_checkpoint?.id !== current.checkpoint?.latest_id) fail('authority checkpoint id');
if (current.authority?.latest_checkpoint?.path !== current.checkpoint?.path) fail('authority checkpoint path');
if (checkpoint.checkpoint_id !== current.checkpoint.latest_id) fail('checkpoint id mismatch');
if (checkpoint.workset_id !== current.workset?.id) fail('checkpoint workset mismatch');

const worksetStatus = current.workset?.status;
if (worksetStatus !== 'ACTIVE' && worksetStatus !== 'CLOSED') fail('workset must be ACTIVE or CLOSED');
for (const key of ['merge','deploy','release','production_change','cloudflare_write']) {
  if (checkpoint.boundaries?.[key] !== false) fail(`checkpoint ${key} boundary`);
}
if (release.status === 'AUTHORIZED') fail('release unexpectedly authorized');
for (const value of Object.values(release.actions ?? {})) if (value !== false) fail('release action enabled');
for (const key of ['write_authorized','deploy_authorized','release_authorized','production_change_authorized']) {
  if (current.platform?.[key] !== false) fail(`platform ${key}`);
}

const lines = fs.readFileSync(path.join(root, 'ops/EVENTS.ndjson'), 'utf8').trim().split('\n').filter(Boolean);
if (lines.length < 4) fail('insufficient events');
const ids = new Set();
const events = [];
for (const [index, line] of lines.entries()) {
  let event; try { event = JSON.parse(line); } catch (error) { fail(`event ${index + 1}: ${error.message}`); }
  const expectedSeq = index + 1;
  if (event.schema_version !== 'gaos-lean.event.v1') fail(`event ${expectedSeq} schema`);
  if (!Number.isInteger(event.seq) || event.seq !== expectedSeq) fail(`event ${expectedSeq} sequence`);
  if (!event.event_id || ids.has(event.event_id)) fail(`event ${expectedSeq} id`);
  if (!allowedEventTypeSet.has(event.type)) fail(`event ${expectedSeq} type ${JSON.stringify(event.type)}`);
  ids.add(event.event_id);
  events.push(event);
}

if (current.workset?.id === 'ZUNGUN-GAOS-LEAN-BASELINE-001') {
  if (worksetStatus !== 'CLOSED') fail('Order 059 must remain closed');
  if (current.workset?.mission_base_sha !== '5c49374d5fa54858108cffe437520b793d0cfeb4') fail('Order 059 base');
  if (current.workset?.implementation_branch !== 'feat/gaos-lean-product-baseline-v1') fail('Order 059 branch');
  if (current.workset?.phase !== 'CLOSED') fail('closed workset phase');
  if (current.claim?.status !== 'INACTIVE' || current.claim?.autonomy !== 'NONE_WORKSET_CLOSED') fail('closed claim');
  if (current.next_action !== 'IDLE_AWAIT_HUMAN_WORKSET') fail('closed next action');
  if (current.checkpoint?.status !== 'PASS' || checkpoint.status !== 'PASS') fail('closed checkpoint must be PASS');
  if (!terminalAuditStatuses.has(current.checkpoint?.audit_status)) fail('closed CURRENT audit status');
  if (!terminalAuditStatuses.has(checkpoint.audit?.status) || !terminalAuditStatuses.has(checkpoint.audit?.verdict)) fail('closed checkpoint audit');
  if (current.checkpoint?.checkpoint_accepted !== true || checkpoint.audit?.checkpoint_accepted !== true) fail('closed checkpoint acceptance');
  if (current.checkpoint?.blocking_findings !== 0 || checkpoint.audit?.blocking_findings !== 0) fail('closed blocking findings');
  if (current.checkpoint?.release_blockers !== 0 || checkpoint.audit?.release_blockers !== 0) fail('closed release blockers');
  if (checkpoint.closure?.status !== 'CLOSED') fail('checkpoint closure status');
  const penultimate = events.at(-2);
  const last = events.at(-1);
  const hasRatification = last?.type === 'CHECKPOINT_ACCEPTED' && last.data?.acceptance_scope === 'HUMAN_FINAL_HEAD_RATIFICATION';
  const closureEvent = hasRatification ? penultimate : last;
  if (hasRatification) {
    if (penultimate?.type !== 'WORKSET_CLOSED') fail('ratification must follow WORKSET_CLOSED');
    const ratification = current.head_ratification;
    if (ratification?.status !== 'RATIFIED_CONTROL_MATERIALIZED') fail('head ratification status');
    if (ratification?.ratified_by !== 'HUMAN_OWNER' || last.actor !== 'HUMAN_OWNER') fail('head ratification actor');
    if (ratification?.ratified_commit_sha !== last.data?.ratified_commit_sha) fail('ratified commit mismatch');
    if (ratification?.ratified_tree_sha !== last.data?.ratified_tree_sha) fail('ratified tree mismatch');
    if (ratification?.ratified_ci_run_id !== last.data?.ratified_ci_run_id) fail('ratified CI mismatch');
    if (ratification?.ratified_ci_conclusion !== 'SUCCESS') fail('ratified CI conclusion');
    const head = git('rev-parse', 'HEAD');
    const parent = git('rev-parse', 'HEAD^');
    if (parent !== ratification.ratified_commit_sha) fail('ratification direct child');
    const expectedPaths = [...ratification.materialization.allowed_paths].sort();
    const changedPaths = git('diff', '--name-only', `${parent}..${head}`).split('\n').filter(Boolean).sort();
    if (JSON.stringify(changedPaths) !== JSON.stringify(expectedPaths)) fail('ratification materialization paths');
  } else if (penultimate?.type !== 'AUDIT_DECIDED' || last?.type !== 'WORKSET_CLOSED') {
    fail('closed event tail');
  }
  if (closureEvent?.data?.workset_status !== 'CLOSED' || closureEvent?.data?.claim_status !== 'INACTIVE') fail('closed event statuses');
} else if (current.workset?.id === 'ZUNGUN-ZEP-TEST-LOOPBACK-060') {
  const expectedBase = '940c2dabe81cccb8c9d5a3a140c61b0a8f2d499a';
  const expectedBranch = 'feat/zep-test-loopback-transport-v1';
  const expectedCheckpoint = '/ops/evidence/ZUNGUN-060-CP001.json';
  if (worksetStatus !== 'ACTIVE') fail('Order 060 workset must be ACTIVE');
  if (current.workset?.phase !== 'IMPLEMENTATION' && current.workset?.phase !== 'CHECKPOINT_READY') fail('Order 060 phase');
  if (current.workset?.mission_base_sha !== expectedBase) fail('Order 060 base');
  if (current.workset?.implementation_branch !== expectedBranch) fail('Order 060 branch');
  if (current.workset?.runtime_behavior_change !== true) fail('Order 060 runtime change');
  if (current.checkpoint?.path !== expectedCheckpoint) fail('Order 060 checkpoint path');
  if (checkpoint.materialization?.mission_base_sha !== expectedBase || checkpoint.materialization?.branch !== expectedBranch) fail('Order 060 checkpoint materialization');
  if (checkpoint.scope?.runtime_behavior_change !== true || checkpoint.scope?.environment !== 'TEST_ONLY') fail('Order 060 checkpoint scope');
  if (current.claim?.id !== 'ZUNGUN-060-ARQ-CLAIM-001' || current.claim?.status !== 'ACTIVE') fail('Order 060 claim');
  if (current.claim?.role !== 'ARQ' || current.claim?.executor !== 'ARQ') fail('Order 060 claim role');
  if (current.claim?.autonomy !== 'LONG_DEEP_AUTONOMOUS_WITHIN_WORKSET_SCOPE') fail('Order 060 autonomy');
  if (current.next_action !== 'IMPLEMENT_VERIFY_AND_REQUEST_SINGLE_AUDIT' && current.next_action !== 'REQUEST_SINGLE_NEW_AUD_CHECKPOINT_AUDIT') fail('Order 060 next action');
  if (events.at(-2)?.type !== 'WORKSET_OPENED' || events.at(-2)?.workset_id !== current.workset.id) fail('Order 060 WORKSET_OPENED');
  if (events.at(-1)?.type !== 'CLAIM_ASSIGNED' || events.at(-1)?.data?.claim_id !== current.claim.id) fail('Order 060 CLAIM_ASSIGNED');
  if (checkpoint.status === 'IN_PROGRESS') {
    if (current.checkpoint?.status !== 'IN_PROGRESS') fail('Order 060 in-progress status');
    if (checkpoint.audit?.status !== 'NOT_REQUESTED') fail('Order 060 premature audit');
  } else if (checkpoint.status === 'PASS') {
    if (current.checkpoint?.status !== 'PASS') fail('Order 060 CURRENT checkpoint PASS');
    if (current.workset?.phase !== 'CHECKPOINT_READY') fail('Order 060 checkpoint phase');
    if (checkpoint.functional?.implemented !== true || checkpoint.functional?.transport_boundary_real !== true || checkpoint.functional?.processing_receipt_real !== true) fail('Order 060 functional checkpoint');
    if (checkpoint.verification?.github_actions?.conclusion !== 'SUCCESS') fail('Order 060 CI conclusion');
    if (checkpoint.verification?.github_actions?.head_sha !== checkpoint.materialization?.commit_sha) fail('Order 060 CI head');
    if (!Number.isInteger(checkpoint.verification?.github_actions?.run_id)) fail('Order 060 CI run');
    if (checkpoint.audit?.status !== 'READY_TO_REQUEST') fail('Order 060 audit readiness');
  } else fail('Order 060 checkpoint status');
  if (current.platform?.external_network_authorized !== false || current.platform?.durable_storage_authorized !== false) fail('Order 060 platform boundaries');
} else fail(`unknown workset ${JSON.stringify(current.workset?.id)}`);

const policy = fs.readFileSync(path.join(root, 'ops/POLICY.md'), 'utf8');
for (const phrase of ['/ops/CURRENT.json','last 20','FAIL_CLOSED','Real remote HEAD',allowedEventTypesText]) {
  if (!policy.includes(phrase)) fail(`POLICY missing ${phrase}`);
}
console.log(JSON.stringify({
  ok:true, project:current.project, workset:current.workset.id, worksetStatus,
  events:lines.length, checkpoint:checkpoint.checkpoint_id, checkpointStatus:checkpoint.status,
  releaseStatus:release.status,
}));
