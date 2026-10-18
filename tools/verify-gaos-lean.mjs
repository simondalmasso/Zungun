import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
  'WORKSET_CLOSED',
  'EXECUTION_PROGRESS_RECORDED'
]);
const terminalAuditStatuses = new Set(['PASS', 'PASS_WITH_FINDINGS']);
const allowedEventTypeSet = new Set(allowedEventTypes);
const allowedEventTypesText = allowedEventTypes.join('|');
const fail = (message) => { console.error(`GAOS_LEAN_INVALID: ${message}`); process.exit(1); };
const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch (error) { fail(`git ${args.join(' ')}: ${error.message}`); }
};
for (const file of required) if (!fs.existsSync(path.join(root, file))) fail(`missing ${file}`);
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
  catch (error) { fail(`${file}: ${error.message}`); }
};
const current = readJson('ops/CURRENT.json');
const checkpoint = readJson('ops/evidence/GAOS-LEAN-BASELINE-CP001.json');
const baselineRelease = readJson('ops/releases/GAOS-LEAN-BASELINE-001.json');
const baselineOrderId = 'ZUNGUN-ARQ-CANONICAL-PRODUCT-BASELINE-059';
const worksetOrder = current.workset?.order_id;
const order085ReleasePath = 'ops/releases/ORDER-085.json';
if (worksetOrder === 'ORDER-085' && !fs.existsSync(path.join(root, order085ReleasePath))) fail('missing ' + order085ReleasePath);
const release = worksetOrder === 'ORDER-085' ? readJson(order085ReleasePath) : baselineRelease;
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
if (baselineRelease.status !== 'NOT_AUTHORIZED') fail('Order 059 baseline release must remain NOT_AUTHORIZED');
for (const value of Object.values(baselineRelease.actions ?? {})) if (value !== false) fail('Order 059 baseline release action enabled');
if (worksetOrder !== baselineOrderId && worksetOrder !== 'ORDER-085') fail('unsupported active order');
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

if (worksetOrder === 'ORDER-085') {
  if (worksetStatus !== 'ACTIVE' || current.workset?.id !== 'ZUNGUN-ORDER-085-MOBILE-PRODUCT-COMPLETION-001') fail('ORDER-085 active workset identity/status');
  if (current.workset?.phase !== 'EXECUTION') fail('ORDER-085 phase');
  if (current.workset?.target_branch !== 'feat/zungun-full-project-v1') fail('ORDER-085 product target branch');
  if (current.workset?.target_start_sha !== '3c7d466ad9f54369ff60cb34b6dd86503502d6d6') fail('ORDER-085 source start head');
  if (current.claim?.id !== 'ZUNGUN-ORDER-085-ARQ-CLAIM-001' || current.claim?.status !== 'ACTIVE') fail('ORDER-085 claim identity/status');
  if (current.claim?.branch !== current.workset.target_branch || current.claim?.base_sha !== current.workset.target_start_sha) fail('ORDER-085 claim branch/base');
  if (!Array.isArray(current.claim?.allowed_paths) || !current.claim.allowed_paths.includes('cloudflare/public/**')) fail('ORDER-085 claim paths');
  if (current.workset?.active_checkpoint?.id !== 'ORDER-085-CP001' || current.workset?.active_checkpoint?.status !== 'IN_PROGRESS') fail('ORDER-085 active checkpoint reference');
  if (current.workset?.active_checkpoint?.path !== '/ops/evidence/ORDER-085-CP001.json') fail('ORDER-085 active checkpoint path');
  const activeCheckpoint = readJson('ops/evidence/ORDER-085-CP001.json');
  if (activeCheckpoint.checkpoint_id !== 'ORDER-085-CP001' || activeCheckpoint.workset_id !== current.workset.id) fail('ORDER-085 checkpoint identity');
  if (activeCheckpoint.status !== 'IN_PROGRESS') fail('ORDER-085 checkpoint cannot claim PASS before terminal gates');
  if (activeCheckpoint.materialization?.commit_sha !== current.workset.target_start_sha) fail('ORDER-085 initial checkpoint HEAD');
  if (release.release_id !== 'ORDER-085' || release.workset_id !== current.workset.id || release.status !== 'AUTHORIZED') fail('ORDER-085 release identity/status');
  if (release.source_order?.source_comment_id !== 5372505874 || release.authorization?.human_owner !== true || release.authorization?.audit_authority !== true) fail('ORDER-085 Owner/AUD authority');
  if (release.target?.branch !== current.workset.target_branch || release.target?.initial_head !== current.workset.target_start_sha) fail('ORDER-085 release target');
  for (const key of ['merge','tag','github_release']) if (release.actions?.[key] !== false) fail('ORDER-085 forbidden action ' + key);
  for (const key of ['cloudflare_write','deploy','production_change']) if (release.actions?.[key] !== true) fail('ORDER-085 missing scoped authorization ' + key);
  if (release.preconditions?.deploy_procedure !== 'tools/order083/deploy-production.sh') fail('ORDER-085 deploy procedure');
  if (release.preconditions?.workflow_dispatch_only !== true || release.preconditions?.no_indirect_trigger_or_workflow_bypass !== true) fail('ORDER-085 workflow guard');
  if (release.preconditions?.order077_exact_final_head !== 'SUCCESS_REQUIRED_ZERO_SKIPS' || release.preconditions?.order081_exact_final_head !== 'SUCCESS_REQUIRED_ZERO_SKIPS' || release.preconditions?.order083_exact_final_head !== 'SUCCESS_REQUIRED_ZERO_SKIPS') fail('ORDER-085 exact-head gate contract');
  if (current.platform?.write_authorized !== true || current.platform?.deploy_authorized !== true || current.platform?.cloudflare_write_authorized !== true) fail('ORDER-085 active write/deploy authorization');
  if (current.platform?.release_authorized !== false || current.platform?.production_change_authorized !== true) fail('ORDER-085 platform boundaries');
  const activeEvents = events.filter(event => event.workset_id === current.workset.id);
  if (activeEvents.length < 4) fail('ORDER-085 transition event count');
  const expectedTypes = ['WORKSET_OPENED','CLAIM_ASSIGNED','RELEASE_AUTHORIZED','CHECKPOINT_REQUESTED'];
  if (JSON.stringify(activeEvents.slice(0,4).map(event => event.type)) !== JSON.stringify(expectedTypes)) fail('ORDER-085 transition event sequence');
  if (activeEvents.slice(4).some(event => event.type !== 'EXECUTION_PROGRESS_RECORDED' || event.actor !== 'ARQ' || event.data?.order_id !== 'ORDER-085' || !event.data?.candidate_head_sha)) fail('ORDER-085 progress event format');
  if (activeEvents[0].actor !== 'HUMAN_OWNER' || activeEvents[1].actor !== 'HUMAN_OWNER' || activeEvents[2].actor !== 'HUMAN_OWNER' || activeEvents[3].actor !== 'ARQ') fail('ORDER-085 transition actor sequence');
  if (activeEvents.some(event => event.data?.order_id !== 'ORDER-085')) fail('ORDER-085 event order identity');
  if (activeEvents[0].data?.authorization?.source_comment_id !== 5372505874) fail('ORDER-085 workset authorization source');
  if (activeEvents[2].data?.release_id !== 'ORDER-085' || activeEvents[2].data?.actions?.deploy !== true || activeEvents[2].data?.actions?.merge !== false) fail('ORDER-085 release event boundaries');
  if (activeEvents[3].data?.checkpoint_id !== 'ORDER-085-CP001' || activeEvents[3].data?.requested_commit_sha !== current.workset.target_start_sha) fail('ORDER-085 checkpoint request event');
  if (current.next_action !== 'RESUME_ORDER_085_RECONCILE_LOGO_AND_PRODUCTION_E2E_THEN_FINAL_HEAD_CI_AND_GUARDED_DEPLOY') fail('ORDER-085 next action');
}

if (worksetStatus === 'CLOSED' && worksetOrder === baselineOrderId) {
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
  const hasHumanHeadRatification = last?.type === 'CHECKPOINT_ACCEPTED' && last.data?.acceptance_scope === 'HUMAN_FINAL_HEAD_RATIFICATION';
  let closureEvent;
  if (hasHumanHeadRatification) {
    if (penultimate?.type !== 'WORKSET_CLOSED') fail('ratification must follow WORKSET_CLOSED');
    closureEvent = penultimate;
    const ratification = current.head_ratification;
    if (ratification?.status !== 'RATIFIED_CONTROL_MATERIALIZED') fail('head ratification status');
    if (ratification?.resolved_state !== 'FAIL_CLOSED_HEAD_DRIFT') fail('head ratification resolved state');
    if (ratification?.ratified_by !== 'HUMAN_OWNER' || last.actor !== 'HUMAN_OWNER') fail('head ratification actor');
    if (ratification?.ratified_commit_sha !== last.data?.ratified_commit_sha) fail('ratified commit mismatch');
    if (ratification?.ratified_tree_sha !== last.data?.ratified_tree_sha) fail('ratified tree mismatch');
    if (ratification?.ratified_ci_run_id !== last.data?.ratified_ci_run_id) fail('ratified CI run mismatch');
    if (ratification?.ratified_ci_conclusion !== 'SUCCESS' || last.data?.ratified_ci_conclusion !== 'SUCCESS') fail('ratified CI conclusion');
    for (const name of ['control-plane-validate','runtime-regression','baseline-gate']) {
      if (ratification?.ratified_jobs?.[name] !== 'SUCCESS' || last.data?.jobs?.[name] !== 'SUCCESS') fail(`ratified job ${name}`);
    }
    if (ratification?.materialization?.mode !== 'DIRECT_CHILD_CONTROL_ONLY' || last.data?.materialization_mode !== 'DIRECT_CHILD_CONTROL_ONLY') fail('ratification materialization mode');
    if (ratification?.materialization?.event_seq !== last.seq || ratification?.materialization?.event_id !== last.event_id) fail('ratification event reference');
    const ratifiedSha = ratification.ratified_commit_sha;
    if (ratification?.materialization?.required_parent_sha !== ratifiedSha || last.data?.required_parent_sha !== ratifiedSha) fail('ratification parent declaration');
    const head = git('rev-parse', 'HEAD');
    const parent = git('rev-parse', 'HEAD^');
    if (parent !== ratifiedSha) fail('ratification materialization must be direct child of ratified head');
    const ratifiedTree = git('rev-parse', `${ratifiedSha}^{tree}`);
    if (ratifiedTree !== ratification.ratified_tree_sha) fail('ratified tree verification');
    const expectedPaths = [...ratification.materialization.allowed_paths].sort();
    const eventPaths = [...(last.data?.allowed_materialization_paths ?? [])].sort();
    if (JSON.stringify(eventPaths) !== JSON.stringify(expectedPaths)) fail('ratification allowed paths mismatch');
    const changedPaths = git('diff', '--name-only', `${ratifiedSha}..${head}`).split('\n').filter(Boolean).sort();
    if (JSON.stringify(changedPaths) !== JSON.stringify(expectedPaths)) fail(`ratification materialization paths ${JSON.stringify(changedPaths)}`);
    for (const key of ['merge','deploy','release','cloudflare_write','production_change']) {
      if (last.data?.[key] !== false) fail(`ratification ${key} boundary`);
    }
    if (last.data?.workset_status !== 'CLOSED' || last.data?.claim_status !== 'INACTIVE') fail('ratification terminal statuses');
    if (last.data?.next_action !== 'IDLE_AWAIT_HUMAN_WORKSET') fail('ratification next action');
  } else {
    if (penultimate?.type !== 'AUDIT_DECIDED') fail('penultimate event must be AUDIT_DECIDED');
    if (last?.type !== 'WORKSET_CLOSED') fail('last event must be WORKSET_CLOSED');
    closureEvent = last;
  }
  if (closureEvent.data?.workset_status !== 'CLOSED' || closureEvent.data?.claim_status !== 'INACTIVE') fail('closed event terminal statuses');
  for (const key of ['merge','deploy','release','cloudflare_write','production_change']) {
    if (closureEvent.data?.[key] !== false) fail(`closed event ${key} boundary`);
  }
  for (const key of ['write_authorized','deploy_authorized','release_authorized','production_change_authorized']) {
    if (current.platform?.[key] !== false) fail(`closed platform ${key}`);
  }
  if (baselineRelease.status !== 'NOT_AUTHORIZED') fail('closed baseline release status');
  for (const value of Object.values(baselineRelease.authorization ?? {})) if (value !== false) fail('closed baseline release authorization');
}
const policy = fs.readFileSync(path.join(root, 'ops/POLICY.md'), 'utf8');
for (const phrase of ['/ops/CURRENT.json','last 20','FAIL_CLOSED','Real remote HEAD',allowedEventTypesText]) if (!policy.includes(phrase)) fail(`POLICY missing ${phrase}`);
console.log(JSON.stringify({ok:true,project:current.project,workset:current.workset.id,worksetStatus,headRatificationStatus:current.head_ratification?.status ?? null,events:lines.length,allowedEventTypes:allowedEventTypes.length,checkpoint:checkpoint.checkpoint_id,checkpointStatus:checkpoint.status,auditStatus:checkpoint.audit?.status,releaseStatus:release.status}));
