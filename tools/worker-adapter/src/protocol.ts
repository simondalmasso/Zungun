import { createHash } from 'node:crypto';

export const WORKER_ID = 'zungun' as const;
export const JOB_SCHEMA = 'ZUNGUN_ATM_WORKER_JOB_V1' as const;
export const STATE_SCHEMA = 'ZUNGUN_ATM_WORKER_STATE_V1' as const;

export const ZUNGUN_CAPABILITIES = Object.freeze([
  'zungun.network_resilience',
  'zungun.offline_sync',
  'zungun.idempotency_retry',
  'zungun.ambiguous_timeout',
  'zungun.reconciliation',
  'zungun.android_background_work',
  'zungun.resumable_transfer',
  'zungun.blackout_testing',
  'zungun.reliability_audit',
  'zungun.evidence_generation',
] as const);

export type ZungunCapability = (typeof ZUNGUN_CAPABILITIES)[number];
export type WorkerDomainStatus = 'PENDING' | 'RUNNING' | 'COMPLETED_WITH_FINDINGS' | 'COMPLETED' | 'UNKNOWN' | 'AMBIGUOUS' | 'CANCELLED' | 'REJECTED' | 'QUARANTINED';

export interface WorkerJobSpecRaw {
  readonly job_id: string;
  readonly canonical_opportunity_id: string;
  readonly external_source: string;
  readonly external_url: string;
  readonly task_type: string;
  readonly frozen_acceptance_criteria: readonly string[];
  readonly repository_or_input: string;
  readonly deadline: string | null;
  readonly scope_hash: string;
  readonly max_spend_usd: string | number;
  readonly required_capabilities: readonly string[];
  readonly structured_requirements: readonly string[];
  readonly target_base_sha: string | null;
  readonly allowed_paths: readonly string[];
  readonly expected_deliverable: string | null;
  readonly deterministic_checks: readonly string[];
}

export interface WorkLeaseRaw {
  readonly lease_id: string;
  readonly canonical_opportunity_id: string;
  readonly worker_id: string;
  readonly scope_hash: string;
  readonly acquired_at: string;
  readonly expires_at: string;
  readonly heartbeat_at: string;
  readonly terminal_state: string | null;
}

export interface WorkerEnvelopeRaw {
  readonly schema: typeof JOB_SCHEMA;
  readonly execution_job_id: string;
  readonly job_spec_hash: string;
  readonly worker_id: typeof WORKER_ID;
  readonly worker_source_sha: string;
  readonly execution_budget_ms: number;
  readonly worker_job_spec: WorkerJobSpecRaw;
  readonly work_lease: WorkLeaseRaw;
}

export interface StoredArtifact {
  readonly id: string;
  readonly relative_path: string;
  readonly sha256: string;
  readonly kind: string;
}

export interface WorkerAck {
  readonly schema: 'ZUNGUN_WORKER_ACK_V1';
  readonly type: 'ACK';
  readonly origin: 'ZUNGUN';
  readonly status: 'ACKNOWLEDGED';
  readonly worker_id: typeof WORKER_ID;
  readonly execution_job_id: string;
  readonly lease_id: string;
  readonly scope_hash: string;
  readonly job_spec_hash: string;
  readonly worker_source_sha: string;
  readonly execution_identity_hash: string;
  readonly acknowledged_at: string;
  readonly receipt_hash: string;
}

export interface ProgressReceipt {
  readonly schema: 'ZUNGUN_WORKER_PROGRESS_V1';
  readonly type: 'PROGRESS';
  readonly origin: 'ZUNGUN';
  readonly execution_job_id: string;
  readonly checkpoint_seq: number;
  readonly objective_hash: string;
  readonly artifact_before_hash: string;
  readonly artifact_after_hash: string;
  readonly tests_checks_run: readonly string[];
  readonly new_evidence_refs: readonly string[];
  readonly domain_state: string;
  readonly uncertainty_acceptance_delta: string;
  readonly error_signature: string | null;
  readonly timestamp: string;
  readonly receipt_hash: string;
}

export interface FindingSummary {
  readonly rule_id: string;
  readonly severity: string;
  readonly location: string;
  readonly evidence: string;
  readonly status: 'UNRESOLVED' | 'UNKNOWN' | 'AMBIGUOUS';
}

export interface WorkerResult {
  readonly schema: 'ZUNGUN_WORKER_RESULT_V1';
  readonly type: 'RESULT';
  readonly origin: 'ZUNGUN';
  readonly worker_id: typeof WORKER_ID;
  readonly execution_job_id: string;
  readonly job_id: string;
  readonly work_lease_id: string;
  readonly scope_hash: string;
  readonly job_spec_hash: string;
  readonly worker_source_sha: string;
  readonly target_repository: string;
  readonly target_base_sha: string;
  readonly final_target_sha: string;
  readonly allowed_paths: readonly string[];
  readonly changed_paths: readonly string[];
  readonly execution_state: WorkerDomainStatus;
  readonly tests_checks: readonly string[];
  readonly resolved_findings: readonly FindingSummary[];
  readonly unresolved_findings: readonly FindingSummary[];
  readonly unknown_findings: readonly FindingSummary[];
  readonly artifact_identifiers: readonly string[];
  readonly evidence_identifiers: readonly string[];
  readonly content_hashes: readonly string[];
  readonly limitations: readonly string[];
  readonly outgoing_spend_usd: 0;
  readonly started_at: string;
  readonly finished_at: string;
  readonly result_hash: string;
}

export interface WorkerState {
  readonly schema: typeof STATE_SCHEMA;
  readonly envelope: WorkerEnvelopeRaw;
  readonly execution_identity_hash: string;
  readonly target_root: string;
  readonly started_at: string;
  readonly acknowledged_at: string;
  readonly ack: WorkerAck;
  checkpoint_seq: number;
  completed_phases: string[];
  artifacts: StoredArtifact[];
  progress: ProgressReceipt[];
  findings: FindingSummary[];
  target_instruction_conflicts: string[];
  known_side_effect_state: 'NONE' | 'PROVEN_NO_TARGET_MUTATION';
  domain_status: WorkerDomainStatus;
  cancellation_requested: boolean;
  terminal: boolean;
  result: WorkerResult | null;
  readonly initial_target_snapshot_hash: string;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) out[key] = normalize(input[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalHash(value: unknown): string {
  return sha256Text(canonicalJson(value));
}

export function jobSpecHash(spec: WorkerJobSpecRaw): string {
  return canonicalHash(spec);
}

export function scopeHash(spec: WorkerJobSpecRaw): string {
  const raw = { ...(spec as unknown as Record<string, unknown>) };
  delete raw.scope_hash;
  return canonicalHash(raw);
}

export function executionJobId(spec: WorkerJobSpecRaw, lease: WorkLeaseRaw, jobHash: string): string {
  return 'exec_' + canonicalHash({
    opportunity_id: spec.canonical_opportunity_id,
    worker_id: WORKER_ID,
    work_lease_id: lease.lease_id,
    scope_hash: spec.scope_hash,
    job_spec_hash: jobHash,
  }).slice(0, 40);
}

export function executionIdentityHash(envelope: WorkerEnvelopeRaw): string {
  return canonicalHash({
    execution_job_id: envelope.execution_job_id,
    job_spec_hash: envelope.job_spec_hash,
    lease_id: envelope.work_lease.lease_id,
    scope_hash: envelope.worker_job_spec.scope_hash,
    worker_source_sha: envelope.worker_source_sha,
    target_base_sha: envelope.worker_job_spec.target_base_sha,
    allowed_paths: [...envelope.worker_job_spec.allowed_paths],
  });
}

export function withHash<T extends Record<string, unknown>>(value: T, field: string): T & Record<string, string> {
  const payload = { ...value } as Record<string, unknown>;
  delete payload[field];
  return { ...value, [field]: canonicalHash(payload) } as T & Record<string, string>;
}
