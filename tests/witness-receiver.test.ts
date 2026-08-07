import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryReceiptKeyProvider } from '../packages/security/src/receipts.js';
import { appendWitnessEvidence, type WitnessEvidence } from '../packages/protocol-core/src/witness.js';
import { ReceiverDatabase } from '../services/receiver/src/database.js';
import { PersistentReceiver } from '../services/receiver/src/receiver.js';
import { WitnessReceiver } from '../services/receiver/src/witness.js';
import { BASE_TIME, makeEnvelope } from './helpers.js';

function sender(id:string): WitnessEvidence[] { const c:WitnessEvidence[]=[]; const add=(x:Parameters<typeof appendWitnessEvidence>[1])=>c.push(appendWitnessEvidence(c,x)); add({incidentId:id,evidenceId:`${id}:d`,state:'DETECTED',evidenceClass:'OBSERVED_FACT',emitterId:'sensor:1',authorizationScope:'witness:source',observedAtMs:BASE_TIME,monotonicMs:1,provenance:'sensor:test',reasonCode:'SOURCE_DETECTED',claims:{boundaryRole:'SENSOR_OR_SOURCE',sourceId:'sensor:1'}}); add({incidentId:id,evidenceId:`${id}:c`,state:'COMMITTED_LOCAL',evidenceClass:'MACHINE_ASSERTION',emitterId:'device:1',authorizationScope:'witness:local',observedAtMs:BASE_TIME+1,monotonicMs:2,provenance:'android:room',reasonCode:'LOCAL_DURABLE_COMMIT',claims:{boundaryRole:'ZUNGUN_WITNESS',localCommitRef:'room:1'}}); add({incidentId:id,evidenceId:`${id}:t`,state:'CUSTODY_ACCEPTED',evidenceClass:'MACHINE_ASSERTION',emitterId:'transport:1',authorizationScope:'witness:transport',observedAtMs:BASE_TIME+2,monotonicMs:3,provenance:'transport:test',reasonCode:'TRANSPORT_CUSTODY',claims:{boundaryRole:'TRANSPORT',transportKind:'HTTP_WEBHOOK',routeId:'receiver:http',custodyRef:'http:1'}}); return c; }

test('receiver persists sender chain and appends durable evidence transactionally and idempotently',()=>{
  const dir=mkdtempSync(join(tmpdir(),'witness-receiver-')); const path=join(dir,'db.sqlite');
  let db=new ReceiverDatabase(path); const provider=new InMemoryReceiptKeyProvider(BASE_TIME-1000); let receiver=new PersistentReceiver(db,provider,'receiver_test'); let witness=new WitnessReceiver(db,'receiver_test');
  const env=makeEnvelope(); receiver.accept(env,BASE_TIME+10); const s=sender(env.operationId); const first=witness.ingestSender(env.operationId,s,BASE_TIME+11); assert.equal(first.at(-1)?.state,'DELIVERED_DURABLY'); assert.equal(first.length,4); const second=witness.ingestSender(env.operationId,s,BASE_TIME+12); assert.deepEqual(second.map(x=>x.evidenceHash),first.map(x=>x.evidenceHash)); db.close();
  db=new ReceiverDatabase(path); db.migrate(); witness=new WitnessReceiver(db,'receiver_test'); assert.deepEqual(witness.chain(env.operationId).map(x=>x.evidenceHash),first.map(x=>x.evidenceHash)); db.close(); rmSync(dir,{recursive:true,force:true});
});

test('receiver rejects divergent sender history and reserved forged durability',()=>{
  const dir=mkdtempSync(join(tmpdir(),'witness-receiver-')); const db=new ReceiverDatabase(join(dir,'db.sqlite')); const receiver=new PersistentReceiver(db,new InMemoryReceiptKeyProvider(BASE_TIME-1000),'receiver_test'); const witness=new WitnessReceiver(db,'receiver_test'); const env=makeEnvelope(); receiver.accept(env,BASE_TIME+10); const s=sender(env.operationId); witness.ingestSender(env.operationId,s,BASE_TIME+11); const changed=s.map((x,i)=>i===2?{...x,evidenceHash:'sha256:'+'0'.repeat(64)}:x) as WitnessEvidence[]; assert.throws(()=>witness.ingestSender(env.operationId,changed,BASE_TIME+12),/WITNESS_CHAIN_TAMPERED/); assert.throws(()=>witness.attest(env.operationId,{incidentId:env.operationId,evidenceId:'forged',state:'DELIVERED_DURABLY',evidenceClass:'MACHINE_ASSERTION',emitterId:'responder:1',authorizationScope:'witness:attest',observedAtMs:BASE_TIME+20,monotonicMs:20,provenance:'responder:test',reasonCode:'FORGED',claims:{boundaryRole:'RECEIVER',receiverId:'x',durableReceiptRef:'x'}},'actor',BASE_TIME+20),/WITNESS_RESERVED_TRANSITION/); db.close(); rmSync(dir,{recursive:true,force:true});
});
