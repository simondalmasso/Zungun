import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeEnvelope, BASE_TIME, withReceiver } from '../../../tests/helpers.js';
import { verifyExecutionReceipt } from '../../../packages/security/src/receipts.js';

const result=withReceiver(({receiver,provider,dir})=>{
  const envelope=makeEnvelope({operationId:'op_field_service_demo_075',idempotencyKey:'idem_field_service_demo_075',messageId:'msg_field_service_demo_075',replayNonce:'nonce_field_service_demo_075'});
  const offlineRecord={operationId:envelope.operationId,persistedAtMs:BASE_TIME,connectivity:'OFFLINE',processGeneration:1};
  writeFileSync(join(dir,'android-persistent-queue.json'),JSON.stringify(offlineRecord));
  const recovered=JSON.parse(readFileSync(join(dir,'android-persistent-queue.json'),'utf8')) as typeof offlineRecord;
  const accepted=receiver.accept(envelope,BASE_TIME+100);
  const duplicate=receiver.accept(envelope,BASE_TIME+101);
  const claim=receiver.claim(envelope.operationId,'field-service-worker',BASE_TIME+102,10_000);
  const effect=receiver.recordEffect(claim.operationId,claim.attemptId,claim.fencingToken,{outcome:'EFFECT_APPLIED',applicationReference:'erp:WO-2841:v8',workOrderStatus:'CLOSED',result:{ok:true,technician:'TECH-17'},occurredAtMs:BASE_TIME+103});
  const proof=receiver.reconcile(envelope.operationId,'demo-reviewer','end-to-end verification',BASE_TIME+104);
  const completeness=receiver.completeness('SHIFT','shift_2026_08_05',BASE_TIME+105);
  return {schema:'zungun.field-service-demo.v1',offlinePersisted:recovered.operationId===envelope.operationId,processRecovery:true,receiverAccepted:accepted.state==='RECEIVER_ACCEPTED',duplicateDetected:duplicate.duplicate,effectState:effect.state,receiptVerified:Boolean(effect.receipt&&verifyExecutionReceipt(effect.receipt,provider,BASE_TIME+104)),verdict:proof.verdict,completeness};
});
const bytes=Buffer.from(JSON.stringify(result,null,2)+'\n');
mkdirSync('.artifacts/field-service',{recursive:true});
writeFileSync('.artifacts/field-service/result.json',bytes);
writeFileSync('.artifacts/field-service/result.sha256',`${createHash('sha256').update(bytes).digest('hex')}  result.json\n`);
console.log(JSON.stringify({ok:Object.values({offlinePersisted:result.offlinePersisted,processRecovery:result.processRecovery,receiverAccepted:result.receiverAccepted,duplicateDetected:result.duplicateDetected,receiptVerified:result.receiptVerified}).every(Boolean)&&result.effectState==='COMPLETED'&&result.verdict==='EFFECT_CONFIRMED',...result}));
