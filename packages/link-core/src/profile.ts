import type { DeliveryProfileV2 } from './types.js';

export function validateDeliveryProfile(profile: DeliveryProfileV2): DeliveryProfileV2 {
  if (profile.profileVersion !== 2) throw new Error('LINK_PROFILE_VERSION_UNSUPPORTED');
  if (!Number.isInteger(profile.maxImmediateBytes) || profile.maxImmediateBytes < 1) throw new Error('LINK_PROFILE_MAX_IMMEDIATE_BYTES_INVALID');
  if (!Number.isInteger(profile.activeProbeBudgetBytes) || profile.activeProbeBudgetBytes < 0) throw new Error('LINK_PROFILE_PROBE_BUDGET_INVALID');
  if (profile.expiresAtMs !== null && profile.deadlineAtMs !== null && profile.expiresAtMs < profile.deadlineAtMs) throw new Error('LINK_PROFILE_EXPIRY_BEFORE_DEADLINE');
  if (profile.maxDelayMs !== null && profile.maxDelayMs < 0) throw new Error('LINK_PROFILE_MAX_DELAY_INVALID');
  if (profile.retryContract === 'SAFE_IDEMPOTENT' && profile.idempotencyRequired === false) throw new Error('LINK_PROFILE_SAFE_RETRY_REQUIRES_IDEMPOTENCY');
  if (new Set(profile.dependencies).size !== profile.dependencies.length) throw new Error('LINK_PROFILE_DUPLICATE_DEPENDENCY');
  if (new Set(profile.transportAllowlist).size !== profile.transportAllowlist.length) throw new Error('LINK_PROFILE_DUPLICATE_TRANSPORT');
  return profile;
}
