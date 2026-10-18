import type { AssuranceTier } from './transport.js';

export const RECEIVER_CAPABILITY_SCHEMA = 'zungun-link-capabilities/1' as const;

export interface ReceiverCapabilitiesV1 {
  readonly schemaVersion: typeof RECEIVER_CAPABILITY_SCHEMA;
  readonly receiverProtocolVersions: readonly string[];
  readonly maxCoreBytes: number;
  readonly supportedDeltaModes: readonly ('NONE' | 'DOMAIN_SUPPLIED_DELTA' | 'JSON_PATCH_EXACT_BASE' | 'CONTENT_ADDRESSED_CHUNK_MANIFEST')[];
  readonly supportsReconciliationQuery: boolean;
  readonly supportsDurableReceipts: boolean;
  readonly supportsDeferredObjects: boolean;
  readonly supportsResumableAdapter: boolean;
  readonly supportedEvidenceSchemaVersions: readonly string[];
  readonly assuranceTiers: readonly AssuranceTier[];
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

const TIERS: readonly AssuranceTier[] = Object.freeze(['L0_LINK_ONLY','L1_RECEIVER_PROXY','L2_NATIVE_RECEIVER_EFFECT']);
const DELTAS = new Set(['NONE','DOMAIN_SUPPLIED_DELTA','JSON_PATCH_EXACT_BASE','CONTENT_ADDRESSED_CHUNK_MANIFEST']);

export function validateReceiverCapabilities(value: ReceiverCapabilitiesV1, nowMs: number): ReceiverCapabilitiesV1 {
  if (value.schemaVersion !== RECEIVER_CAPABILITY_SCHEMA) throw new Error('LINK_CAPABILITY_SCHEMA_UNSUPPORTED');
  if (!Number.isSafeInteger(value.maxCoreBytes) || value.maxCoreBytes < 1 || value.maxCoreBytes > 1_048_576) throw new Error('LINK_CAPABILITY_MAX_CORE_INVALID');
  if (!Number.isSafeInteger(value.issuedAtMs) || !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= value.issuedAtMs) throw new Error('LINK_CAPABILITY_TTL_INVALID');
  if (nowMs < value.issuedAtMs - 300_000 || nowMs >= value.expiresAtMs) throw new Error('LINK_CAPABILITY_EXPIRED');
  if (value.receiverProtocolVersions.length < 1 || value.receiverProtocolVersions.length > 16) throw new Error('LINK_CAPABILITY_PROTOCOLS_INVALID');
  if (new Set(value.receiverProtocolVersions).size !== value.receiverProtocolVersions.length) throw new Error('LINK_CAPABILITY_PROTOCOLS_DUPLICATE');
  if (value.supportedDeltaModes.some((mode) => !DELTAS.has(mode))) throw new Error('LINK_CAPABILITY_DELTA_INVALID');
  if (value.assuranceTiers.some((tier) => !TIERS.includes(tier))) throw new Error('LINK_CAPABILITY_TIER_INVALID');
  if (value.assuranceTiers.includes('L2_NATIVE_RECEIVER_EFFECT') && (!value.supportsReconciliationQuery || !value.supportsDurableReceipts)) throw new Error('LINK_CAPABILITY_L2_INCONSISTENT');
  if (value.assuranceTiers.includes('L1_RECEIVER_PROXY') && !value.supportsDurableReceipts) throw new Error('LINK_CAPABILITY_L1_INCONSISTENT');
  return value;
}

export function negotiateAssuranceTier(value: ReceiverCapabilitiesV1, requested: AssuranceTier, nowMs: number): AssuranceTier {
  validateReceiverCapabilities(value, nowMs);
  if (!value.assuranceTiers.includes(requested)) throw new Error('LINK_ASSURANCE_TIER_UNAVAILABLE');
  if (requested === 'L2_NATIVE_RECEIVER_EFFECT' && (!value.supportsReconciliationQuery || !value.supportsDurableReceipts)) throw new Error('LINK_ASSURANCE_DOWNGRADE_REFUSED');
  if (requested === 'L1_RECEIVER_PROXY' && !value.supportsDurableReceipts) throw new Error('LINK_ASSURANCE_DOWNGRADE_REFUSED');
  return requested;
}

export function localReceiverCapabilities(nowMs: number): ReceiverCapabilitiesV1 {
  return Object.freeze({
    schemaVersion: RECEIVER_CAPABILITY_SCHEMA,
    receiverProtocolVersions: Object.freeze(['zungun.operation.v1']),
    maxCoreBytes: 65_536,
    supportedDeltaModes: Object.freeze(['NONE','DOMAIN_SUPPLIED_DELTA','JSON_PATCH_EXACT_BASE','CONTENT_ADDRESSED_CHUNK_MANIFEST'] as const),
    supportsReconciliationQuery: true,
    supportsDurableReceipts: true,
    supportsDeferredObjects: true,
    supportsResumableAdapter: true,
    supportedEvidenceSchemaVersions: Object.freeze(['zungun-witness/1','zungun-link-decision/1']),
    assuranceTiers: Object.freeze(['L0_LINK_ONLY','L1_RECEIVER_PROXY','L2_NATIVE_RECEIVER_EFFECT'] as const),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 300_000,
  });
}

export function receiverProxyCapabilities(nowMs: number): ReceiverCapabilitiesV1 {
  return Object.freeze({
    schemaVersion: RECEIVER_CAPABILITY_SCHEMA,
    receiverProtocolVersions: Object.freeze(['zungun.operation.v1']),
    maxCoreBytes: 65_536,
    supportedDeltaModes: Object.freeze(['NONE','DOMAIN_SUPPLIED_DELTA','JSON_PATCH_EXACT_BASE','CONTENT_ADDRESSED_CHUNK_MANIFEST'] as const),
    supportsReconciliationQuery: true,
    supportsDurableReceipts: true,
    supportsDeferredObjects: true,
    supportsResumableAdapter: true,
    supportedEvidenceSchemaVersions: Object.freeze(['zungun-witness/1','zungun-link-decision/1']),
    assuranceTiers: Object.freeze(['L0_LINK_ONLY','L1_RECEIVER_PROXY'] as const),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 300_000,
  });
}
