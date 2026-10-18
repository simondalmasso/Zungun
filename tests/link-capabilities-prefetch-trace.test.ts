import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLinkTraceEvent,
  formatLinkTrace,
  localReceiverCapabilities,
  negotiateAssuranceTier,
  orderGoodLinkOpportunity,
  selectPrefetchHints,
  type DeliveryProfileV2,
  type LinkSnapshot,
} from '../packages/link-core/src/index.js';

const profile:DeliveryProfileV2={profileVersion:2,urgency:'HIGH',deadlineAtMs:10_000,expiresAtMs:20_000,maxDelayMs:1_000,retryContract:'RECONCILE_BEFORE_RETRY',idempotencyRequired:true,semanticRevalidationRequired:true,orderingKey:null,dependencies:[],payloadStrategy:'CORE_PLUS_DEFERRED',maxImmediateBytes:1024,allowMetered:false,allowRoaming:false,allowCongested:false,allowUnvalidated:false,heavyDataPolicy:'GOOD_LINK_ONLY',activeProbeBudgetBytes:0,transportAllowlist:['http'],receiptRequirement:'APPLICATION_OUTCOME',evidenceRequirement:'FULL_WITNESS'};
const snapshot:LinkSnapshot={snapshotId:'s1',observedAtMs:1000,maxAgeMs:5000,hasNetwork:true,internetCapable:true,validated:true,captivePortal:false,metered:false,temporarilyUnmetered:false,congested:false,roaming:false,vpn:false,suspended:false,downstreamKbps:1000,upstreamKbps:1000,transports:['WIFI'],networkKey:'net:1',recentRttMsEwma:null,recentFailureRateEwma:null,recentThroughputKbpsEwma:null};

test('receiver capability negotiation refuses silent assurance downgrade',()=>{
  const caps=localReceiverCapabilities(1000);
  assert.equal(negotiateAssuranceTier(caps,'L2_NATIVE_RECEIVER_EFFECT',1001),'L2_NATIVE_RECEIVER_EFFECT');
  const forged={...caps,supportsReconciliationQuery:false};
  assert.throws(()=>negotiateAssuranceTier(forged,'L2_NATIVE_RECEIVER_EFFECT',1001),/L2_INCONSISTENT|DOWNGRADE/);
});

test('prefetch is allowlisted budgeted revision-aware and deterministic',()=>{
  const result=selectPrefetchHints([
    {resourceKey:'map:2',revisionOrHash:'r2',sizeEstimate:400,expiresAtMs:5000,priority:'NORMAL',sensitivityClass:'INTERNAL',allowedOrigin:'https://assets.example.test'},
    {resourceKey:'map:1',revisionOrHash:'r1',sizeEstimate:300,expiresAtMs:5000,priority:'HIGH',sensitivityClass:'INTERNAL',allowedOrigin:'https://assets.example.test'},
    {resourceKey:'map:3',revisionOrHash:'r3',sizeEstimate:200,expiresAtMs:5000,priority:'BULK',sensitivityClass:'INTERNAL',allowedOrigin:'https://evil.example.test'},
  ],profile,snapshot,{remainingBytes:500,remainingObjects:2,allowedOrigins:['https://assets.example.test'],currentRevisionByResource:{}},1500);
  assert.deepEqual(result.selected.map((x)=>x.resourceKey),['map:1']);
  assert.deepEqual(result.rejected.map((x)=>[x.resourceKey,x.reason]),[['map:2','BUDGET_EXHAUSTED'],['map:3','ORIGIN_NOT_ALLOWED']]);
});

test('good-link opportunity preserves contract ordering',()=>{
  const ordered=orderGoodLinkOpportunity([
    {id:'prefetch',kind:'PREFETCH',deadlineAtMs:null,enqueuedAtMs:1},
    {id:'blob',kind:'DEFERRED',deadlineAtMs:null,enqueuedAtMs:1},
    {id:'required',kind:'REQUIRED_DEFERRED',deadlineAtMs:9000,enqueuedAtMs:1},
    {id:'query',kind:'RECONCILIATION',deadlineAtMs:null,enqueuedAtMs:1},
    {id:'critical',kind:'CRITICAL_OPERATION',deadlineAtMs:2000,enqueuedAtMs:1},
  ]);
  assert.deepEqual(ordered.map((x)=>x.id),['critical','query','required','blob','prefetch']);
});

test('Link Trace is deterministic and rejects credential-like diagnostics',()=>{
  const a=createLinkTraceEvent({atMs:1000,kind:'PLAN',state:'WAIT_FOR_VALIDATED_LINK',reasonCodes:['NETWORK_NOT_VALIDATED'],details:{plannedBytes:0}});
  const b=createLinkTraceEvent({atMs:2000,kind:'RECONCILIATION_STARTED',state:'UNKNOWN',reasonCodes:[],details:{attempt:1}});
  assert.match(formatLinkTrace([a,b]),/WAIT_FOR_VALIDATED_LINK/);
  assert.throws(()=>createLinkTraceEvent({atMs:1,kind:'PLAN',state:'X',reasonCodes:[],details:{authorization:'Bearer abc'}}),/SENSITIVE/);
});
