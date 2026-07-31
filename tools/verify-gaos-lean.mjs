import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]??'.');
const fail=(message)=>{console.error(`GAOS_LEAN_INVALID: ${message}`);process.exit(1);};
const readJson=(file)=>{try{return JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));}catch(error){fail(`${file}: ${error instanceof Error?error.message:String(error)}`);}};
const required=['ops/POLICY.md','ops/CURRENT.json','ops/EVENTS.ndjson','ops/releases/GAOS-LEAN-BASELINE-001.json'];
for(const file of required)if(!fs.existsSync(path.join(root,file)))fail(`missing ${file}`);
const current=readJson('ops/CURRENT.json');
const checkpointPath=current.checkpoint?.path?.replace(/^\//,'');
if(typeof checkpointPath!=='string'||checkpointPath!=='ops/evidence/ZUNGUN-CLOUDFLARE-PILOT-V0-CP001.json')fail('checkpoint path');
if(!fs.existsSync(path.join(root,checkpointPath)))fail(`missing ${checkpointPath}`);
const checkpoint=readJson(checkpointPath);
const release=readJson('ops/releases/GAOS-LEAN-BASELINE-001.json');
const allowedEventTypes=new Set(['WORKSET_OPENED','CLAIM_ASSIGNED','STOP','TAKEOVER','RISK_ESCALATED','CHECKPOINT_REQUESTED','CHECKPOINT_ACCEPTED','AUDIT_DECIDED','RELEASE_AUTHORIZED','DEPLOYMENT_RECORDED','INCIDENT_RECORDED','WORKSET_CLOSED']);

if(current.schema_version!=='gaos-lean.current.v1'||current.project!=='ZUNGUN'||current.system!=='GAOS_ARQ_AUD')fail('CURRENT identity');
if(current.authority?.sole_active_operational_state!=='/ops/CURRENT.json'||current.authority?.event_tail?.read_last!==20||current.authority?.fail_closed!==true)fail('CURRENT authority');
if(current.workset?.id!=='ZUNGUN-CLOUDFLARE-PILOT-V0'||current.workset?.order_id!=='ZUNGUN-CLOUDFLARE-PILOT-V0')fail('pilot workset identity');
if(current.workset?.status!=='ACTIVE'||!['IMPLEMENTATION','CHECKPOINT_READY'].includes(current.workset?.phase))fail('pilot workset state');
if(current.workset?.mission_base_sha!=='d2404cf232976a8f39abb1171ead2ed1f63533fa')fail('pilot base');
if(current.workset?.implementation_branch!=='feat/zep-cloudflare-pilot-v0'||current.workset?.risk!=='HIGH'||current.workset?.runtime_behavior_change!==true)fail('pilot workset parameters');
if(current.claim?.id!=='ZUNGUN-CLOUDFLARE-PILOT-V0-ARQ-CLAIM-001'||current.claim?.status!=='ACTIVE'||current.claim?.role!=='ARQ'||current.claim?.executor!=='ARQ')fail('pilot claim');
if(current.claim?.autonomy!=='LONG_DEEP_AUTONOMOUS_WITHIN_WORKSET_SCOPE')fail('pilot autonomy');
if(current.baseline?.order_059_status!=='CLOSED_DO_NOT_REOPEN'||current.baseline?.order_060_corrected_head!=='d2404cf232976a8f39abb1171ead2ed1f63533fa'||current.baseline?.order_060_corrected_ci_conclusion!=='SUCCESS')fail('prior orders');
if(current.increment?.persistence!=='D1_ONLY'||current.increment?.authentication_binding_name!=='ZUNGUN_PILOT_TOKEN'||current.increment?.external_network!==false||current.increment?.end_user_delivery_claim!==false||current.increment?.remote_database_configured!==false)fail('pilot increment');
for(const key of ['write_authorized','cloudflare_write_authorized','deploy_authorized','release_authorized','production_change_authorized','secret_read_authorized','remote_d1_write_authorized','external_network_authorized'])if(current.platform?.[key]!==false)fail(`platform ${key}`);
if(current.platform?.local_d1_test_authorized!==true)fail('local D1 test not authorized');
if(release.status==='AUTHORIZED')fail('release unexpectedly authorized');
for(const value of Object.values(release.actions??{}))if(value!==false)fail('release action enabled');
if(checkpoint.schema_version!=='gaos-lean.checkpoint.v1'||checkpoint.checkpoint_id!==current.checkpoint.latest_id||checkpoint.workset_id!==current.workset.id)fail('checkpoint identity');
if(checkpoint.materialization?.mission_base_sha!==current.workset.mission_base_sha||checkpoint.materialization?.branch!==current.workset.implementation_branch)fail('checkpoint materialization');
for(const key of ['merge','deploy','release','production_change','cloudflare_write','secret_read','remote_d1_write'])if(checkpoint.boundaries?.[key]!==false)fail(`checkpoint boundary ${key}`);

const lines=fs.readFileSync(path.join(root,'ops/EVENTS.ndjson'),'utf8').trim().split('\n').filter(Boolean);
if(lines.length<12)fail('insufficient events');
const events=[];const ids=new Set();
for(const [index,line] of lines.entries()){
 let event;try{event=JSON.parse(line);}catch(error){fail(`event ${index+1}: ${error instanceof Error?error.message:String(error)}`);}
 const seq=index+1;if(event.schema_version!=='gaos-lean.event.v1'||event.seq!==seq||!Number.isInteger(event.seq))fail(`event ${seq} sequence`);
 if(typeof event.event_id!=='string'||ids.has(event.event_id))fail(`event ${seq} id`);
 if(!allowedEventTypes.has(event.type))fail(`event ${seq} type`);
 ids.add(event.event_id);events.push(event);
}
const closure=events.find((event)=>event.seq===10);
const opened=events.find((event)=>event.seq===11);
const claim=events.find((event)=>event.seq===12);
if(closure?.type!=='WORKSET_CLOSED'||closure.workset_id!=='ZUNGUN-ZEP-TEST-LOOPBACK-060'||closure.data?.corrected_head!=='d2404cf232976a8f39abb1171ead2ed1f63533fa'||closure.data?.cloudflare_write!==false)fail('Order 060 closure transition');
if(opened?.type!=='WORKSET_OPENED'||opened.workset_id!==current.workset.id||opened.actor!=='HUMAN_OWNER'||opened.data?.base_sha!==current.workset.mission_base_sha)fail('pilot WORKSET_OPENED');
if(claim?.type!=='CLAIM_ASSIGNED'||claim.workset_id!==current.workset.id||claim.data?.claim_id!==current.claim.id)fail('pilot CLAIM_ASSIGNED');

if(checkpoint.status==='IN_PROGRESS'){
 if(current.workset.phase!=='IMPLEMENTATION'||current.checkpoint.status!=='IN_PROGRESS'||current.checkpoint.audit_status!=='NOT_REQUESTED')fail('in-progress checkpoint state');
 if(current.next_action!=='IMPLEMENT_VERIFY_AND_REQUEST_SINGLE_FINAL_AUDIT')fail('in-progress next action');
 if(checkpoint.audit?.status!=='NOT_REQUESTED'||checkpoint.audit?.requested!==false)fail('premature audit');
 if(events.at(-1)?.seq!==12)fail('unexpected event after claim');
}else if(checkpoint.status==='PASS'){
 if(current.workset.phase!=='CHECKPOINT_READY'||current.checkpoint.status!=='PASS'||current.checkpoint.audit_status!=='READY_TO_REQUEST')fail('checkpoint-ready state');
 if(current.next_action!=='REQUEST_SINGLE_FINAL_AUDIT')fail('checkpoint next action');
 if(typeof checkpoint.materialization?.commit_sha!=='string'||typeof checkpoint.materialization?.tree_sha!=='string'||!Array.isArray(checkpoint.materialization?.changed_paths)||checkpoint.materialization.changed_paths.length<1)fail('checkpoint SHA materialization');
 for(const key of ['worker_implemed','zep_validation','d1_persistence','safe_lookup','atomic_acknowledgement','authoritative_processing_receipt','authentication'])if(checkpoint.functional?.[key]!==true)fail(`functional ${key}`);
 const actions=checkpoint.verification?.github_actions;if(actions?.conclusion!=='SUCCESS'||actions?.head_sha!==checkpoint.materialization.commit_sha||!Number.isInteger(actions?.run_id))fail('checkpoint CI');
 for(const name of ['control-plane-validate','typecheck-and-unit','d1-integration','security-and-fuzz','core-regression','wrangler-dry-run','pilot-gate'])if(actions?.jobs?.[name]?.conclusion!=='SUCCESS')fail(`checkpoint job ${name}`);
 if(checkpoint.audit?.status!=='READY_TO_REQUEST'||checkpoint.audit?.requested!==true||checkpoint.audit?.intermediate_audits!==0)fail('checkpoint audit state');
 const last=events.at(-1);if(last?.type!=='CHECKPOINT_REQUESTED'||last.workset_id!==current.workset.id||last.data?.checkpoint_id!==checkpoint.checkpoint_id||last.data?.requested_commit_sha!==checkpoint.materialization.commit_sha)fail('checkpoint request event');
}else fail('checkpoint status');

const policy=fs.readFileSync(path.join(root,'ops/POLICY.md'),'utf8');
for(const phrase of ['/ops/CURRENT.json','last 20','FAIL_CLOSED','Real remote HEAD'])if(!policy.includes(phrase))fail(`POLICY missing ${phrase}`);
console.log(JSON.stringify({ok:true,project:'ZUNGUN',workset:current.workset.id,phase:current.workset.phase,events:lines.length,checkpoint:checkpoint.checkpoint_id,checkpointStatus:checkpoint.status,releaseStatus:release.status,cloudflareWriteAuthorized:false,deployAuthorized:false}));
