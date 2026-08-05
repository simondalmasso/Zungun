import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deterministicScenarios } from './scenarios.js';
import { canonicalize } from '../../../packages/protocol-core/src/canonical.js';
import { evidenceHash } from '../../../services/receiver/src/database.js';
import { makeEnvelope, BASE_TIME, withReceiver } from '../../../tests/helpers.js';

export interface ScenarioResult { readonly name:string; readonly seed:number; readonly passed:boolean; readonly expectedVerdict:string; readonly observedVerdict:string; readonly attempts:number; readonly detail:string; }

function runScenario(name: string, seed: number): ScenarioResult {
  const scenario=deterministicScenarios(BASE_TIME).find((candidate)=>candidate.name===name && candidate.seed===seed);
  if(!scenario) throw new Error('SCENARIO_NOT_FOUND');
  return withReceiver(({receiver})=>{
    const envelope=scenario.mutation(makeEnvelope({operationId:`op_resilience_${seed}`,idempotencyKey:`idem_resilience_${seed}`,messageId:`msg_resilience_${seed}`,replayNonce:`nonce_resilience_${seed}`,workOrderId:`WO-${seed}`}));
    try {
      let acceptance: ReturnType<typeof receiver.accept> | null=null;
      for(let index=0;index<scenario.transportAttempts;index+=1) acceptance=receiver.accept(envelope,BASE_TIME+10+index);
      if(!scenario.effect) return {name,seed,passed:false,expectedVerdict:scenario.expectedVerdict,observedVerdict:'ACCEPTED',attempts:scenario.transportAttempts,detail:'scenario expected validation failure'};
      const claim=receiver.claim(acceptance!.operationId,'resilience-worker',BASE_TIME+30,10_000);
      if(name==='lease_loss') receiver.recordEffect(claim.operationId,claim.attemptId,claim.fencingToken+1,scenario.effect);
      else receiver.recordEffect(claim.operationId,claim.attemptId,claim.fencingToken,scenario.effect);
      if(name==='database_erp_mismatch'||name==='reconciliation_contradiction') {
        for(const [index,kind] of ['EFFECT_APPLIED','NO_EFFECT'].entries()) {
          const payload={source:'ERP',kind,occurredAtMs:BASE_TIME+200+index,reference:`erp:${kind}`,payload:{scenario:name}};
          receiver.database.db.prepare('INSERT INTO evidence(operation_id,source,kind,occurred_at_ms,reference,payload_json,evidence_sha256) VALUES(?,?,?,?,?,?,?)').run(claim.operationId,'ERP',kind,payload.occurredAtMs,payload.reference,canonicalize(payload.payload),evidenceHash(payload));
        }
      }
      const reconciliation=receiver.reconcile(claim.operationId,'resilience-lab',name,BASE_TIME+1000);
      const observedVerdict=reconciliation.verdict;
      const normalizedExpected=scenario.expectedVerdict==='REJECTED'?'NO_EFFECT_CONFIRMED':scenario.expectedVerdict;
      const passed=observedVerdict===normalizedExpected || (scenario.expectedVerdict==='UNKNOWN'&&observedVerdict==='UNKNOWN');
      return {name,seed,passed,expectedVerdict:scenario.expectedVerdict,observedVerdict,attempts:scenario.transportAttempts,detail:passed?'deterministic gate passed':'verdict mismatch'};
    } catch(error) {
      const detail=error instanceof Error?error.message:String(error);
      const passed=Boolean(scenario.expectedFailure && detail.includes(scenario.expectedFailure));
      return {name,seed,passed,expectedVerdict:scenario.expectedVerdict,observedVerdict:passed?'REJECTED':'ERROR',attempts:scenario.transportAttempts,detail};
    }
  });
}

const results=deterministicScenarios(BASE_TIME).map((scenario)=>runScenario(scenario.name,scenario.seed));
const passed=results.filter((result)=>result.passed).length;
const report={schema:'zungun.resilience-report.v1',baseTimeMs:BASE_TIME,scenarioCount:results.length,passed,failed:results.length-passed,results};
const bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');
mkdirSync('.artifacts/resilience',{recursive:true});
writeFileSync('.artifacts/resilience/report.json',bytes);
writeFileSync('.artifacts/resilience/report.sha256',`${createHash('sha256').update(bytes).digest('hex')}  report.json\n`);
console.log(JSON.stringify({ok:passed===results.length,scenarioCount:results.length,passed,failed:results.length-passed,seeds:results.map((result)=>result.seed)}));
if(passed!==results.length) process.exitCode=1;
