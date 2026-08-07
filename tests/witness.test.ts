import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WITNESS_TRANSPORTS,
  appendWitnessEvidence,
  buildIncidentProofBundle,
  reconcileWitnessHistories,
  redactIncidentProofBundle,
  verifyIncidentProofBundle,
  verifyWitnessChain,
  type WitnessEvidence,
} from '../packages/protocol-core/src/witness.js';

function sender(incidentId='op_witness_1'): WitnessEvidence[] {
  const chain: WitnessEvidence[] = [];
  const add=(input: Parameters<typeof appendWitnessEvidence>[1])=>chain.push(appendWitnessEvidence(chain,input));
  add({incidentId,evidenceId:'ev_detect',state:'DETECTED',evidenceClass:'OBSERVED_FACT',emitterId:'sensor:1',authorizationScope:'witness:source',observedAtMs:1000,monotonicMs:1,provenance:'sensor:test',reasonCode:'SOURCE_DETECTED',claims:{boundaryRole:'SENSOR_OR_SOURCE',sourceId:'sensor:1'}});
  add({incidentId,evidenceId:'ev_commit',state:'COMMITTED_LOCAL',evidenceClass:'MACHINE_ASSERTION',emitterId:'device:1',authorizationScope:'witness:local',observedAtMs:1001,monotonicMs:2,provenance:'android:room',reasonCode:'LOCAL_DURABLE_COMMIT',claims:{boundaryRole:'ZUNGUN_WITNESS',localCommitRef:'room:1'}});
  add({incidentId,evidenceId:'ev_custody',state:'CUSTODY_ACCEPTED',evidenceClass:'MACHINE_ASSERTION',emitterId:'transport:1',authorizationScope:'witness:transport',observedAtMs:1002,monotonicMs:3,provenance:'transport:test',reasonCode:'TRANSPORT_CUSTODY',claims:{boundaryRole:'TRANSPORT',transportKind:'STORE_FORWARD',routeId:'route:1',custodyRef:'custody:1'}});
  return chain;
}

function delivered(base=sender()): WitnessEvidence[] {
  const durable=appendWitnessEvidence(base,{incidentId:base[0]!.incidentId,evidenceId:'ev_durable',state:'DELIVERED_DURABLY',evidenceClass:'MACHINE_ASSERTION',emitterId:'receiver:1',authorizationScope:'witness:receiver',observedAtMs:1003,monotonicMs:4,provenance:'receiver:sqlite',reasonCode:'RECEIVER_DURABLE_COMMIT',claims:{boundaryRole:'RECEIVER',receiverId:'receiver:1',durableReceiptRef:'sqlite:1'}});
  return [...base,durable];
}

test('witness chain enforces state, trust-boundary and hash semantics',()=>{
  const chain=delivered();
  assert.deepEqual(verifyWitnessChain(chain),{ok:true,state:'DELIVERED_DURABLY'});
  assert.throws(()=>appendWitnessEvidence(sender(),{incidentId:'op_witness_1',evidenceId:'forged',state:'DELIVERED_DURABLY',evidenceClass:'MACHINE_ASSERTION',emitterId:'transport:1',authorizationScope:'witness:receiver',observedAtMs:1003,monotonicMs:4,provenance:'transport:test',reasonCode:'FORGED_DURABLE',claims:{boundaryRole:'TRANSPORT',receiverId:'receiver:1',durableReceiptRef:'fake'}}),/WITNESS_BOUNDARY_RECEIVER_REQUIRED/);
  const tampered=chain.map((item,index)=>index===1?{...item,reasonCode:'ALTERED'}:item) as WitnessEvidence[];
  assert.throws(()=>verifyWitnessChain(tampered),/WITNESS_CHAIN_TAMPERED/);
});

test('resolution requires ownership, action and condition recheck path',()=>{
  let chain=delivered();
  const own=appendWitnessEvidence(chain,{incidentId:'op_witness_1',evidenceId:'own',state:'OWNED_BY_RESPONDER',evidenceClass:'HUMAN_ATTESTATION',emitterId:'responder:1',authorizationScope:'witness:attest',observedAtMs:1004,monotonicMs:5,provenance:'responder:test',reasonCode:'RESPONDER_OWNED',claims:{boundaryRole:'RESPONDER',responderId:'r1',ownershipRef:'ack:1'}}); chain=[...chain,own];
  const action=appendWitnessEvidence(chain,{incidentId:'op_witness_1',evidenceId:'act',state:'ACTION_STARTED',evidenceClass:'HUMAN_ATTESTATION',emitterId:'responder:1',authorizationScope:'witness:attest',observedAtMs:1005,monotonicMs:6,provenance:'responder:test',reasonCode:'ACTION_STARTED',claims:{boundaryRole:'RESPONDER',actionRef:'action:1'}}); chain=[...chain,action];
  assert.throws(()=>appendWitnessEvidence(chain,{incidentId:'op_witness_1',evidenceId:'bad-resolve',state:'RESOLVED',evidenceClass:'HUMAN_ATTESTATION',emitterId:'responder:1',authorizationScope:'witness:attest',observedAtMs:1006,monotonicMs:7,provenance:'responder:test',reasonCode:'RESOLVED',claims:{boundaryRole:'RESPONDER',resolutionRef:'resolution:1'}}),/WITNESS_INVALID_STATE_TRANSITION|WITNESS_RESOLUTION_REQUIRES_RECHECK/);
  const recheck=appendWitnessEvidence(chain,{incidentId:'op_witness_1',evidenceId:'check',state:'CONDITION_RECHECKED',evidenceClass:'OBSERVED_FACT',emitterId:'sensor:1',authorizationScope:'witness:attest',observedAtMs:1006,monotonicMs:7,provenance:'sensor:test',reasonCode:'CONDITION_RECHECKED',claims:{boundaryRole:'SENSOR_OR_SOURCE',recheckRef:'check:1',conditionStatus:'CLEARED'}}); chain=[...chain,recheck];
  const resolved=appendWitnessEvidence(chain,{incidentId:'op_witness_1',evidenceId:'resolve',state:'RESOLVED',evidenceClass:'HUMAN_ATTESTATION',emitterId:'responder:1',authorizationScope:'witness:attest',observedAtMs:1007,monotonicMs:8,provenance:'responder:test',reasonCode:'RESOLVED',claims:{boundaryRole:'RESPONDER',resolutionRef:'resolution:1'}}); chain=[...chain,resolved];
  assert.equal(verifyWitnessChain(chain).state,'RESOLVED');
});

test('sender/receiver reconciliation preserves conflict and recovers lost durable response',()=>{
  const s=sender(); const r=delivered(s);
  assert.equal(reconcileWitnessHistories(s,r).code,'RECEIVER_DURABLE_EVIDENCE_RECOVERED');
  const other=sender('op_witness_1');
  other[1]={...other[1]!,evidenceId:'different'} as WitnessEvidence;
  assert.throws(()=>reconcileWitnessHistories(other,r),/WITNESS_CHAIN_TAMPERED/);
});

test('proof bundle verifies offline, detects tamper, and binds redaction markers',()=>{
  const bundle=buildIncidentProofBundle(delivered());
  assert.equal(verifyIncidentProofBundle(bundle).finalState,'DELIVERED_DURABLY');
  const redacted=redactIncidentProofBundle(bundle,['human-report.txt'],'PRIVACY_REDACTION');
  assert.equal(verifyIncidentProofBundle(redacted).ok,true);
  const changed={...bundle,files:bundle.files.map((file)=>file.path==='human-report.txt'?{...file,content:file.content+'x'}:file)};
  assert.throws(()=>verifyIncidentProofBundle(changed),/BUNDLE_OBJECT_TAMPERED/);
});

test('transport taxonomy preserves vendor-neutral custody boundaries',()=>{
  const hashes=new Set<string>();
  WITNESS_TRANSPORTS.forEach((transportKind,index)=>{
    const incidentId=`op_transport_${index}`;
    const chain:WitnessEvidence[]=[];
    chain.push(appendWitnessEvidence(chain,{incidentId,evidenceId:`detect-${index}`,state:'DETECTED',evidenceClass:'OBSERVED_FACT',emitterId:`sensor:${index}`,authorizationScope:'witness:source',observedAtMs:2000+index*10,monotonicMs:1,provenance:'sensor:matrix',reasonCode:'MATRIX_DETECTED',claims:{boundaryRole:'SENSOR_OR_SOURCE',sourceId:`sensor:${index}`}}));
    chain.push(appendWitnessEvidence(chain,{incidentId,evidenceId:`commit-${index}`,state:'COMMITTED_LOCAL',evidenceClass:'MACHINE_ASSERTION',emitterId:`device:${index}`,authorizationScope:'witness:local',observedAtMs:2001+index*10,monotonicMs:2,provenance:'android:room',reasonCode:'MATRIX_LOCAL_COMMIT',claims:{boundaryRole:'ZUNGUN_WITNESS',localCommitRef:`room:${index}`}}));
    const custody=appendWitnessEvidence(chain,{incidentId,evidenceId:`custody-${index}`,state:'CUSTODY_ACCEPTED',evidenceClass:'MACHINE_ASSERTION',emitterId:`transport:vendor-${index}`,authorizationScope:'witness:transport',observedAtMs:2002+index*10,monotonicMs:3,provenance:`vendor:${index}`,reasonCode:'MATRIX_TRANSPORT_CUSTODY',claims:{boundaryRole:'TRANSPORT',transportKind,routeId:`vendor-${index}:route`,custodyRef:`vendor-${index}:custody`}});
    assert.equal(custody.state,'CUSTODY_ACCEPTED');
    assert.equal(custody.claims.boundaryRole,'TRANSPORT');
    assert.equal(custody.claims.transportKind,transportKind);
    hashes.add(custody.evidenceHash);
  });
  assert.equal(hashes.size,WITNESS_TRANSPORTS.length);
});
