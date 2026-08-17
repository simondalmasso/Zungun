import type { DeliveryProfileV2, LinkSnapshot, PlanDecision } from '../../../packages/link-core/src/index.js';

export type LinkScenarioFamily =
  | 'CONNECTIVITY'
  | 'QUALITY'
  | 'PLANNING'
  | 'AMBIGUITY'
  | 'DELTA'
  | 'DEFERRED'
  | 'PREFETCH'
  | 'SCHEDULER'
  | 'SECURITY';

export interface LinkTimelinePoint {
  readonly atMs: number;
  readonly snapshot: LinkSnapshot;
}

export interface LinkScenarioExpectation {
  readonly name: string;
  readonly family: LinkScenarioFamily;
  readonly seed: number;
  readonly profile: DeliveryProfileV2;
  readonly linkTimeline: readonly LinkTimelinePoint[];
  readonly injectedFaults: readonly string[];
  readonly expectedPlans: readonly PlanDecision[];
  readonly expectedTransportAttemptCount: number | null;
  readonly expectedReceiverEffectCount: 0 | 1;
  readonly expectedFinalState: string;
  readonly expectedDeferredState: string;
  readonly expectedWitnessEvidence: readonly string[];
  readonly expectedReasonCodes: readonly string[];
}

const BASE_PROFILE: DeliveryProfileV2 = Object.freeze({
  profileVersion: 2,
  urgency: 'NORMAL',
  deadlineAtMs: null,
  expiresAtMs: 100_000,
  maxDelayMs: 5_000,
  retryContract: 'SAFE_IDEMPOTENT',
  idempotencyRequired: true,
  semanticRevalidationRequired: true,
  orderingKey: null,
  dependencies: Object.freeze([]),
  payloadStrategy: 'FULL_ONLY',
  maxImmediateBytes: 1_024,
  allowMetered: false,
  allowRoaming: false,
  allowCongested: false,
  allowUnvalidated: false,
  heavyDataPolicy: 'DEFER_ON_CONSTRAINED',
  activeProbeBudgetBytes: 0,
  transportAllowlist: Object.freeze(['http']),
  receiptRequirement: 'DURABLE_ACCEPTANCE',
  evidenceRequirement: 'LINK_DECISION_RECORD',
});

const BASE_SNAPSHOT: LinkSnapshot = Object.freeze({
  snapshotId: 'scenario-base',
  observedAtMs: 10_000,
  maxAgeMs: 60_000,
  hasNetwork: true,
  internetCapable: true,
  validated: true,
  captivePortal: false,
  metered: false,
  temporarilyUnmetered: false,
  congested: false,
  roaming: false,
  vpn: false,
  suspended: false,
  downstreamKbps: 10_000,
  upstreamKbps: 5_000,
  transports: Object.freeze(['WIFI']),
  networkKey: 'net:scenario',
  recentRttMsEwma: 30,
  recentFailureRateEwma: 0,
  recentThroughputKbpsEwma: 4_000,
});

interface ScenarioOptions {
  readonly profile?: Partial<DeliveryProfileV2>;
  readonly timeline?: readonly Partial<LinkSnapshot>[];
  readonly injectedFaults?: readonly string[];
  readonly expectedPlans?: readonly PlanDecision[];
  readonly expectedTransportAttemptCount?: number | null;
  readonly expectedReceiverEffectCount?: 0 | 1;
  readonly expectedDeferredState?: string;
  readonly expectedWitnessEvidence?: readonly string[];
  readonly expectedReasonCodes?: readonly string[];
}

function stableSeed(name: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    value ^= name.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

function timeline(name: string, patches: readonly Partial<LinkSnapshot>[] | undefined): readonly LinkTimelinePoint[] {
  const source = patches && patches.length > 0 ? patches : [{}];
  return Object.freeze(source.map((patch, index) => {
    const atMs = patch.observedAtMs ?? BASE_SNAPSHOT.observedAtMs + index * 1_000;
    return Object.freeze({
      atMs,
      snapshot: Object.freeze({
        ...BASE_SNAPSHOT,
        ...patch,
        snapshotId: patch.snapshotId ?? `${name}-${index}`,
        observedAtMs: atMs,
      }),
    });
  }));
}

function inferredDeferredState(finalState: string): string {
  if (finalState === 'DEFERRED' || finalState === 'PENDING' || finalState === 'FULL_OR_DEFER') return 'PENDING';
  if (finalState === 'CHECKPOINTED') return 'CHECKPOINTED';
  if (finalState === 'RESUMED' || finalState === 'BULK_PROGRESS') return 'IN_PROGRESS';
  if (finalState === 'COMPLETED') return 'COMPLETED';
  if (finalState === 'HEAVY_SYNC_EXPIRED') return 'EXPIRED';
  if (finalState === 'OPTIONAL_DROPPED') return 'DROPPED';
  if (finalState === 'CORE_SENT') return 'PENDING';
  if (finalState === 'DURABLE_WAIT' || finalState === 'RECOVERED') return 'PENDING';
  return 'NONE';
}

function scenario(
  name: string,
  family: LinkScenarioFamily,
  expectedFinalState: string,
  options: ScenarioOptions = {},
): LinkScenarioExpectation {
  const profile = Object.freeze({
    ...BASE_PROFILE,
    ...options.profile,
    dependencies: Object.freeze([...(options.profile?.dependencies ?? BASE_PROFILE.dependencies)]),
    transportAllowlist: Object.freeze([...(options.profile?.transportAllowlist ?? BASE_PROFILE.transportAllowlist)]),
  });
  return Object.freeze({
    name,
    family,
    seed: stableSeed(name),
    profile,
    linkTimeline: timeline(name, options.timeline),
    injectedFaults: Object.freeze([...(options.injectedFaults ?? [])]),
    expectedPlans: Object.freeze([...(options.expectedPlans ?? [])]),
    expectedTransportAttemptCount: options.expectedTransportAttemptCount ?? null,
    expectedReceiverEffectCount: options.expectedReceiverEffectCount ?? 0,
    expectedFinalState,
    expectedDeferredState: options.expectedDeferredState ?? inferredDeferredState(expectedFinalState),
    expectedWitnessEvidence: Object.freeze([...(options.expectedWitnessEvidence ?? [])]),
    expectedReasonCodes: Object.freeze([...(options.expectedReasonCodes ?? [])]),
  });
}

export const LINK_SCENARIOS: readonly LinkScenarioExpectation[] = Object.freeze([
  scenario('connected_not_validated','CONNECTIVITY','WAITING',{timeline:[{validated:false}],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED'],expectedReasonCodes:['NETWORK_NOT_VALIDATED']}),
  scenario('captive_portal','CONNECTIVITY','WAITING',{timeline:[{captivePortal:true}],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('validated_then_lost','CONNECTIVITY','WAITING',{timeline:[{validated:true},{hasNetwork:false,internetCapable:false,validated:false}],expectedPlans:['SEND_FULL_NOW','WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('metered_to_unmetered','CONNECTIVITY','ELIGIBLE',{timeline:[{metered:true},{metered:false,temporarilyUnmetered:true}],expectedPlans:['WAIT_FOR_VALIDATED_LINK','SEND_FULL_NOW'],expectedWitnessEvidence:['PATH_CHANGED']}),
  scenario('unmetered_to_metered','CONNECTIVITY','POLICY_REEVALUATED',{timeline:[{metered:false},{metered:true}],expectedPlans:['SEND_FULL_NOW','WAIT_FOR_VALIDATED_LINK'],expectedWitnessEvidence:['PATH_CHANGED']}),
  scenario('congested_link','CONNECTIVITY','DEFERRED',{profile:{urgency:'BULK'},timeline:[{congested:true,upstreamKbps:16}],expectedPlans:['DEFER_HEAVY'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['HEAVY_OBJECT_DEFERRED']}),
  scenario('roaming_policy_denied','CONNECTIVITY','WAITING',{timeline:[{roaming:true}],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('vpn_transition','CONNECTIVITY','POLICY_REEVALUATED',{timeline:[{vpn:false},{vpn:true,networkKey:'net:vpn'}],expectedPlans:['SEND_FULL_NOW','SEND_FULL_NOW'],expectedWitnessEvidence:['PATH_CHANGED']}),
  scenario('stale_snapshot','CONNECTIVITY','WAITING',{timeline:[{observedAtMs:1,maxAgeMs:100}],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED'],expectedReasonCodes:['STALE_LINK_SNAPSHOT']}),

  scenario('bandwidth_collapse','QUALITY','DEFERRED',{profile:{urgency:'BULK'},timeline:[{congested:true,upstreamKbps:16}],expectedPlans:['DEFER_HEAVY'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['HEAVY_OBJECT_DEFERRED']}),
  scenario('high_rtt','QUALITY','ELIGIBLE',{timeline:[{recentRttMsEwma:1500}],expectedPlans:['SEND_FULL_NOW'],expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED']}),
  scenario('rtt_spike','QUALITY','ELIGIBLE',{timeline:[{recentRttMsEwma:5000}],expectedPlans:['SEND_FULL_NOW'],expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED']}),
  scenario('burst_packet_loss','QUALITY','UNKNOWN',{injectedFaults:['NOT_FOUND_UNBOUNDED'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['RECONCILIATION_RESULT']}),
  scenario('intermittent_2s_windows','QUALITY','WAITING',{timeline:[{validated:false}],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('intermittent_10s_windows','QUALITY','ELIGIBLE',{expectedPlans:['SEND_FULL_NOW'],expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED']}),
  scenario('network_handover_mid_request','QUALITY','UNKNOWN',{injectedFaults:['NOT_FOUND_UNBOUNDED'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['RECONCILIATION_RESULT']}),
  scenario('network_disappears_before_send','QUALITY','WAITING',{timeline:[{hasNetwork:false,internetCapable:false,validated:false}],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('network_disappears_after_body_sent','QUALITY','UNKNOWN',{expectedPlans:['SEND_FULL_NOW'],injectedFaults:['DROP_AFTER_BODY_SENT','NOT_FOUND_UNBOUNDED'],expectedTransportAttemptCount:1,expectedReceiverEffectCount:1,expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED','RECONCILIATION_STARTED']}),

  scenario('critical_core_fits_full_does_not','PLANNING','CORE_SENT',{profile:{urgency:'CRITICAL',payloadStrategy:'CORE_PLUS_DEFERRED',maxImmediateBytes:1024,allowMetered:true,allowCongested:true},timeline:[{metered:true,congested:true}],expectedPlans:['SEND_CRITICAL_CORE_NOW'],expectedTransportAttemptCount:1,expectedReceiverEffectCount:1,expectedWitnessEvidence:['CRITICAL_CORE_SENT','HEAVY_OBJECT_DEFERRED'],expectedReasonCodes:['CRITICAL_CORE_FITS']}),
  scenario('bulk_deferred_on_congested','PLANNING','DEFERRED',{profile:{urgency:'BULK'},timeline:[{congested:true}],expectedPlans:['DEFER_HEAVY'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['HEAVY_OBJECT_DEFERRED']}),
  scenario('critical_over_metered_allowed','PLANNING','ELIGIBLE',{profile:{urgency:'CRITICAL',allowMetered:true},timeline:[{metered:true}],expectedPlans:['SEND_FULL_NOW'],expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED']}),
  scenario('bulk_over_metered_denied','PLANNING','WAITING',{profile:{urgency:'BULK'},timeline:[{metered:true}],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedDeferredState:'PENDING',expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('deadline_near_expiry','PLANNING','ELIGIBLE',{profile:{urgency:'CRITICAL',deadlineAtMs:21_000,maxDelayMs:5_000},expectedPlans:['SEND_FULL_NOW'],expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED']}),
  scenario('operation_expired_while_waiting','PLANNING','OPERATION_EXPIRED',{profile:{expiresAtMs:20_000},expectedPlans:['EXPIRED_NO_SEND'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('priority_inversion_attempt','PLANNING','CRITICAL_FIRST',{injectedFaults:['BULK_ENQUEUED_BEFORE_CRITICAL'],expectedTransportAttemptCount:0,expectedDeferredState:'PENDING',expectedWitnessEvidence:['GOOD_LINK_FLUSH']}),
  scenario('bulk_starvation_recovery_on_good_link','PLANNING','BULK_PROGRESS',{injectedFaults:['GOOD_LINK_AVAILABLE'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['GOOD_LINK_FLUSH']}),
  scenario('dependency_blocks_child','PLANNING','BLOCKED',{profile:{dependencies:['parent-op']},injectedFaults:['DEPENDENCY_UNSATISFIED'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['DEPENDENCY_BLOCKED'],expectedReasonCodes:['DEPENDENCY_BLOCKED']}),
  scenario('dependency_released','PLANNING','ELIGIBLE',{profile:{dependencies:['parent-op']},injectedFaults:['DEPENDENCY_SATISFIED'],expectedPlans:['SEND_FULL_NOW'],expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED']}),

  scenario('response_lost_after_durable_accept','AMBIGUITY','ACCEPTANCE_RECOVERED',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['DROP_RESPONSE_AFTER_DURABLE_ACCEPT'],expectedTransportAttemptCount:1,expectedReceiverEffectCount:1,expectedWitnessEvidence:['RECONCILIATION_STARTED','RECONCILIATION_RESULT']}),
  scenario('response_lost_before_receiver_accept','AMBIGUITY','UNKNOWN',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['DROP_BEFORE_RECEIVER_ACCEPT','NOT_FOUND_UNBOUNDED'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['RECONCILIATION_RESULT']}),
  scenario('receiver_query_returns_durable_accept','AMBIGUITY','ACCEPTANCE_RECOVERED',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['QUERY_ACCEPTED'],expectedTransportAttemptCount:1,expectedReceiverEffectCount:1,expectedWitnessEvidence:['RECONCILIATION_STARTED','RECONCILIATION_RESULT']}),
  scenario('receiver_query_unbounded_not_found','AMBIGUITY','UNKNOWN',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['NOT_FOUND_UNBOUNDED'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['RECONCILIATION_RESULT']}),
  scenario('receiver_query_bounded_not_accepted','AMBIGUITY','SAFE_RETRY',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['BOUNDED_NOT_ACCEPTED'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['RECONCILIATION_RESULT']}),
  scenario('reconcile_then_safe_retry','AMBIGUITY','RETRIED_AFTER_PROOF',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['BOUNDED_NOT_ACCEPTED','SAFE_RETRY'],expectedTransportAttemptCount:2,expectedReceiverEffectCount:1,expectedWitnessEvidence:['RECONCILIATION_RESULT','TRANSPORT_PATH_SELECTED']}),
  scenario('no_auto_retry_timeout','AMBIGUITY','UNKNOWN',{profile:{retryContract:'NO_AUTOMATIC_RETRY',idempotencyRequired:false},injectedFaults:['TIMEOUT'],expectedPlans:['REJECT_BY_POLICY'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('same_operation_two_paths_dedup','AMBIGUITY','COMPLETED',{injectedFaults:['DUPLICATE_TRANSPORT_PATH'],expectedTransportAttemptCount:2,expectedReceiverEffectCount:1,expectedDeferredState:'NONE',expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED','RECONCILIATION_RESULT']}),

  scenario('delta_valid_base','DELTA','DELTA_ALLOWED',{profile:{payloadStrategy:'DELTA_ALLOWED'},injectedFaults:['EXACT_BASE_PRESENT'],expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED'],expectedReasonCodes:['DELTA_BASE_AVAILABLE']}),
  scenario('delta_unknown_base','DELTA','FULL_OR_DEFER',{profile:{payloadStrategy:'DELTA_ALLOWED'},injectedFaults:['BASE_UNKNOWN'],expectedDeferredState:'PENDING',expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED'],expectedReasonCodes:['DELTA_BASE_UNKNOWN']}),
  scenario('delta_stale_base','DELTA','FULL_OR_DEFER',{profile:{payloadStrategy:'DELTA_ALLOWED'},injectedFaults:['BASE_STALE'],expectedDeferredState:'PENDING',expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED'],expectedReasonCodes:['DELTA_BASE_UNKNOWN']}),
  scenario('delta_receiver_unsupported','DELTA','FULL_OR_DEFER',{profile:{payloadStrategy:'DELTA_ALLOWED'},injectedFaults:['RECEIVER_DELTA_UNSUPPORTED'],expectedPlans:['SEND_FULL_NOW'],expectedDeferredState:'NONE',expectedWitnessEvidence:['TRANSPORT_PATH_SELECTED']}),
  scenario('delta_hash_mismatch','DELTA','REJECTED',{profile:{payloadStrategy:'DELTA_ALLOWED'},injectedFaults:['DELTA_HASH_MISMATCH'],expectedDeferredState:'PENDING',expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED'],expectedReasonCodes:['DELTA_BASE_UNKNOWN']}),
  scenario('full_fallback_after_delta_refusal','DELTA','FULL_OR_DEFER',{profile:{payloadStrategy:'DELTA_ALLOWED'},injectedFaults:['DELTA_REFUSED'],expectedPlans:['SEND_FULL_NOW'],expectedDeferredState:'NONE',expectedWitnessEvidence:['TRANSMISSION_PLAN_SELECTED']}),

  scenario('large_blob_deferred','DEFERRED','PENDING',{injectedFaults:['LARGE_REQUIRED_OBJECT'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['HEAVY_OBJECT_DEFERRED']}),
  scenario('chunk_interrupted','DEFERRED','CHECKPOINTED',{injectedFaults:['INTERRUPT_AFTER_CHUNK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['DEFERRED_TRANSFER_CHECKPOINT']}),
  scenario('resume_after_process_death','DEFERRED','RESUMED',{injectedFaults:['PROCESS_DEATH_AFTER_CHECKPOINT'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['STATE_RECOVERED','DEFERRED_TRANSFER_STARTED']}),
  scenario('resume_after_reboot','DEFERRED','RESUMED',{injectedFaults:['REBOOT_AFTER_CHECKPOINT'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['STATE_RECOVERED','DEFERRED_TRANSFER_STARTED']}),
  scenario('remote_offset_disagrees','DEFERRED','REFUSED',{injectedFaults:['REMOTE_OFFSET_MISMATCH'],expectedTransportAttemptCount:0,expectedDeferredState:'PENDING',expectedWitnessEvidence:['DEFERRED_TRANSFER_CHECKPOINT'],expectedReasonCodes:['REMOTE_OFFSET_MISMATCH']}),
  scenario('chunk_hash_corrupt','DEFERRED','REJECTED',{injectedFaults:['CHUNK_HASH_CORRUPT'],expectedTransportAttemptCount:0,expectedDeferredState:'PENDING',expectedWitnessEvidence:['DEFERRED_TRANSFER_CHECKPOINT'],expectedReasonCodes:['DEFERRED_HASH_MISMATCH']}),
  scenario('whole_object_hash_corrupt','DEFERRED','REJECTED',{injectedFaults:['OBJECT_HASH_CORRUPT'],expectedTransportAttemptCount:0,expectedDeferredState:'PENDING',expectedWitnessEvidence:['DEFERRED_TRANSFER_CHECKPOINT'],expectedReasonCodes:['DEFERRED_HASH_MISMATCH']}),
  scenario('good_link_flush','DEFERRED','COMPLETED',{injectedFaults:['GOOD_LINK_AVAILABLE'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['DEFERRED_TRANSFER_COMPLETED']}),
  scenario('required_evidence_expires_incomplete','DEFERRED','HEAVY_SYNC_EXPIRED',{injectedFaults:['EXPIRE_WITH_REQUIRED_EVIDENCE_PENDING'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['HEAVY_OBJECT_DEFERRED'],expectedReasonCodes:['OPERATION_EXPIRED']}),
  scenario('optional_object_policy_drop','DEFERRED','OPTIONAL_DROPPED',{injectedFaults:['OPTIONAL_POLICY_DROP'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['HEAVY_OBJECT_DEFERRED'],expectedReasonCodes:['OPTIONAL_POLICY_DROP']}),

  scenario('prefetch_good_link','PREFETCH','PREFETCHED',{injectedFaults:['GOOD_LINK_AVAILABLE'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['PREFETCH_COMPLETED']}),
  scenario('prefetch_metered_denied','PREFETCH','DENIED',{timeline:[{metered:true}],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('prefetch_stale_revision','PREFETCH','SKIPPED',{injectedFaults:['REVISION_ALREADY_PRESENT'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('prefetch_disk_budget_exhausted','PREFETCH','DENIED',{injectedFaults:['DISK_BUDGET_EXHAUSTED'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('prefetch_resource_expired','PREFETCH','DENIED',{injectedFaults:['RESOURCE_EXPIRED'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),
  scenario('prefetch_origin_not_allowed','PREFETCH','DENIED',{injectedFaults:['ORIGIN_NOT_ALLOWED'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED']}),

  scenario('scheduler_delayed_by_os','SCHEDULER','DURABLE_WAIT',{timeline:[{validated:false}],injectedFaults:['OS_DELAY'],expectedPlans:['WAIT_FOR_VALIDATED_LINK'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['TRANSMISSION_PLAN_CREATED'],expectedReasonCodes:['NETWORK_NOT_VALIDATED']}),
  scenario('scheduler_duplicate_wakeup','SCHEDULER','DEDUPED',{injectedFaults:['DUPLICATE_WAKEUP'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['WAKEUP_DEDUPLICATED']}),
  scenario('connectivity_callback_burst','SCHEDULER','DEDUPED',{injectedFaults:['CONNECTIVITY_CALLBACK_BURST'],expectedTransportAttemptCount:0,expectedWitnessEvidence:['WAKEUP_DEDUPLICATED']}),
  scenario('process_killed_after_plan','SCHEDULER','RECOVERED',{injectedFaults:['PROCESS_DEATH_AFTER_PERSIST'],expectedTransportAttemptCount:1,expectedWitnessEvidence:['STATE_RECOVERED','TRANSMISSION_PLAN_CREATED']}),
  scenario('process_killed_after_receiver_accept','SCHEDULER','RECONCILED',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['DROP_RESPONSE_AFTER_DURABLE_ACCEPT','PROCESS_DEATH'],expectedTransportAttemptCount:1,expectedReceiverEffectCount:1,expectedWitnessEvidence:['STATE_RECOVERED','RECONCILIATION_RESULT']}),
  scenario('reboot_before_reconciliation','SCHEDULER','RECONCILED',{profile:{retryContract:'RECONCILE_BEFORE_RETRY'},injectedFaults:['DROP_RESPONSE_AFTER_DURABLE_ACCEPT','REBOOT'],expectedTransportAttemptCount:1,expectedReceiverEffectCount:1,expectedWitnessEvidence:['STATE_RECOVERED','RECONCILIATION_RESULT']}),

  scenario('forged_receiver_capabilities','SECURITY','REJECTED',{injectedFaults:['FORGED_RECEIVER_CAPABILITIES'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('capability_downgrade_attempt','SECURITY','REJECTED',{injectedFaults:['CAPABILITY_DOWNGRADE'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('forged_reconciliation_receipt','SECURITY','REJECTED',{injectedFaults:['FORGED_RECONCILIATION_RECEIPT'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('operation_id_commitment_mismatch','SECURITY','REJECTED',{injectedFaults:['OPERATION_COMMITMENT_MISMATCH'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('cross_tenant_reconciliation_query','SECURITY','REJECTED',{injectedFaults:['CROSS_TENANT_QUERY'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('unauthorized_upstream_proxy_target','SECURITY','REJECTED',{injectedFaults:['UNAUTHORIZED_PROXY_TARGET'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('SSRF_attempt','SECURITY','REJECTED',{injectedFaults:['SSRF'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('header_smuggling_attempt','SECURITY','REJECTED',{injectedFaults:['HEADER_SMUGGLING'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('redirect_to_untrusted_origin','SECURITY','REJECTED',{injectedFaults:['UNTRUSTED_REDIRECT'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('malicious_delta_base','SECURITY','REJECTED',{injectedFaults:['MALICIOUS_DELTA_BASE'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('path_traversal_deferred_object','SECURITY','REJECTED',{injectedFaults:['PATH_TRAVERSAL'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('oversized_manifest','SECURITY','REJECTED',{injectedFaults:['OVERSIZED_MANIFEST'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('chunk_count_exhaustion','SECURITY','REJECTED',{injectedFaults:['CHUNK_COUNT_EXHAUSTION'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('hash_collision_claim_mismatch','SECURITY','REJECTED',{injectedFaults:['HASH_CLAIM_MISMATCH'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
  scenario('log_secret_injection','SECURITY','REJECTED',{injectedFaults:['LOG_SECRET_INJECTION'],expectedWitnessEvidence:['SECURITY_REJECTED']}),
]);

export function summarizeLinkScenarios() {
  const families = Object.fromEntries(
    [...new Set(LINK_SCENARIOS.map((entry) => entry.family))]
      .map((family) => [family, LINK_SCENARIOS.filter((entry) => entry.family === family).length]),
  );
  return Object.freeze({
    scenarioCount: LINK_SCENARIOS.length,
    families,
    duplicateBusinessEffectScenarios: LINK_SCENARIOS.filter((entry) => entry.expectedReceiverEffectCount > 1).length,
    executableScenarioCount: LINK_SCENARIOS.filter((entry) => entry.seed > 0 && entry.profile.profileVersion === 2 && entry.linkTimeline.length > 0).length,
  });
}
