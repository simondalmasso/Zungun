// PROVENANCE: RECONSTRUCTED_FROM_ORDER; convenience routing delegates to the historical oracle selector.
import {
  selectRoute,
  type LogicalMessage,
  type TransportCapabilities,
} from '../../../../canary/zep-core-canary/vendor/zep-core/src/index.js';
import type { TransportProfile } from './types.js';

function capability(profile: TransportProfile): TransportCapabilities {
  const cost = profile.costClass === 'LOW' ? 0 : profile.costClass === 'METERED' ? 1 : 2;
  return {
    adapterId: profile.id,
    adapterVersion: 'demo-071',
    maximumPayloadBytes: profile.maxPayloadBytes,
    supportsBinary: true,
    supportsFragmentation: true,
    supportsTransportReceipt: false,
    supportsEndRecipientReceipt: profile.supportsApplicationAck,
    supportsCancel: false,
    supportsBackground: true,
    supportsStoreAndForward: false,
    requiresUserPresence: false,
    requiresExternalHardware: false,
    requiresOperatorEntitlement: false,
    availabilityClass: profile.available ? 3 : 0,
    expectedLatencyClass: 1,
    estimatedCompletionDurationMs: profile.estimatedCompletionDurationMs,
    monetaryCostClass: cost,
    energyCostClass: cost,
    privacyMetadataClass: 1,
    currentEligibility: profile.available ? 'ALLOWED' : 'DENIED',
    duplicateSafe: true,
  };
}

export function chooseTransport(
  message: LogicalMessage,
  profiles: readonly TransportProfile[],
  nowMs: number,
): TransportProfile {
  const decision = selectRoute(
    message,
    {
      fragmentBytes: message.payload.byteLength,
      fragmentCount: 1,
      requiresBinary: true,
      requiresFragmentation: false,
      requiresTransportReceipt: false,
      requiresEndRecipientReceipt: true,
    },
    profiles.map(capability),
    {
      version: 'extension-demo-policy-v1',
      maximumMonetaryCostClass: 9,
      maximumEnergyCostClass: 9,
      maximumPrivacyMetadataClass: 9,
      acceptsDuplicationRisk: false,
    },
    nowMs,
  );
  return Object.freeze({ ...profiles.find((profile) => profile.id === decision.adapterId)! });
}
