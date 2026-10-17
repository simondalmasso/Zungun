import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTransmissionPlan,
  orderEligibleOperations,
  sha256Canonical,
  type DeliveryProfileV2,
  type LinkSnapshot,
  type PlannerInput,
  type TransportCapability,
} from '../packages/link-core/src/index.js';

const baseProfile: DeliveryProfileV2 = Object.freeze({
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

const goodSnapshot: LinkSnapshot = Object.freeze({
  snapshotId: 'snap-good',
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
  networkKey: 'network:test',
  recentRttMsEwma: 30,
  recentFailureRateEwma: 0,
  recentThroughputKbpsEwma: 4_000,
});

const httpTransport: TransportCapability = Object.freeze({
  adapterId: 'http',
  available: true,
  reachabilityClass: 'INTERNET',
  maxPayloadBytes: null,
  supportsDurableReceipt: true,
  supportsReceiverQuery: true,
  supportsResume: true,
  supportsNetworkBinding: true,
  supportsHedging: false,
});

function input(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    plannerVersion: 'link-planner-v1',
    nowMs: 20_000,
    opId: 'op-1',
    profile: baseProfile,
    snapshot: goodSnapshot,
    payload: Object.freeze({ fullBytes: 512, criticalCoreBytes: null, deferredBytes: 0, deltaBytes: null, deltaBaseRequired: null, deltaBaseAvailable: null, hasRequiredDeferredEvidence: false }),
    transports: Object.freeze([httpTransport]),
    priorAmbiguousOutcome: false,
    automaticRetryAttempt: false,
    activeProbeBytesUsed: 0,
    hasOutstandingDeferredObjects: false,
    prefetchEligible: false,
    ...overrides,
  };
}

test('planner is deterministic for the same version and input', () => {
  const a = createTransmissionPlan(input());
  const b = createTransmissionPlan(input());
  assert.deepEqual(a, b);
  assert.equal(a.planId, b.planId);
  assert.equal(a.decision, 'SEND_FULL_NOW');
});

test('expired operation never sends', () => {
  const plan = createTransmissionPlan(input({ nowMs: 100_000 }));
  assert.equal(plan.decision, 'EXPIRED_NO_SEND');
  assert.equal(plan.plannedBytes, 0);
});

test('unvalidated connectivity is not treated as success by default', () => {
  const plan = createTransmissionPlan(input({ snapshot: { ...goodSnapshot, validated: false } }));
  assert.equal(plan.decision, 'WAIT_FOR_VALIDATED_LINK');
  assert.ok(plan.reasonCodes.includes('NETWORK_NOT_VALIDATED'));
});

test('restricting metered policy cannot make a blocked plan more permissive', () => {
  const metered = { ...goodSnapshot, metered: true };
  const allowed = createTransmissionPlan(input({ profile: { ...baseProfile, allowMetered: true }, snapshot: metered }));
  const blocked = createTransmissionPlan(input({ profile: { ...baseProfile, allowMetered: false }, snapshot: metered }));
  assert.equal(allowed.decision, 'SEND_FULL_NOW');
  assert.equal(blocked.decision, 'WAIT_FOR_VALIDATED_LINK');
});

test('NO_AUTOMATIC_RETRY never resends through scheduler retry', () => {
  const plan = createTransmissionPlan(input({ automaticRetryAttempt: true, profile: { ...baseProfile, retryContract: 'NO_AUTOMATIC_RETRY', idempotencyRequired: false } }));
  assert.equal(plan.decision, 'REJECT_BY_POLICY');
  assert.ok(plan.reasonCodes.includes('RETRY_CONTRACT_PROHIBITS_RESEND'));
});

test('ambiguous outcome reconciles before retry', () => {
  const plan = createTransmissionPlan(input({ priorAmbiguousOutcome: true, automaticRetryAttempt: true, profile: { ...baseProfile, retryContract: 'RECONCILE_BEFORE_RETRY' } }));
  assert.equal(plan.decision, 'RECONCILE_BEFORE_RETRY');
  assert.equal(plan.reconcileFirst, true);
  assert.equal(plan.plannedBytes, 0);
});

test('critical core is sent while heavy evidence is deferred on constrained payload', () => {
  const plan = createTransmissionPlan(input({
    payload: { fullBytes: 8_400_312, criticalCoreBytes: 312, deferredBytes: 8_400_000, deltaBytes: null, deltaBaseRequired: null, deltaBaseAvailable: null, hasRequiredDeferredEvidence: true },
    snapshot: { ...goodSnapshot, congested: true, metered: true },
    profile: { ...baseProfile, urgency: 'CRITICAL', payloadStrategy: 'CORE_PLUS_DEFERRED', maxImmediateBytes: 1_024, allowMetered: true, allowCongested: true },
  }));
  assert.equal(plan.decision, 'SEND_CRITICAL_CORE_NOW');
  assert.equal(plan.plannedBytes, 312);
  assert.ok(plan.reasonCodes.includes('HEAVY_DEFERRED'));
});

test('delta requires the exact declared base', () => {
  const mismatch = createTransmissionPlan(input({
    profile: { ...baseProfile, payloadStrategy: 'DELTA_ALLOWED', maxImmediateBytes: 256 },
    payload: { fullBytes: 2_048, criticalCoreBytes: null, deferredBytes: 0, deltaBytes: 64, deltaBaseRequired: 'base-a', deltaBaseAvailable: 'base-b', hasRequiredDeferredEvidence: false },
  }));
  assert.equal(mismatch.decision, 'DEFER_HEAVY');
  assert.ok(mismatch.reasonCodes.includes('DELTA_BASE_UNKNOWN'));
  const exact = createTransmissionPlan(input({
    profile: { ...baseProfile, payloadStrategy: 'DELTA_ALLOWED', maxImmediateBytes: 256 },
    payload: { fullBytes: 2_048, criticalCoreBytes: null, deferredBytes: 0, deltaBytes: 64, deltaBaseRequired: 'base-a', deltaBaseAvailable: 'base-a', hasRequiredDeferredEvidence: false },
  }));
  assert.equal(exact.decision, 'SEND_DELTA_NOW');
});

test('bulk cannot displace critical work', () => {
  const critical = { opId: 'critical', enqueuedAtMs: 2, profile: { ...baseProfile, urgency: 'CRITICAL' as const }, dependenciesSatisfied: true, deferredBytes: 0 };
  const bulk = { opId: 'bulk', enqueuedAtMs: 1, profile: { ...baseProfile, urgency: 'BULK' as const }, dependenciesSatisfied: true, deferredBytes: 10_000 };
  const ordered = orderEligibleOperations([bulk, critical]);
  assert.equal(ordered[0]?.opId, 'critical');
});

test('canonical hashing is key-order independent', () => {
  assert.equal(sha256Canonical({ b: 1, a: 2 }), sha256Canonical({ a: 2, b: 1 }));
});

test('good-link fairness promotes old bulk only after critical work is absent', async () => {
  const { selectNextOperation } = await import('../packages/link-core/src/scheduler.js');
  const base = baseProfile;
  const bulk = { opId:'bulk', enqueuedAtMs:1, profile:{...base,urgency:'BULK' as const}, dependenciesSatisfied:true, deferredBytes:9_000_000 };
  const high = { opId:'high', enqueuedAtMs:2, profile:{...base,urgency:'HIGH' as const}, dependenciesSatisfied:true, deferredBytes:0 };
  const critical = { opId:'critical', enqueuedAtMs:3, profile:{...base,urgency:'CRITICAL' as const}, dependenciesSatisfied:true, deferredBytes:0 };
  assert.equal(selectNextOperation([bulk,high],8,true)?.opId,'bulk');
  assert.equal(selectNextOperation([bulk,high,critical],100,true)?.opId,'critical');
});
