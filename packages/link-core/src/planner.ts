import { sha256Canonical } from './canonical.js';
import { validateDeliveryProfile } from './profile.js';
import type {
  LinkReasonCode,
  PlannerInput,
  PlanDecision,
  TransmissionPlan,
  TransportCapability,
} from './types.js';

const PRIORITY: Readonly<Record<PlannerInput['profile']['urgency'], number>> = Object.freeze({ CRITICAL: 0, HIGH: 1, NORMAL: 2, BULK: 3 });

function isExpired(input: PlannerInput): boolean {
  return input.profile.expiresAtMs !== null && input.nowMs >= input.profile.expiresAtMs;
}

function snapshotFresh(input: PlannerInput): boolean {
  return input.nowMs >= input.snapshot.observedAtMs && input.nowMs - input.snapshot.observedAtMs <= input.snapshot.maxAgeMs;
}

function selectTransport(input: PlannerInput, bytes: number, requireQuery = false): TransportCapability | null {
  const allowed = input.transports.filter((transport) =>
    transport.available &&
    (input.profile.transportAllowlist.length === 0 || input.profile.transportAllowlist.includes(transport.adapterId)) &&
    (!requireQuery || transport.supportsReceiverQuery) &&
    (transport.maxPayloadBytes === null || bytes <= transport.maxPayloadBytes),
  );
  return [...allowed].sort((a, b) => a.adapterId.localeCompare(b.adapterId))[0] ?? null;
}

function plan(
  input: PlannerInput,
  decision: PlanDecision,
  reasons: readonly LinkReasonCode[],
  bytes: number,
  transport: TransportCapability | null,
  reconcileFirst: boolean,
  nextEligibilityAtMs: number | null,
): TransmissionPlan {
  const profileHash = sha256Canonical(input.profile);
  const snapshotHash = sha256Canonical(input.snapshot);
  const activeProbeBudgetRemainingBytes = Math.max(0, input.profile.activeProbeBudgetBytes - input.activeProbeBytesUsed);
  const activeProbeAuthorized = activeProbeBudgetRemainingBytes > 0 && input.snapshot.validated && !input.snapshot.metered;
  const identity = {
    plannerVersion: input.plannerVersion,
    opId: input.opId,
    profileHash,
    snapshotHash,
    decision,
    reasons,
    bytes,
    adapterId: transport?.adapterId ?? null,
    networkKey: input.snapshot.networkKey,
    reconcileFirst,
    nextEligibilityAtMs,
  };
  return Object.freeze({
    planId: sha256Canonical(identity),
    plannerVersion: input.plannerVersion,
    opId: input.opId,
    profileHash,
    snapshotId: input.snapshot.snapshotId,
    snapshotHash,
    decision,
    reasonCodes: Object.freeze([...reasons]),
    adapterId: transport?.adapterId ?? null,
    networkKey: input.snapshot.networkKey,
    plannedBytes: bytes,
    reconcileFirst,
    nextEligibilityAtMs,
    activeProbeAuthorized,
    activeProbeBudgetRemainingBytes,
  });
}

function waiting(input: PlannerInput, reason: LinkReasonCode, additional: readonly LinkReasonCode[] = []): TransmissionPlan {
  const next = input.profile.maxDelayMs === null ? null : input.nowMs + input.profile.maxDelayMs;
  return plan(input, 'WAIT_FOR_VALIDATED_LINK', [reason, ...additional], 0, null, false, next);
}

function goodLink(input: PlannerInput): boolean {
  return input.snapshot.validated && !input.snapshot.captivePortal && !input.snapshot.suspended && (!input.snapshot.metered || input.snapshot.temporarilyUnmetered) && !input.snapshot.congested && !input.snapshot.roaming;
}

function deadlineNear(input: PlannerInput): boolean {
  if (input.profile.deadlineAtMs === null) return false;
  const window = input.profile.maxDelayMs ?? 0;
  return input.nowMs + window >= input.profile.deadlineAtMs;
}

export function createTransmissionPlan(rawInput: PlannerInput): TransmissionPlan {
  const input: PlannerInput = { ...rawInput, profile: validateDeliveryProfile(rawInput.profile) };

  if (isExpired(input)) return plan(input, 'EXPIRED_NO_SEND', ['OPERATION_EXPIRED'], 0, null, false, null);
  if (input.automaticRetryAttempt && input.profile.retryContract === 'NO_AUTOMATIC_RETRY') {
    return plan(input, 'REJECT_BY_POLICY', ['RETRY_CONTRACT_PROHIBITS_RESEND'], 0, null, false, null);
  }
  if (input.priorAmbiguousOutcome && input.profile.retryContract === 'RECONCILE_BEFORE_RETRY') {
    const queryTransport = selectTransport(input, 0, true);
    return plan(
      input,
      'RECONCILE_BEFORE_RETRY',
      queryTransport ? ['RECEIVER_RECONCILIATION_REQUIRED'] : ['RECEIVER_RECONCILIATION_REQUIRED', 'TRANSPORT_NOT_CAPABLE'],
      0,
      queryTransport,
      true,
      null,
    );
  }
  if (!snapshotFresh(input)) return waiting(input, 'STALE_LINK_SNAPSHOT');
  if (!input.snapshot.hasNetwork) return waiting(input, 'NO_NETWORK');
  if (!input.snapshot.internetCapable) return waiting(input, 'NETWORK_NOT_INTERNET_CAPABLE');
  if (input.snapshot.suspended) return waiting(input, 'NETWORK_SUSPENDED');
  if (input.snapshot.captivePortal) return waiting(input, 'CAPTIVE_PORTAL');
  if (!input.snapshot.validated && !input.profile.allowUnvalidated) return waiting(input, 'NETWORK_NOT_VALIDATED');
  if (input.snapshot.metered && !input.snapshot.temporarilyUnmetered && !input.profile.allowMetered) return waiting(input, 'POLICY_METERED_FORBIDDEN');
  if (input.snapshot.roaming && !input.profile.allowRoaming) return waiting(input, 'POLICY_ROAMING_FORBIDDEN');
  if (input.snapshot.congested && !input.profile.allowCongested && input.profile.urgency !== 'CRITICAL') {
    const reason: LinkReasonCode = input.profile.urgency === 'BULK' ? 'NETWORK_CONGESTED_DEFER_BULK' : 'NETWORK_CONGESTED_DEFER_BULK';
    return plan(input, 'DEFER_HEAVY', [reason, 'HEAVY_DEFERRED'], 0, null, false, null);
  }

  const unvalidatedReason: readonly LinkReasonCode[] = !input.snapshot.validated ? ['UNVALIDATED_EXPLICITLY_ALLOWED'] : [];
  const fullTransport = selectTransport(input, input.payload.fullBytes);
  const fullFitsProfile = input.payload.fullBytes <= input.profile.maxImmediateBytes;
  const fullFits = fullFitsProfile && fullTransport !== null;

  if (input.profile.payloadStrategy === 'DELTA_ALLOWED' && input.payload.deltaBytes !== null) {
    const exactBase = input.payload.deltaBaseRequired !== null && input.payload.deltaBaseAvailable === input.payload.deltaBaseRequired;
    if (exactBase) {
      const deltaTransport = selectTransport(input, input.payload.deltaBytes);
      if (deltaTransport && input.payload.deltaBytes <= input.profile.maxImmediateBytes) {
        return plan(input, 'SEND_DELTA_NOW', ['DELTA_BASE_AVAILABLE', ...unvalidatedReason], input.payload.deltaBytes, deltaTransport, false, null);
      }
    } else if (input.payload.deltaBaseRequired !== null) {
      if (!fullFits) return plan(input, 'DEFER_HEAVY', ['DELTA_BASE_UNKNOWN', 'HEAVY_DEFERRED'], 0, null, false, null);
    }
  }

  if (fullFits && (goodLink(input) || input.profile.payloadStrategy === 'FULL_ONLY' || deadlineNear(input))) {
    const reasons: LinkReasonCode[] = ['FULL_PAYLOAD_FITS', ...unvalidatedReason];
    if (deadlineNear(input)) reasons.push('CRITICAL_DEADLINE');
    if (goodLink(input) && input.hasOutstandingDeferredObjects) reasons.push('GOOD_LINK_FLUSH_ELIGIBLE');
    return plan(input, 'SEND_FULL_NOW', reasons, input.payload.fullBytes, fullTransport, false, null);
  }

  if (input.profile.payloadStrategy === 'CORE_PLUS_DEFERRED' && input.payload.criticalCoreBytes !== null) {
    const coreTransport = selectTransport(input, input.payload.criticalCoreBytes);
    const coreFits = input.payload.criticalCoreBytes <= input.profile.maxImmediateBytes && coreTransport !== null;
    if (coreFits) {
      const reasons: LinkReasonCode[] = ['CRITICAL_CORE_FITS', 'FULL_PAYLOAD_TOO_LARGE', 'HEAVY_DEFERRED', ...unvalidatedReason];
      if (input.snapshot.metered && input.profile.urgency === 'CRITICAL') reasons.push('POLICY_METERED_ALLOWS_CRITICAL');
      if (input.snapshot.congested && input.profile.urgency === 'CRITICAL') reasons.push('NETWORK_CONGESTED_DEFER_BULK');
      if (deadlineNear(input)) reasons.push('CRITICAL_DEADLINE');
      return plan(input, 'SEND_CRITICAL_CORE_NOW', reasons, input.payload.criticalCoreBytes, coreTransport, false, null);
    }
  }

  if (goodLink(input) && input.prefetchEligible && !input.hasOutstandingDeferredObjects) {
    return plan(input, 'PREFETCH_WHEN_GOOD', ['PREFETCH_ELIGIBLE'], 0, null, false, null);
  }

  if (input.profile.urgency === 'BULK' || input.payload.deferredBytes > 0) {
    const reasons: LinkReasonCode[] = ['HEAVY_DEFERRED'];
    if (input.snapshot.congested) reasons.unshift('NETWORK_CONGESTED_DEFER_BULK');
    if (input.activeProbeBytesUsed >= input.profile.activeProbeBudgetBytes && input.profile.activeProbeBudgetBytes > 0) reasons.push('BUDGET_EXHAUSTED');
    return plan(input, 'DEFER_HEAVY', reasons, 0, null, false, null);
  }

  return plan(input, 'REJECT_BY_POLICY', [fullTransport ? 'TRANSPORT_NOT_CAPABLE' : 'TRANSPORT_UNAVAILABLE'], 0, null, false, null);
}

export function compareUrgency(a: PlannerInput['profile']['urgency'], b: PlannerInput['profile']['urgency']): number {
  return PRIORITY[a] - PRIORITY[b];
}
