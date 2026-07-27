import { fail } from './errors.js';
import { validateTransportCapabilities } from './adapters.js';
import { assertValidatedMessage } from './message.js';
import { isExpired } from './time.js';
import { checkedAddMs, requireBoolean, requireNonNegativeSafeInteger, requireOpaqueId, requirePositiveSafeInteger, snapshotExactRecord } from './validation.js';
import type { LogicalMessage, RouteDecision, RoutePolicy, RouteRequirements, TransportCapabilities } from './types.js';

interface NormalizedRoutePolicy {
  readonly version: string;
  readonly maximumMonetaryCostClass: number;
  readonly maximumEnergyCostClass: number;
  readonly maximumPrivacyMetadataClass: number;
  readonly allowedAdapterIds?: ReadonlySet<string>;
  readonly disabledAdapterIds?: ReadonlySet<string>;
  readonly acceptsDuplicationRisk: boolean;
}

function scoreRoute(message: LogicalMessage, capability: TransportCapabilities): number {
  const urgencyWeight = message.priority * 100;
  return urgencyWeight +
    capability.availabilityClass * 50 -
    capability.expectedLatencyClass * 10 -
    capability.monetaryCostClass * 8 -
    capability.energyCostClass * 4 -
    capability.privacyMetadataClass * 6;
}

function compareAdapterIds(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizeIdSet(value: unknown, field: string): ReadonlySet<string> | undefined {
  if (value === undefined) return undefined;
  let isSet = false;
  try { isSet = value instanceof Set; }
  catch { fail('CORRUPT_RECORD', `${field} cannot be inspected safely`); }
  if (!isSet) fail('CORRUPT_RECORD', `${field} must be a Set`);
  let values: unknown[];
  try {
    values = Array.from(value as Set<unknown>);
  } catch {
    fail('CORRUPT_RECORD', `${field} cannot be inspected safely`);
  }
  const normalized = new Set<string>();
  for (const id of values) normalized.add(requireOpaqueId(id, field));
  return normalized;
}

function validatePolicy(policy: RoutePolicy): NormalizedRoutePolicy {
  const record = snapshotExactRecord(policy, ['version', 'maximumMonetaryCostClass', 'maximumEnergyCostClass', 'maximumPrivacyMetadataClass', 'allowedAdapterIds', 'disabledAdapterIds', 'acceptsDuplicationRisk'], 'RoutePolicy');
  const normalized: NormalizedRoutePolicy = {
    version: requireOpaqueId(record.version, 'policy.version'),
    maximumMonetaryCostClass: requireNonNegativeSafeInteger(record.maximumMonetaryCostClass, 'maximumMonetaryCostClass'),
    maximumEnergyCostClass: requireNonNegativeSafeInteger(record.maximumEnergyCostClass, 'maximumEnergyCostClass'),
    maximumPrivacyMetadataClass: requireNonNegativeSafeInteger(record.maximumPrivacyMetadataClass, 'maximumPrivacyMetadataClass'),
    acceptsDuplicationRisk: requireBoolean(record.acceptsDuplicationRisk, 'acceptsDuplicationRisk'),
    ...(record.allowedAdapterIds === undefined ? {} : { allowedAdapterIds: normalizeIdSet(record.allowedAdapterIds, 'allowedAdapterIds')! }),
    ...(record.disabledAdapterIds === undefined ? {} : { disabledAdapterIds: normalizeIdSet(record.disabledAdapterIds, 'disabledAdapterIds')! }),
  };
  return Object.freeze(normalized);
}

function validateRequirements(message: LogicalMessage, requirements: RouteRequirements): RouteRequirements {
  const record = snapshotExactRecord(requirements, ['fragmentBytes', 'fragmentCount', 'requiresBinary', 'requiresFragmentation', 'requiresTransportReceipt', 'requiresEndRecipientReceipt'], 'RouteRequirements');
  const fragmentBytes = requireNonNegativeSafeInteger(record.fragmentBytes, 'requirements.fragmentBytes');
  const fragmentCount = requirePositiveSafeInteger(record.fragmentCount, 'requirements.fragmentCount');
  const requiresBinary = requireBoolean(record.requiresBinary, 'requirements.requiresBinary');
  const requiresFragmentation = requireBoolean(record.requiresFragmentation, 'requirements.requiresFragmentation');
  const requiresTransportReceipt = requireBoolean(record.requiresTransportReceipt, 'requirements.requiresTransportReceipt');
  const requiresEndRecipientReceipt = requireBoolean(record.requiresEndRecipientReceipt, 'requirements.requiresEndRecipientReceipt');
  if (!requiresBinary) fail('CAPABILITY_MISMATCH', 'ZEP v0.1 fragments require binary transport');
  if (requiresFragmentation !== (fragmentCount > 1)) fail('CORRUPT_RECORD', 'requiresFragmentation must match fragmentCount > 1');
  if (requiresEndRecipientReceipt !== (message.receiptPolicy === 'END_RECIPIENT_ACK')) fail('CORRUPT_RECORD', 'End-recipient receipt requirement must match message receipt policy');
  return Object.freeze({ fragmentBytes, fragmentCount, requiresBinary, requiresFragmentation, requiresTransportReceipt, requiresEndRecipientReceipt });
}

export function selectRoute(
  message: LogicalMessage,
  requirementsInput: RouteRequirements,
  capabilitiesInput: readonly TransportCapabilities[],
  policyInput: RoutePolicy,
  nowMs: number,
): RouteDecision {
  assertValidatedMessage(message);
  const normalizedNowMs = requireNonNegativeSafeInteger(nowMs, 'nowMs');
  const policy = validatePolicy(policyInput);
  const requirements = validateRequirements(message, requirementsInput);
  if (isExpired(message.expiresAtMs, normalizedNowMs)) fail('EXPIRED', 'Message is expired before route selection');
  if (!Array.isArray(capabilitiesInput)) fail('CORRUPT_RECORD', 'capabilities must be an array');
  let capabilityValues: readonly TransportCapabilities[];
  try {
    capabilityValues = Array.from(capabilitiesInput);
  } catch {
    fail('CORRUPT_RECORD', 'capabilities cannot be inspected safely');
  }

  let deadlineRejected = false;
  let capabilityRejected = false;
  const candidates = capabilityValues.map((capability) => validateTransportCapabilities(capability)).filter((capability) => {
    if (capability.currentEligibility === 'DENIED') return false;
    if (capability.maximumPayloadBytes < requirements.fragmentBytes) { capabilityRejected = true; return false; }
    if (requirements.requiresBinary && !capability.supportsBinary) { capabilityRejected = true; return false; }
    if (requirements.requiresFragmentation && !capability.supportsFragmentation) { capabilityRejected = true; return false; }
    if (requirements.requiresTransportReceipt && !capability.supportsTransportReceipt) { capabilityRejected = true; return false; }
    if (requirements.requiresEndRecipientReceipt && !capability.supportsEndRecipientReceipt) { capabilityRejected = true; return false; }
    if (policy.allowedAdapterIds && !policy.allowedAdapterIds.has(capability.adapterId)) return false;
    if (policy.disabledAdapterIds?.has(capability.adapterId)) return false;
    if (capability.monetaryCostClass > policy.maximumMonetaryCostClass) return false;
    if (capability.energyCostClass > policy.maximumEnergyCostClass) return false;
    if (capability.privacyMetadataClass > policy.maximumPrivacyMetadataClass) return false;
    const completionAt = checkedAddMs(normalizedNowMs, capability.estimatedCompletionDurationMs, `route.${capability.adapterId}`);
    if (completionAt >= message.expiresAtMs) { deadlineRejected = true; return false; }
    return true;
  });
  if (candidates.length === 0) {
    if (deadlineRejected) fail('DEADLINE_NOT_FEASIBLE', 'No route can complete before expiration');
    if (capabilityRejected) fail('CAPABILITY_MISMATCH', 'No transport can satisfy the fragment and receipt requirements');
    fail('POLICY_BLOCKED', 'No transport is eligible under policy');
  }
  const ranked = candidates.map((capability) => ({ capability, score: scoreRoute(message, capability) }))
    .sort((a, b) => b.score - a.score || compareAdapterIds(a.capability.adapterId, b.capability.adapterId));
  const chosen = ranked[0]!;
  const estimatedCompletionAtMs = checkedAddMs(normalizedNowMs, chosen.capability.estimatedCompletionDurationMs, `route.${chosen.capability.adapterId}`);
  return Object.freeze({
    adapterId: chosen.capability.adapterId,
    policyVersion: policy.version,
    score: chosen.score,
    estimatedCompletionAtMs,
    scoreInputs: Object.freeze({
      availabilityClass: chosen.capability.availabilityClass,
      expectedLatencyClass: chosen.capability.expectedLatencyClass,
      estimatedCompletionDurationMs: chosen.capability.estimatedCompletionDurationMs,
      monetaryCostClass: chosen.capability.monetaryCostClass,
      energyCostClass: chosen.capability.energyCostClass,
      privacyMetadataClass: chosen.capability.privacyMetadataClass,
      priority: message.priority,
    }),
  });
}
