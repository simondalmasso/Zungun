import { canonicalize, sha256Hex, type CanonicalValue } from './canonical.js';

export const PROTOCOL_VERSION = 'zungun.operation.v1' as const;
export type OperationPriority = 0 | 1 | 2 | 3;
export type ApplicationOutcome = 'EFFECT_APPLIED' | 'NO_EFFECT' | 'REJECTED' | 'UNKNOWN' | 'DUPLICATE' | 'COMPENSATION_REQUIRED';
export type FailureCode =
  | 'INVALID_WIRE_CONTRACT' | 'AUTHENTICATION_FAILED' | 'REPLAY_DETECTED' | 'DUPLICATE_CONFLICT'
  | 'TTL_EXPIRED' | 'SEMANTIC_PRECONDITION_FAILED' | 'LEASE_LOST' | 'STORAGE_FAILURE'
  | 'APPLICATION_ACK_MISSING' | 'EVIDENCE_CONTRADICTION' | 'KEY_REVOKED' | 'UNSUPPORTED_VERSION';

export interface OperationIdentityInput {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly localSequence: number;
  readonly createdAtMs: number;
}

export function stableOperationId(input: OperationIdentityInput): string {
  if (!Number.isSafeInteger(input.localSequence) || input.localSequence < 0) throw new TypeError('localSequence must be non-negative safe integer');
  if (!Number.isSafeInteger(input.createdAtMs) || input.createdAtMs < 0) throw new TypeError('createdAtMs must be epoch milliseconds');
  for (const [key, value] of Object.entries({ tenantId: input.tenantId, deviceId: input.deviceId })) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new TypeError(`${key} is invalid`);
  }
  const digest = sha256Hex(canonicalize({
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    localSequence: input.localSequence,
    createdAtMs: input.createdAtMs,
  }));
  return `op_${digest.slice(0, 40)}`;
}

export interface OperationPolicy {
  readonly priority: OperationPriority;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly retryBudget: number;
  readonly cancellationAllowed: boolean;
  readonly semanticRevalidationRequired: boolean;
  readonly maxPayloadBytes: number;
}

export function validateOperationPolicy(policy: OperationPolicy): Readonly<OperationPolicy> {
  if (![0, 1, 2, 3].includes(policy.priority)) throw new TypeError('priority must be 0..3');
  if (!Number.isSafeInteger(policy.createdAtMs) || !Number.isSafeInteger(policy.expiresAtMs) || policy.expiresAtMs <= policy.createdAtMs) throw new TypeError('invalid operation deadline');
  if (!Number.isSafeInteger(policy.retryBudget) || policy.retryBudget < 0 || policy.retryBudget > 100) throw new TypeError('retryBudget must be 0..100');
  if (!Number.isSafeInteger(policy.maxPayloadBytes) || policy.maxPayloadBytes < 1 || policy.maxPayloadBytes > 10_000_000) throw new TypeError('invalid maxPayloadBytes');
  return Object.freeze({ ...policy });
}

export interface VersionRange { readonly minimum: 1; readonly maximum: number; }
export function negotiateVersion(local: VersionRange, remote: VersionRange): number {
  const selected = Math.min(local.maximum, remote.maximum);
  if (selected < Math.max(local.minimum, remote.minimum)) throw new Error('UNSUPPORTED_VERSION');
  return selected;
}

export interface OperationEnvelope {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly wireVersion: 1;
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly scopeType: 'ROUTE' | 'SHIFT' | 'DEVICE' | 'BATCH';
  readonly scopeId: string;
  readonly workOrderId: string;
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly payloadBase64: string;
  readonly contentType: string;
  readonly policy: OperationPolicy;
  readonly replayNonce: string;
  readonly extensions: Readonly<Record<string, CanonicalValue>>;
}

export function envelopeCommitment(envelope: OperationEnvelope): string {
  const canonical: CanonicalValue = {
    protocol: envelope.protocol,
    wireVersion: envelope.wireVersion,
    operationId: envelope.operationId,
    idempotencyKey: envelope.idempotencyKey,
    tenantId: envelope.tenantId,
    scopeType: envelope.scopeType,
    scopeId: envelope.scopeId,
    workOrderId: envelope.workOrderId,
    messageId: envelope.messageId,
    messageCommitment: envelope.messageCommitment,
    payloadBase64: envelope.payloadBase64,
    contentType: envelope.contentType,
    policy: {
      priority: envelope.policy.priority,
      createdAtMs: envelope.policy.createdAtMs,
      expiresAtMs: envelope.policy.expiresAtMs,
      retryBudget: envelope.policy.retryBudget,
      cancellationAllowed: envelope.policy.cancellationAllowed,
      semanticRevalidationRequired: envelope.policy.semanticRevalidationRequired,
      maxPayloadBytes: envelope.policy.maxPayloadBytes,
    },
    replayNonce: envelope.replayNonce,
    extensions: envelope.extensions,
  };
  return `sha256:${sha256Hex(canonicalize(canonical))}`;
}

export function validateEnvelope(value: unknown, nowMs: number): Readonly<OperationEnvelope> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('INVALID_WIRE_CONTRACT');
  const v = value as Record<string, unknown>;
  const exact = ['protocol','wireVersion','operationId','idempotencyKey','tenantId','scopeType','scopeId','workOrderId','messageId','messageCommitment','payloadBase64','contentType','policy','replayNonce','extensions'];
  const keys = Object.keys(v).sort();
  if (keys.join('|') !== exact.sort().join('|')) throw new Error('INVALID_WIRE_CONTRACT');
  if (v.protocol !== PROTOCOL_VERSION || v.wireVersion !== 1) throw new Error('UNSUPPORTED_VERSION');
  for (const key of ['operationId','idempotencyKey','tenantId','scopeId','workOrderId','messageId','messageCommitment','replayNonce'] as const) {
    if (typeof v[key] !== 'string' || !/^[A-Za-z0-9._:+/-]{1,256}$/.test(v[key] as string)) throw new Error('INVALID_WIRE_CONTRACT');
  }
  if (!['ROUTE','SHIFT','DEVICE','BATCH'].includes(v.scopeType as string)) throw new Error('INVALID_WIRE_CONTRACT');
  if (typeof v.payloadBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.payloadBase64) || v.payloadBase64.length % 4 === 1) throw new Error('INVALID_PAYLOAD_BASE64');
  const decodedPayload = Buffer.from(v.payloadBase64, 'base64');
  if (decodedPayload.toString('base64').replace(/=+$/, '') !== v.payloadBase64.replace(/=+$/, '')) throw new Error('INVALID_PAYLOAD_BASE64');
  if (typeof v.contentType !== 'string' || v.contentType.length < 1 || v.contentType.length > 128) throw new Error('INVALID_WIRE_CONTRACT');
  const policy = validateOperationPolicy(v.policy as OperationPolicy);
  if (policy.createdAtMs > nowMs + 300_000) throw new Error('CREATED_IN_FUTURE');
  if (policy.expiresAtMs <= nowMs) throw new Error('TTL_EXPIRED');
  if (decodedPayload.length > policy.maxPayloadBytes) throw new Error('INVALID_WIRE_CONTRACT');
  if (typeof v.extensions !== 'object' || v.extensions === null || Array.isArray(v.extensions)) throw new Error('INVALID_WIRE_CONTRACT');
  return Object.freeze({ ...(v as unknown as OperationEnvelope), policy, extensions: Object.freeze({ ...(v.extensions as Record<string, CanonicalValue>) }) });
}
