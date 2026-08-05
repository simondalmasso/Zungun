import type { OperationEnvelope } from '../../../packages/protocol-core/src/operation.js';
import type { EffectInput } from '../../../services/receiver/src/receiver.js';

export type ScenarioName =
  | 'offline_transport' | 'intermittent_transport' | 'delay' | 'timeout' | 'duplication'
  | 'reordering' | 'truncation' | 'process_death' | 'reboot' | 'upgrade' | 'clock_skew'
  | 'ttl_expiry' | 'storage_failure' | 'receiver_crash' | 'lease_loss' | 'ack_loss'
  | 'delayed_effect' | 'database_erp_mismatch' | 'receipt_tampering' | 'stale_key'
  | 'revoked_key' | 'reconciliation_contradiction';

export interface ResilienceScenario {
  readonly name: ScenarioName;
  readonly seed: number;
  readonly expectedVerdict: 'EFFECT_CONFIRMED' | 'NO_EFFECT_CONFIRMED' | 'UNKNOWN' | 'COMPENSATION_REQUIRED' | 'REJECTED';
  readonly transportAttempts: number;
  readonly mutation: (envelope: OperationEnvelope) => OperationEnvelope;
  readonly effect: EffectInput | null;
  readonly expectedFailure?: string;
}

const same = (envelope: OperationEnvelope): OperationEnvelope => envelope;
const baseEffect = (occurredAtMs: number): EffectInput => ({
  outcome: 'EFFECT_APPLIED',
  applicationReference: 'erp:WO-2841:v7',
  workOrderStatus: 'CLOSED',
  result: { ok: true, version: 7 },
  occurredAtMs,
});

export function deterministicScenarios(baseTimeMs: number): readonly ResilienceScenario[] {
  const unknown: EffectInput = { outcome: 'UNKNOWN', applicationReference: 'transport:ambiguous', workOrderStatus: 'UNCHANGED', result: { reason: 'ACK_MISSING' }, occurredAtMs: baseTimeMs + 40 };
  const noEffect: EffectInput = { outcome: 'NO_EFFECT', applicationReference: 'erp:no-effect', workOrderStatus: 'OPEN', result: { changed: false }, occurredAtMs: baseTimeMs + 40 };
  return Object.freeze([
    { name:'offline_transport',seed:75001,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:3,mutation:same,effect:baseEffect(baseTimeMs+40) },
    { name:'intermittent_transport',seed:75002,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:4,mutation:same,effect:baseEffect(baseTimeMs+40) },
    { name:'delay',seed:75003,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:2,mutation:same,effect:baseEffect(baseTimeMs+400) },
    { name:'timeout',seed:75004,expectedVerdict:'UNKNOWN',transportAttempts:2,mutation:same,effect:unknown },
    { name:'duplication',seed:75005,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:5,mutation:same,effect:baseEffect(baseTimeMs+40) },
    { name:'reordering',seed:75006,expectedVerdict:'UNKNOWN',transportAttempts:2,mutation:same,effect:unknown },
    { name:'truncation',seed:75007,expectedVerdict:'REJECTED',transportAttempts:1,mutation:(e)=>({...e,payloadBase64:e.payloadBase64.slice(0,3)}),effect:null,expectedFailure:'INVALID_PAYLOAD_BASE64' },
    { name:'process_death',seed:75008,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:2,mutation:same,effect:baseEffect(baseTimeMs+40) },
    { name:'reboot',seed:75009,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:2,mutation:same,effect:baseEffect(baseTimeMs+40) },
    { name:'upgrade',seed:75010,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:1,mutation:(e)=>({...e,extensions:{...e.extensions,clientVersion:'android-order075-upgraded'}}),effect:baseEffect(baseTimeMs+40) },
    { name:'clock_skew',seed:75011,expectedVerdict:'REJECTED',transportAttempts:1,mutation:(e)=>({...e,policy:{...e.policy,createdAtMs:baseTimeMs+999_999,expiresAtMs:baseTimeMs+1_999_999}}),effect:null,expectedFailure:'CREATED_IN_FUTURE' },
    { name:'ttl_expiry',seed:75012,expectedVerdict:'REJECTED',transportAttempts:1,mutation:(e)=>({...e,policy:{...e.policy,expiresAtMs:baseTimeMs+1}}),effect:null,expectedFailure:'TTL_EXPIRED' },
    { name:'storage_failure',seed:75013,expectedVerdict:'UNKNOWN',transportAttempts:1,mutation:same,effect:unknown },
    { name:'receiver_crash',seed:75014,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:2,mutation:same,effect:baseEffect(baseTimeMs+40) },
    { name:'lease_loss',seed:75015,expectedVerdict:'UNKNOWN',transportAttempts:2,mutation:same,effect:unknown,expectedFailure:'LEASE_LOST' },
    { name:'ack_loss',seed:75016,expectedVerdict:'UNKNOWN',transportAttempts:2,mutation:same,effect:unknown },
    { name:'delayed_effect',seed:75017,expectedVerdict:'EFFECT_CONFIRMED',transportAttempts:2,mutation:same,effect:baseEffect(baseTimeMs+600) },
    { name:'database_erp_mismatch',seed:75018,expectedVerdict:'COMPENSATION_REQUIRED',transportAttempts:1,mutation:same,effect:unknown },
    { name:'receipt_tampering',seed:75019,expectedVerdict:'REJECTED',transportAttempts:1,mutation:same,effect:noEffect,expectedFailure:'RECEIPT_INVALID' },
    { name:'stale_key',seed:75020,expectedVerdict:'REJECTED',transportAttempts:1,mutation:same,effect:noEffect,expectedFailure:'KEY_NOT_YET_VALID' },
    { name:'revoked_key',seed:75021,expectedVerdict:'REJECTED',transportAttempts:1,mutation:same,effect:noEffect,expectedFailure:'KEY_REVOKED' },
    { name:'reconciliation_contradiction',seed:75022,expectedVerdict:'COMPENSATION_REQUIRED',transportAttempts:1,mutation:same,effect:unknown },
  ]);
}
