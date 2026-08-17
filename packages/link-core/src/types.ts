export type Urgency = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'BULK';
export type RetryContract = 'SAFE_IDEMPOTENT' | 'RECONCILE_BEFORE_RETRY' | 'NO_AUTOMATIC_RETRY';
export type PayloadStrategy = 'FULL_ONLY' | 'CORE_PLUS_DEFERRED' | 'DELTA_ALLOWED';
export type ReceiptRequirement = 'NONE' | 'DURABLE_ACCEPTANCE' | 'APPLICATION_OUTCOME';
export type HeavyDataPolicy = 'ALLOW' | 'DEFER_ON_CONSTRAINED' | 'GOOD_LINK_ONLY';
export type EvidenceRequirement = 'BASIC' | 'LINK_DECISION_RECORD' | 'FULL_WITNESS';
export type ReachabilityClass = 'INTERNET' | 'PRIVATE' | 'RELAY' | 'UNKNOWN';

export interface DeliveryProfileV2 {
  readonly profileVersion: 2;
  readonly urgency: Urgency;
  readonly deadlineAtMs: number | null;
  readonly expiresAtMs: number | null;
  readonly maxDelayMs: number | null;
  readonly retryContract: RetryContract;
  readonly idempotencyRequired: boolean;
  readonly semanticRevalidationRequired: boolean;
  readonly orderingKey: string | null;
  readonly dependencies: readonly string[];
  readonly payloadStrategy: PayloadStrategy;
  readonly maxImmediateBytes: number;
  readonly allowMetered: boolean;
  readonly allowRoaming: boolean;
  readonly allowCongested: boolean;
  readonly allowUnvalidated: boolean;
  readonly heavyDataPolicy: HeavyDataPolicy;
  readonly activeProbeBudgetBytes: number;
  readonly transportAllowlist: readonly string[];
  readonly receiptRequirement: ReceiptRequirement;
  readonly evidenceRequirement: EvidenceRequirement;
}

export interface LinkSnapshot {
  readonly snapshotId: string;
  readonly observedAtMs: number;
  readonly maxAgeMs: number;
  readonly hasNetwork: boolean;
  readonly internetCapable: boolean;
  readonly validated: boolean;
  readonly captivePortal: boolean;
  readonly metered: boolean;
  readonly temporarilyUnmetered: boolean;
  readonly congested: boolean;
  readonly roaming: boolean;
  readonly vpn: boolean;
  readonly suspended: boolean;
  readonly downstreamKbps: number | null;
  readonly upstreamKbps: number | null;
  readonly transports: readonly string[];
  readonly networkKey: string | null;
  readonly recentRttMsEwma: number | null;
  readonly recentFailureRateEwma: number | null;
  readonly recentThroughputKbpsEwma: number | null;
}

export interface OperationPayloadShape {
  readonly fullBytes: number;
  readonly criticalCoreBytes: number | null;
  readonly deferredBytes: number;
  readonly deltaBytes: number | null;
  readonly deltaBaseRequired: string | null;
  readonly deltaBaseAvailable: string | null;
  readonly hasRequiredDeferredEvidence: boolean;
}

export interface TransportCapability {
  readonly adapterId: string;
  readonly available: boolean;
  readonly reachabilityClass: ReachabilityClass;
  readonly maxPayloadBytes: number | null;
  readonly supportsDurableReceipt: boolean;
  readonly supportsReceiverQuery: boolean;
  readonly supportsResume: boolean;
  readonly supportsNetworkBinding: boolean;
  readonly supportsHedging: boolean;
}

export interface PlannerInput {
  readonly plannerVersion: 'link-planner-v1';
  readonly nowMs: number;
  readonly opId: string;
  readonly profile: DeliveryProfileV2;
  readonly snapshot: LinkSnapshot;
  readonly payload: OperationPayloadShape;
  readonly transports: readonly TransportCapability[];
  readonly priorAmbiguousOutcome: boolean;
  readonly automaticRetryAttempt: boolean;
  readonly activeProbeBytesUsed: number;
  readonly hasOutstandingDeferredObjects: boolean;
  readonly prefetchEligible: boolean;
}

export type PlanDecision =
  | 'SEND_FULL_NOW'
  | 'SEND_CRITICAL_CORE_NOW'
  | 'SEND_DELTA_NOW'
  | 'DEFER_HEAVY'
  | 'WAIT_FOR_VALIDATED_LINK'
  | 'PREFETCH_WHEN_GOOD'
  | 'RECONCILE_BEFORE_RETRY'
  | 'REJECT_BY_POLICY'
  | 'EXPIRED_NO_SEND';

export type LinkReasonCode =
  | 'NO_NETWORK'
  | 'NETWORK_NOT_INTERNET_CAPABLE'
  | 'NETWORK_NOT_VALIDATED'
  | 'STALE_LINK_SNAPSHOT'
  | 'CAPTIVE_PORTAL'
  | 'NETWORK_SUSPENDED'
  | 'POLICY_METERED_FORBIDDEN'
  | 'POLICY_ROAMING_FORBIDDEN'
  | 'NETWORK_CONGESTED_DEFER_BULK'
  | 'NETWORK_CONGESTED_DEFER_BULK'
  | 'CRITICAL_DEADLINE'
  | 'CRITICAL_CORE_FITS'
  | 'FULL_PAYLOAD_TOO_LARGE'
  | 'POLICY_METERED_ALLOWS_CRITICAL'
  | 'DELTA_BASE_AVAILABLE'
  | 'DELTA_BASE_UNKNOWN'
  | 'HEAVY_DEFERRED'
  | 'RECEIVER_RECONCILIATION_REQUIRED'
  | 'RETRY_CONTRACT_PROHIBITS_RESEND'
  | 'IDEMPOTENCY_REQUIRED'
  | 'TRANSPORT_UNAVAILABLE'
  | 'TRANSPORT_NOT_CAPABLE'
  | 'BUDGET_EXHAUSTED'
  | 'OPERATION_EXPIRED'
  | 'GOOD_LINK_FLUSH_ELIGIBLE'
  | 'PREFETCH_ELIGIBLE'
  | 'FULL_PAYLOAD_FITS'
  | 'UNVALIDATED_EXPLICITLY_ALLOWED';

export interface TransmissionPlan {
  readonly planId: string;
  readonly plannerVersion: 'link-planner-v1';
  readonly opId: string;
  readonly profileHash: string;
  readonly snapshotId: string;
  readonly snapshotHash: string;
  readonly decision: PlanDecision;
  readonly reasonCodes: readonly LinkReasonCode[];
  readonly adapterId: string | null;
  readonly networkKey: string | null;
  readonly plannedBytes: number;
  readonly reconcileFirst: boolean;
  readonly nextEligibilityAtMs: number | null;
  readonly activeProbeAuthorized: boolean;
  readonly activeProbeBudgetRemainingBytes: number;
}
