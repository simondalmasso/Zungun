import { createHash } from 'node:crypto';
import type { DeliveryProfileV2 } from './types.js';

export type DeferredRequirement = 'REQUIRED_FOR_EFFECT' | 'REQUIRED_FOR_FINAL_EVIDENCE' | 'OPTIONAL';
export type DeltaKind = 'NONE' | 'DOMAIN_SUPPLIED_DELTA' | 'JSON_PATCH_EXACT_BASE' | 'CONTENT_ADDRESSED_CHUNK_MANIFEST';

export interface DeferredObjectDescriptor {
  readonly objectId: string;
  readonly contentType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly requirement: DeferredRequirement;
  readonly chunkSizeBytes: number;
  readonly chunkHashes: readonly string[];
}

export interface OperationPayloadV2 {
  readonly payloadVersion: 2;
  readonly criticalCore: Uint8Array;
  readonly criticalCoreContentType: string;
  readonly criticalCoreCommitment: string;
  readonly deferredObjects: readonly DeferredObjectDescriptor[];
}

export interface DeltaEnvelope {
  readonly kind: DeltaKind;
  readonly baseSha256: string | null;
  readonly resultSha256: string;
  readonly deltaSha256: string | null;
  readonly byteLength: number;
}

export interface TransferCheckpoint {
  readonly objectId: string;
  readonly objectSha256: string;
  readonly confirmedOffset: number;
  readonly confirmedPrefixSha256: string;
  readonly remoteVersion: string | null;
  readonly updatedAtMs: number;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function contentAddressedObject(
  bytes: Uint8Array,
  contentType: string,
  requirement: DeferredRequirement,
  chunkSizeBytes = 256 * 1024,
): DeferredObjectDescriptor {
  if (!Number.isSafeInteger(chunkSizeBytes) || chunkSizeBytes < 1024 || chunkSizeBytes > 4 * 1024 * 1024) {
    throw new Error('INVALID_CHUNK_SIZE');
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSizeBytes) {
    chunks.push(sha256Bytes(bytes.subarray(offset, Math.min(offset + chunkSizeBytes, bytes.byteLength))));
  }
  const sha256 = sha256Bytes(bytes);
  return Object.freeze({
    objectId: `sha256:${sha256}`,
    contentType,
    byteLength: bytes.byteLength,
    sha256,
    requirement,
    chunkSizeBytes,
    chunkHashes: Object.freeze(chunks),
  });
}

export function buildOperationPayload(
  criticalCore: Uint8Array,
  criticalCoreContentType: string,
  deferredObjects: readonly DeferredObjectDescriptor[],
): OperationPayloadV2 {
  if (criticalCore.byteLength < 1) throw new Error('EMPTY_CRITICAL_CORE');
  if (criticalCore.byteLength > 64 * 1024) throw new Error('CRITICAL_CORE_TOO_LARGE');
  const seen = new Set<string>();
  for (const object of deferredObjects) {
    if (seen.has(object.objectId)) throw new Error('DUPLICATE_DEFERRED_OBJECT');
    seen.add(object.objectId);
  }
  return Object.freeze({
    payloadVersion: 2,
    criticalCore,
    criticalCoreContentType,
    criticalCoreCommitment: sha256Bytes(criticalCore),
    deferredObjects: Object.freeze([...deferredObjects]),
  });
}

export function assertDeferredObjectIntegrity(descriptor: DeferredObjectDescriptor, bytes: Uint8Array): void {
  if (bytes.byteLength !== descriptor.byteLength) throw new Error('DEFERRED_LENGTH_MISMATCH');
  if (sha256Bytes(bytes) !== descriptor.sha256) throw new Error('DEFERRED_HASH_MISMATCH');
  const expected = contentAddressedObject(bytes, descriptor.contentType, descriptor.requirement, descriptor.chunkSizeBytes);
  if (expected.chunkHashes.length !== descriptor.chunkHashes.length ||
      expected.chunkHashes.some((hash, index) => hash !== descriptor.chunkHashes[index])) {
    throw new Error('DEFERRED_CHUNK_HASH_MISMATCH');
  }
}

export function validateDeltaBase(delta: DeltaEnvelope, availableBaseSha256: string | null): 'APPLY' | 'FULL_FALLBACK_OR_DEFER' {
  if (delta.kind === 'NONE') return 'FULL_FALLBACK_OR_DEFER';
  if (delta.baseSha256 === null || availableBaseSha256 === null || delta.baseSha256 !== availableBaseSha256) {
    return 'FULL_FALLBACK_OR_DEFER';
  }
  return 'APPLY';
}

export function resumeOffset(
  descriptor: DeferredObjectDescriptor,
  checkpoint: TransferCheckpoint | null,
): number {
  if (checkpoint === null) return 0;
  if (checkpoint.objectId !== descriptor.objectId || checkpoint.objectSha256 !== descriptor.sha256) {
    throw new Error('CHECKPOINT_OBJECT_MISMATCH');
  }
  if (!Number.isSafeInteger(checkpoint.confirmedOffset) || checkpoint.confirmedOffset < 0 || checkpoint.confirmedOffset > descriptor.byteLength) {
    throw new Error('CHECKPOINT_OFFSET_INVALID');
  }
  if (checkpoint.confirmedOffset !== descriptor.byteLength && checkpoint.confirmedOffset % descriptor.chunkSizeBytes !== 0) {
    throw new Error('CHECKPOINT_NOT_CHUNK_ALIGNED');
  }
  return checkpoint.confirmedOffset;
}

export function shouldPrefetch(profile: DeliveryProfileV2, validated: boolean, metered: boolean, congested: boolean, roaming: boolean): boolean {
  if (!validated || congested) return false;
  if (metered && !profile.allowMetered) return false;
  if (roaming && !profile.allowRoaming) return false;
  return profile.heavyDataPolicy !== 'GOOD_LINK_ONLY' || (!metered && !roaming);
}
