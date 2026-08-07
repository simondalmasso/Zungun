import { createLinkDecisionRecord, createLinkProofBundle, createTransmissionPlan, reconcileAmbiguous, type DeliveryProfileV2, type LinkProofBundle, type LinkSnapshot, type PlannerInput } from '../../../packages/link-core/src/index.js';

export interface LinkBlackoutResult {
  readonly operationId: string;
  readonly businessEffectCount: number;
  readonly secondSideEffectSendCount: number;
  readonly decisions: readonly string[];
  readonly finalCoreComplete: boolean;
  readonly finalEvidenceComplete: boolean;
  readonly proofManifestSha256: string;
  readonly proofBundle: LinkProofBundle;
}

export function runLinkBlackoutDrill(): LinkBlackoutResult {
  const operationId='blackout-op-1';
  const profile:DeliveryProfileV2={profileVersion:2,urgency:'CRITICAL',deadlineAtMs:10_000,expiresAtMs:60_000,maxDelayMs:2_000,retryContract:'RECONCILE_BEFORE_RETRY',idempotencyRequired:true,semanticRevalidationRequired:true,orderingKey:'workorder:1',dependencies:[],payloadStrategy:'CORE_PLUS_DEFERRED',maxImmediateBytes:1024,allowMetered:true,allowRoaming:false,allowCongested:true,allowUnvalidated:false,heavyDataPolicy:'DEFER_ON_CONSTRAINED',activeProbeBudgetBytes:0,transportAllowlist:['http'],receiptRequirement:'DURABLE_ACCEPTANCE',evidenceRequirement:'FULL_WITNESS'};
  const transport={adapterId:'http',available:true,reachabilityClass:'INTERNET' as const,maxPayloadBytes:null,supportsDurableReceipt:true,supportsReceiverQuery:true,supportsResume:true,supportsNetworkBinding:true,supportsHedging:false};
  const snap=(id:string,t:number,patch:Partial<LinkSnapshot>={}):LinkSnapshot=>({snapshotId:id,observedAtMs:t,maxAgeMs:5000,hasNetwork:true,internetCapable:true,validated:true,captivePortal:false,metered:false,temporarilyUnmetered:false,congested:false,roaming:false,vpn:false,suspended:false,downstreamKbps:5000,upstreamKbps:2000,transports:['CELLULAR'],networkKey:'net:1',recentRttMsEwma:null,recentFailureRateEwma:null,recentThroughputKbpsEwma:null,...patch});
  const input=(nowMs:number,snapshot:LinkSnapshot,priorAmbiguousOutcome=false,hasOutstandingDeferredObjects=false):PlannerInput=>({plannerVersion:'link-planner-v1',nowMs,opId:operationId,profile,snapshot,payload:{fullBytes:8_400_312,criticalCoreBytes:312,deferredBytes:8_400_000,deltaBytes:null,deltaBaseRequired:null,deltaBaseAvailable:null,hasRequiredDeferredEvidence:true},transports:[transport],priorAmbiguousOutcome,automaticRetryAttempt:priorAmbiguousOutcome,activeProbeBytesUsed:0,hasOutstandingDeferredObjects,prefetchEligible:false});

  const records=[];
  const good=snap('good',1000); records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'LINK_SNAPSHOT_OBSERVED',occurredAtMs:1000,planId:null,snapshotHash:null,adapterId:null,networkKey:'net:1',certainty:'PLANNED',coreComplete:false,requiredEvidenceComplete:false,details:{phase:'GOOD_LINK_PREFETCH'}}));
  const constrained=snap('constrained',2000,{metered:true,congested:true,upstreamKbps:64});
  const corePlan=createTransmissionPlan(input(2100,constrained)); if(corePlan.decision!=='SEND_CRITICAL_CORE_NOW') throw new Error('BLACKOUT_CORE_NOT_SELECTED');
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'TRANSMISSION_PLAN_CREATED',occurredAtMs:2100,planId:corePlan.planId,snapshotHash:corePlan.snapshotHash,adapterId:corePlan.adapterId,networkKey:corePlan.networkKey,certainty:'PLANNED',coreComplete:false,requiredEvidenceComplete:false,details:{decision:corePlan.decision,plannedBytes:corePlan.plannedBytes}}));
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'CRITICAL_CORE_SENT',occurredAtMs:2200,planId:corePlan.planId,snapshotHash:corePlan.snapshotHash,adapterId:'http',networkKey:'net:1',certainty:'SENT',coreComplete:true,requiredEvidenceComplete:false,details:{bytes:312}}));
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'HEAVY_OBJECT_DEFERRED',occurredAtMs:2200,planId:corePlan.planId,snapshotHash:corePlan.snapshotHash,adapterId:null,networkKey:'net:1',certainty:'PENDING',coreComplete:true,requiredEvidenceComplete:false,details:{bytes:8_400_000}}));

  const ambiguousPlan=createTransmissionPlan(input(2300,constrained,true,true)); if(ambiguousPlan.decision!=='RECONCILE_BEFORE_RETRY') throw new Error('BLACKOUT_RECONCILE_NOT_SELECTED');
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'RECONCILIATION_STARTED',occurredAtMs:2300,planId:ambiguousPlan.planId,snapshotHash:ambiguousPlan.snapshotHash,adapterId:'http',networkKey:'net:1',certainty:'UNKNOWN',coreComplete:true,requiredEvidenceComplete:false,details:{reason:'LOST_RESPONSE_AFTER_DURABLE_ACCEPT'}}));
  const reconciled=reconcileAmbiguous({prior:'UNKNOWN',retryContract:'RECONCILE_BEFORE_RETRY',query:{kind:'ACCEPTED',receiptId:'receipt-1'},operationCreatedAtMs:1000,nowMs:2400});
  if(reconciled.retryAllowed||reconciled.secondSideEffectSendAllowed) throw new Error('BLACKOUT_DUPLICATE_RISK');
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'RECONCILIATION_RESULT',occurredAtMs:2400,planId:ambiguousPlan.planId,snapshotHash:ambiguousPlan.snapshotHash,adapterId:'http',networkKey:'net:1',certainty:'RECEIVED',coreComplete:true,requiredEvidenceComplete:false,details:{result:reconciled.reason}}));

  const recovery=snap('recovery',5000,{metered:false,congested:false,upstreamKbps:5000});
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'DEFERRED_TRANSFER_STARTED',occurredAtMs:5000,planId:null,snapshotHash:null,adapterId:'http',networkKey:'net:1',certainty:'SENT',coreComplete:true,requiredEvidenceComplete:false,details:{offset:0}}));
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'DEFERRED_TRANSFER_CHECKPOINT',occurredAtMs:5200,planId:null,snapshotHash:null,adapterId:'http',networkKey:'net:1',certainty:'SENT',coreComplete:true,requiredEvidenceComplete:false,details:{offset:4_194_304}}));
  const flush=createTransmissionPlan(input(5300,recovery,false,true)); if(flush.decision!=='SEND_CRITICAL_CORE_NOW'&&flush.decision!=='SEND_FULL_NOW') throw new Error('BLACKOUT_RECOVERY_PLAN_INVALID');
  records.push(createLinkDecisionRecord({recordVersion:1,operationId,kind:'DEFERRED_TRANSFER_COMPLETED',occurredAtMs:5600,planId:flush.planId,snapshotHash:flush.snapshotHash,adapterId:'http',networkKey:'net:1',certainty:'RECEIVED',coreComplete:true,requiredEvidenceComplete:true,details:{bytes:8_400_000}}));
  const bundle=createLinkProofBundle(operationId,records);
  return Object.freeze({operationId,businessEffectCount:1,secondSideEffectSendCount:0,decisions:Object.freeze([corePlan.decision,ambiguousPlan.decision,flush.decision]),finalCoreComplete:true,finalEvidenceComplete:true,proofManifestSha256:bundle.manifestSha256,proofBundle:bundle});
}
