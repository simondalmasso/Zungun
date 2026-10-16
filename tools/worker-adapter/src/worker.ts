import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeOpenApi, analyzeSource } from '../../link-doctor/src/analyze.js';
import { runLinkBlackoutDrill } from '../../resilience-lab/src/link-blackout-drill.js';
import {
  JOB_SCHEMA,
  STATE_SCHEMA,
  WORKER_ID,
  ZUNGUN_CAPABILITIES,
  canonicalHash,
  canonicalJson,
  executionIdentityHash,
  executionJobId,
  jobSpecHash,
  scopeHash,
  type FindingSummary,
  type ProgressReceipt,
  type StoredArtifact,
  type WorkerAck,
  type WorkerDomainStatus,
  type WorkerEnvelopeRaw,
  type WorkerJobSpecRaw,
  type WorkerResult,
  type WorkerState,
  type WorkLeaseRaw,
} from './protocol.js';

const ENVELOPE_KEYS = new Set([
  'schema',
  'execution_job_id',
  'job_spec_hash',
  'worker_id',
  'worker_source_sha',
  'execution_budget_ms',
  'worker_job_spec',
  'work_lease',
]);
const SPEC_KEYS = new Set([
  'job_id',
  'canonical_opportunity_id',
  'external_source',
  'external_url',
  'task_type',
  'frozen_acceptance_criteria',
  'repository_or_input',
  'deadline',
  'scope_hash',
  'max_spend_usd',
  'required_capabilities',
  'structured_requirements',
  'target_base_sha',
  'allowed_paths',
  'expected_deliverable',
  'deterministic_checks',
]);
const LEASE_KEYS = new Set([
  'lease_id',
  'canonical_opportunity_id',
  'worker_id',
  'scope_hash',
  'acquired_at',
  'expires_at',
  'heartbeat_at',
  'terminal_state',
]);
const AUX_CAPABILITIES = new Set(['git', 'github', 'filesystem', 'shell', 'node', 'evidence']);
const SUPPORTED_CHECKS = new Set([
  'link_doctor',
  'target_clean',
  'scope_unchanged',
  'hash_artifacts',
  'blackout_core',
  'no_authority_expansion',
]);
const AUTHORITY_TERMS = [
  'financial_authority',
  'claim_authority',
  'submission_authority',
  'payment_truth_authority',
  'wallet_authority',
  'signing_authority',
  'atm_lifecycle_authority',
  'worklease_mint_authority',
  'worklease_renew_authority',
  'worker_selection_authority',
  'skill_self_promotion_authority',
  'skill_promotion_authority',
];
const FORBIDDEN_RESULT_AUTHORITY_KEYS = new Set([
  'accepted',
  'external_accepted',
  'checker_pass',
  'paid',
  'payment_status',
  'withdrawable',
  'withdrawable_usdc',
  'realized_revenue',
  'claim_success',
  'submission_success',
  'payout_success',
]);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.kt', '.kts', '.java', '.py', '.go', '.rs',
  '.json', '.yaml', '.yml', '.md', '.txt', '.toml', '.xml', '.gradle',
]);
const UNKNOWN_RULES = new Set([
  'ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE',
  'ZL006_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_SUCCESS',
  'ZL015_NO_RECEIVER_RECONCILIATION_PATH',
]);
const FORBIDDEN_AMBIENT_SECRET_ENV = new Set([
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'WALLET_PRIVATE_KEY',
  'PRIVATE_KEY',
  'MNEMONIC',
  'SEED_PHRASE',
]);
const MAX_JOB_INPUT_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_FILE_COUNT = 2048;

export class WorkerReject extends Error {
  constructor(readonly reasonCode: string, message = reasonCode) {
    super(message);
  }
}

interface TargetSnapshot {
  readonly head: string;
  readonly remote: string;
  readonly files: readonly { path: string; sha256: string; bytes: number }[];
  readonly snapshotHash: string;
  readonly changedPaths: readonly string[];
}

interface AnalysisArtifact {
  readonly schema: 'ZUNGUN_SPECIALIST_ANALYSIS_V1';
  readonly execution_job_id: string;
  readonly profiles: readonly string[];
  readonly findings: readonly FindingSummary[];
  readonly target_instruction_conflicts: readonly string[];
  readonly observed_outcomes: readonly ('UNKNOWN' | 'AMBIGUOUS')[];
  readonly blackout: null | Record<string, unknown>;
  readonly limitations: readonly string[];
}

function asObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkerReject(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>, code: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new WorkerReject(code, `${code}:${key}`);
  }
}

function stringField(value: Record<string, unknown>, key: string, code = 'MALFORMED_JOB'): string {
  const result = value[key];
  if (typeof result !== 'string' || !result.trim()) throw new WorkerReject(code, `${code}:${key}`);
  return result;
}

function nullableString(value: Record<string, unknown>, key: string): string | null {
  const result = value[key];
  if (result === null) return null;
  if (typeof result !== 'string') throw new WorkerReject('MALFORMED_JOB');
  return result;
}

function stringArray(value: Record<string, unknown>, key: string): string[] {
  const raw = value[key];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) throw new WorkerReject('MALFORMED_JOB');
  return raw.map(String);
}

function sha40(value: string, code: string): void {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new WorkerReject(code);
}

function sha64(value: string, code: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new WorkerReject(code);
}

function canonicalExecutionId(value: string): string {
  if (!/^exec_[0-9a-f]{40}$/.test(value)) throw new WorkerReject('MALFORMED_EXECUTION_JOB_ID');
  return value;
}

function dateMs(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new WorkerReject(code);
  return parsed;
}

function hashBytes(value: any): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(root: string, args: string[]): string {
  const run = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.status !== 0) throw new WorkerReject('TARGET_GIT_ERROR', String(run.stderr || '').trim());
  return String(run.stdout || '').trim();
}

function currentWorkerSha(): string {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.status !== 0) throw new WorkerReject('WORKER_SOURCE_UNAVAILABLE');
  return String(run.stdout || '').trim();
}

function normalizeRepo(value: string): string {
  let text = value.trim();
  if (text.startsWith('git@github.com:')) text = 'https://github.com/' + text.slice('git@github.com:'.length);
  if (text.endsWith('.git')) text = text.slice(0, -4);
  return text.replace(/\/$/, '');
}

function changedPaths(root: string): string[] {
  const unstaged = git(root, ['diff', '--name-only']);
  const staged = git(root, ['diff', '--cached', '--name-only']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...unstaged.split('\n'), ...staged.split('\n'), ...untracked.split('\n')].filter(Boolean))].sort();
}

function pathWithin(path: string, allowed: readonly string[]): boolean {
  return allowed.some((prefix) => path === prefix || path.startsWith(prefix + '/'));
}

function pathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

function validateAllowedPaths(paths: readonly string[]): string[] {
  if (paths.length === 0) throw new WorkerReject('EMPTY_OR_UNBOUNDED_ALLOWED_PATHS');
  const result: string[] = [];
  for (const raw of paths) {
    const value = raw.replace(/\\/g, '/').replace(/\/$/, '').trim();
    if (
      !value ||
      isAbsolute(value) ||
      value.startsWith('/') ||
      value.split('/').includes('..') ||
      value.split('/').includes('.git') ||
      /[*?\[\]{}]/.test(value)
    ) {
      throw new WorkerReject('PATH_ESCAPE');
    }
    result.push(value);
  }
  return [...new Set(result)].sort();
}

function assertSafeAmbientEnvironment(): void {
  for (const key of FORBIDDEN_AMBIENT_SECRET_ENV) {
    if (process.env[key]) throw new WorkerReject('AMBIENT_SECRET_ENV_FORBIDDEN', key);
  }
}

function assertNoAuthorityExpansion(value: unknown): void {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const low = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (AUTHORITY_TERMS.some((term) => low === term || low.includes(term))) {
          throw new WorkerReject('AUTHORITY_EXPANSION_REQUEST', `${path}.${key}`);
        }
        if (FORBIDDEN_RESULT_AUTHORITY_KEYS.has(low)) {
          throw new WorkerReject('AUTHORITY_EXPANSION_REQUEST', `${path}.${key}`);
        }
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(value, 'job');
}

export function validatePublishedWorkerResult(value: unknown): void {
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const low = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (FORBIDDEN_RESULT_AUTHORITY_KEYS.has(low) || AUTHORITY_TERMS.some((term) => low === term || low.includes(term))) {
        throw new WorkerReject('WORKER_RESULT_AUTHORITY_FORBIDDEN', `${path}.${key}`);
      }
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, 'result');
}

function assertNoAuthorityStrings(spec: WorkerJobSpecRaw): void {
  const text = [
    spec.task_type,
    ...spec.structured_requirements,
    ...spec.frozen_acceptance_criteria,
    ...spec.deterministic_checks,
  ].join('\n').toLowerCase();
  const risky = [
    ...AUTHORITY_TERMS,
    'extend lease',
    'renew lease',
    'mint lease',
    'claim authority',
    'submission authority',
    'payment truth',
    'wallet authority',
    'signing authority',
    'skill promotion',
  ];
  if (risky.some((term) => text.includes(term))) throw new WorkerReject('AUTHORITY_EXPANSION_REQUEST');
}

function validateCriteria(spec: WorkerJobSpecRaw): void {
  for (const criterion of spec.frozen_acceptance_criteria) {
    if (/^finding:ZL\d{3}_[A-Z0-9_]+$/.test(criterion)) continue;
    if (/^min_findings:\d+$/.test(criterion)) continue;
    if (
      ['no_authority_expansion', 'outgoing_spend_usd:0', 'result_preserves_unknown', 'result_preserves_ambiguous'].includes(criterion)
    ) continue;
    throw new WorkerReject('UNSUPPORTED_ACCEPTANCE_CRITERION', criterion);
  }
  for (const check of spec.deterministic_checks) {
    if (!SUPPORTED_CHECKS.has(check)) throw new WorkerReject('UNSUPPORTED_DETERMINISTIC_CHECK', check);
  }
}

function validateCapabilities(spec: WorkerJobSpecRaw): void {
  const supported = new Set<string>([...ZUNGUN_CAPABILITIES, ...AUX_CAPABILITIES]);
  const unsupported = spec.required_capabilities.filter((value) => !supported.has(value));
  if (unsupported.length) throw new WorkerReject('UNSUPPORTED_CAPABILITY', unsupported.join(','));
  if (!spec.required_capabilities.some((value) => value.startsWith('zungun.'))) throw new WorkerReject('UNSUPPORTED_JOB_PROFILE');
  if (/generic[ _-]?(code|coder|coding)|unrelated/i.test(spec.task_type)) throw new WorkerReject('UNSUPPORTED_JOB_PROFILE');
}

function validateRawEnvelope(raw: unknown): WorkerEnvelopeRaw {
  const envelope = asObject(raw, 'MALFORMED_JOB');
  exactKeys(envelope, ENVELOPE_KEYS, 'UNKNOWN_AUTHORITY_OR_ENVELOPE_FIELD');
  if (envelope.schema !== JOB_SCHEMA || envelope.worker_id !== WORKER_ID) throw new WorkerReject('WRONG_WORKER_ID');
  const executionJob = canonicalExecutionId(stringField(envelope, 'execution_job_id'));
  const jobHash = stringField(envelope, 'job_spec_hash');
  sha64(jobHash, 'WRONG_JOB_SPEC_HASH');
  const source = stringField(envelope, 'worker_source_sha');
  sha40(source, 'WRONG_WORKER_SOURCE_SHA');
  const budget = envelope.execution_budget_ms;
  if (!Number.isSafeInteger(budget) || Number(budget) < 1000 || Number(budget) > 7_200_000) {
    throw new WorkerReject('UNBOUNDED_EXECUTION_BUDGET');
  }
  const specObj = asObject(envelope.worker_job_spec, 'MALFORMED_JOB');
  exactKeys(specObj, SPEC_KEYS, 'UNKNOWN_JOB_SPEC_FIELD');
  const leaseObj = asObject(envelope.work_lease, 'MALFORMED_JOB');
  exactKeys(leaseObj, LEASE_KEYS, 'UNKNOWN_LEASE_FIELD');
  const spec = {
    job_id: stringField(specObj, 'job_id'),
    canonical_opportunity_id: stringField(specObj, 'canonical_opportunity_id'),
    external_source: stringField(specObj, 'external_source'),
    external_url: stringField(specObj, 'external_url'),
    task_type: stringField(specObj, 'task_type'),
    frozen_acceptance_criteria: stringArray(specObj, 'frozen_acceptance_criteria'),
    repository_or_input: stringField(specObj, 'repository_or_input'),
    deadline: nullableString(specObj, 'deadline'),
    scope_hash: stringField(specObj, 'scope_hash'),
    max_spend_usd: specObj.max_spend_usd as string | number,
    required_capabilities: stringArray(specObj, 'required_capabilities'),
    structured_requirements: stringArray(specObj, 'structured_requirements'),
    target_base_sha: nullableString(specObj, 'target_base_sha'),
    allowed_paths: stringArray(specObj, 'allowed_paths'),
    expected_deliverable: nullableString(specObj, 'expected_deliverable'),
    deterministic_checks: stringArray(specObj, 'deterministic_checks'),
  } satisfies WorkerJobSpecRaw;
  const lease = {
    lease_id: stringField(leaseObj, 'lease_id'),
    canonical_opportunity_id: stringField(leaseObj, 'canonical_opportunity_id'),
    worker_id: stringField(leaseObj, 'worker_id'),
    scope_hash: stringField(leaseObj, 'scope_hash'),
    acquired_at: stringField(leaseObj, 'acquired_at'),
    expires_at: stringField(leaseObj, 'expires_at'),
    heartbeat_at: stringField(leaseObj, 'heartbeat_at'),
    terminal_state: nullableString(leaseObj, 'terminal_state'),
  } satisfies WorkLeaseRaw;
  return {
    schema: JOB_SCHEMA,
    execution_job_id: executionJob,
    job_spec_hash: jobHash,
    worker_id: WORKER_ID,
    worker_source_sha: source,
    execution_budget_ms: Number(budget),
    worker_job_spec: spec,
    work_lease: lease,
  };
}

function isSensitiveEnvFile(path: string): boolean {
  const leaf = path.replace(/\\/g, '/').split('/').at(-1) ?? '';
  return /^\.env(?:\.(?:local|production|prod|staging|stage|development|dev|test))?$/.test(leaf);
}

function stateRoot(input?: string, targetRoot?: string): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  const candidate = resolve(input ?? (home ? join(home, '.zungun', 'worker-state') : ''));
  if (!input && !home) throw new WorkerReject('STATE_ROOT_UNAVAILABLE');
  const workerRoot = realpathSync(process.cwd());
  const comparable = existsSync(candidate) ? realpathSync(candidate) : candidate;
  if (pathInside(comparable, workerRoot)) throw new WorkerReject('STATE_ROOT_OVERLAPS_WORKER_SOURCE');
  if (targetRoot) {
    const target = realpathSync(resolve(targetRoot));
    if (pathInside(comparable, target)) throw new WorkerReject('STATE_ROOT_OVERLAPS_TARGET');
  }
  return candidate;
}

function executionDir(root: string, id: string): string {
  return join(root, canonicalExecutionId(id));
}

function statePath(root: string, id: string): string {
  return join(executionDir(root, id), 'state.json');
}

function saveState(root: string, state: WorkerState): void {
  const dir = executionDir(root, state.envelope.execution_job_id);
  mkdirSync(join(dir, 'artifacts'), { recursive: true });
  const path = statePath(root, state.envelope.execution_job_id);
  const temp = path + '.tmp-' + process.pid;
  writeFileSync(temp, canonicalJson(state) + '\n', { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

function loadState(root: string, id: string): WorkerState {
  const path = statePath(root, id);
  if (!existsSync(path)) throw new WorkerReject('EXECUTION_NOT_FOUND');
  const state = JSON.parse(String(readFileSync(path, 'utf8'))) as WorkerState;
  if (state.schema !== STATE_SCHEMA) throw new WorkerReject('STATE_SCHEMA_MISMATCH');
  return state;
}

function assertArtifactSafeText(text: string): void {
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
  ];
  if (credentialPatterns.some((pattern) => pattern.test(text))) throw new WorkerReject('CREDENTIAL_LEAK_DETECTED');
}

function writeArtifact(root: string, state: WorkerState, kind: string, value: unknown): StoredArtifact {
  const text = canonicalJson(value) + '\n';
  assertArtifactSafeText(text);
  const sha = hashBytes(Buffer.from(text, 'utf8'));
  const filename = `${String(state.checkpoint_seq + 1).padStart(3, '0')}-${kind.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${sha.slice(0, 12)}.json`;
  const relativePath = join('artifacts', filename).replace(/\\/g, '/');
  const absolute = join(executionDir(root, state.envelope.execution_job_id), relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, { encoding: 'utf8', mode: 0o600 });
  const artifact = { id: `${kind}:${sha}`, relative_path: relativePath, sha256: sha, kind };
  state.artifacts.push(artifact);
  return artifact;
}

function makeAck(envelope: WorkerEnvelopeRaw, identity: string, at: string): WorkerAck {
  const base = {
    schema: 'ZUNGUN_WORKER_ACK_V1' as const,
    type: 'ACK' as const,
    origin: 'ZUNGUN' as const,
    status: 'ACKNOWLEDGED' as const,
    worker_id: WORKER_ID,
    execution_job_id: envelope.execution_job_id,
    lease_id: envelope.work_lease.lease_id,
    scope_hash: envelope.worker_job_spec.scope_hash,
    job_spec_hash: envelope.job_spec_hash,
    worker_source_sha: envelope.worker_source_sha,
    execution_identity_hash: identity,
    acknowledged_at: at,
  };
  return { ...base, receipt_hash: canonicalHash(base) };
}

function makeProgress(
  state: WorkerState,
  before: string,
  after: string,
  tests: string[],
  evidence: string[],
  domainState: string,
  delta: string,
  error: string | null = null,
): ProgressReceipt {
  const base = {
    schema: 'ZUNGUN_WORKER_PROGRESS_V1' as const,
    type: 'PROGRESS' as const,
    origin: 'ZUNGUN' as const,
    execution_job_id: state.envelope.execution_job_id,
    checkpoint_seq: state.checkpoint_seq + 1,
    objective_hash: state.envelope.worker_job_spec.scope_hash,
    artifact_before_hash: before,
    artifact_after_hash: after,
    tests_checks_run: tests,
    new_evidence_refs: evidence,
    domain_state: domainState,
    uncertainty_acceptance_delta: delta,
    error_signature: error,
    timestamp: new Date().toISOString(),
  };
  return { ...base, receipt_hash: canonicalHash(base) };
}

function addProgress(root: string, state: WorkerState, receipt: ProgressReceipt): void {
  if (receipt.checkpoint_seq !== state.checkpoint_seq + 1) throw new WorkerReject('CHECKPOINT_SEQUENCE_MISMATCH');
  if (
    receipt.artifact_before_hash === receipt.artifact_after_hash &&
    receipt.new_evidence_refs.length === 0 &&
    !receipt.uncertainty_acceptance_delta
  ) {
    throw new WorkerReject('NO_MEANINGFUL_PROGRESS');
  }
  state.checkpoint_seq = receipt.checkpoint_seq;
  state.progress.push(receipt);
  saveState(root, state);
}

function assertIdentity(state: WorkerState, envelope: WorkerEnvelopeRaw, targetRoot: string): void {
  const identity = executionIdentityHash(envelope);
  if (identity !== state.execution_identity_hash) throw new WorkerReject('CONFLICTING_DUPLICATE_EXECUTION_IDENTITY');
  if (realpathSync(resolve(targetRoot)) !== state.target_root) throw new WorkerReject('CONFLICTING_DUPLICATE_TARGET_ROOT');
}

function listAllowedFiles(root: string, allowed: readonly string[]): readonly { path: string; bytes: number; real: string }[] {
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean).sort();
  const rootReal = realpathSync(root);
  const selected: { path: string; bytes: number; real: string }[] = [];
  let totalBytes = 0;
  for (const path of tracked) {
    if (!pathWithin(path, allowed)) continue;
    if (isSensitiveEnvFile(path)) throw new WorkerReject('TARGET_ENV_FILE_FORBIDDEN', path);
    if (selected.length >= MAX_FILE_COUNT) throw new WorkerReject('TARGET_FILE_COUNT_EXCEEDED');
    const absolute = resolve(root, path);
    const real = realpathSync(absolute);
    const rel = relative(rootReal, real);
    if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) throw new WorkerReject('SYMLINK_ESCAPE', path);
    const info = statSync(real);
    if (!info.isFile()) continue;
    const bytes = Number(info.size);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FILE_BYTES) throw new WorkerReject('TARGET_FILE_TOO_LARGE', path);
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new WorkerReject('TARGET_SCOPE_TOO_LARGE');
    selected.push({ path, bytes, real });
  }
  if (!selected.length) throw new WorkerReject('ALLOWED_PATHS_MATCH_NO_TRACKED_FILES');
  return selected;
}

function snapshotTarget(
  root: string,
  allowed: readonly string[],
  head?: string,
  remote?: string,
  changed?: readonly string[],
): TargetSnapshot {
  const bounded = listAllowedFiles(root, allowed);
  const rows = bounded.map(({ path, bytes, real }) => ({
    path,
    bytes,
    sha256: hashBytes(readFileSync(real)),
  }));
  const observedHead = head ?? git(root, ['rev-parse', 'HEAD']);
  const observedRemote = remote ?? normalizeRepo(git(root, ['config', '--get', 'remote.origin.url']));
  const drift = changed ?? changedPaths(root);
  return {
    head: observedHead,
    remote: observedRemote,
    files: rows,
    snapshotHash: canonicalHash({ head: observedHead, remote: observedRemote, files: rows }),
    changedPaths: [...drift],
  };
}

function detectTargetConflicts(root: string, files: readonly { path: string; bytes: number }[]): string[] {
  const patterns: [RegExp, string][] = [
    [/ignore (?:all |previous )?(?:instructions|scope)/i, 'IGNORE_IMMUTABLE_SCOPE'],
    [/(?:widen|expand|override|change).{0,50}(?:allowed_paths|scope_hash|target_base_sha|lease|execution_job_id)/i, 'SCOPE_EXPANSION_INSTRUCTION'],
    [/(?:financial|claim|submission|payment|wallet|signing)[ _-]?authority.{0,20}(?:true|grant|enable)/i, 'AUTHORITY_EXPANSION_INSTRUCTION'],
    [/(?:send|print|exfiltrate|upload).{0,40}(?:secret|token|credential|private key)/i, 'SECRET_EXFILTRATION_INSTRUCTION'],
    [/max_spend_usd.{0,10}(?:[1-9]|increase|nonzero)/i, 'SPEND_EXPANSION_INSTRUCTION'],
  ];
  const found: string[] = [];
  for (const file of files) {
    const text = String(readFileSync(resolve(root, file.path), 'utf8'));
    for (const [pattern, code] of patterns) {
      if (pattern.test(text)) found.push(`${code}:${file.path}`);
    }
  }
  return [...new Set(found)].sort();
}

export function validateEnvelope(raw: unknown, targetRoot: string, now = Date.now()): { envelope: WorkerEnvelopeRaw; snapshot: TargetSnapshot } {
  assertSafeAmbientEnvironment();
  assertNoAuthorityExpansion(raw);
  const envelope = validateRawEnvelope(raw);
  const spec = envelope.worker_job_spec;
  const lease = envelope.work_lease;
  assertNoAuthorityStrings(spec);
  validateCapabilities(spec);
  validateCriteria(spec);
  if (!spec.external_url.startsWith('https://')) throw new WorkerReject('MALFORMED_JOB');
  if (!spec.repository_or_input.startsWith('https://github.com/')) throw new WorkerReject('TARGET_REPOSITORY_MISMATCH');
  if (Number(spec.max_spend_usd) !== 0 || (process.env.ATM_MAX_SPEND_USD && Number(process.env.ATM_MAX_SPEND_USD) !== 0)) {
    throw new WorkerReject('NONZERO_SPEND');
  }
  if (spec.target_base_sha === null) throw new WorkerReject('TARGET_BASE_SHA_REQUIRED');
  sha40(spec.target_base_sha, 'TARGET_BASE_SHA_MISMATCH');
  validateAllowedPaths(spec.allowed_paths);
  sha64(spec.scope_hash, 'WRONG_SCOPE_HASH');
  if (scopeHash(spec) !== spec.scope_hash) throw new WorkerReject('WRONG_SCOPE_HASH');
  if (jobSpecHash(spec) !== envelope.job_spec_hash) throw new WorkerReject('WRONG_JOB_SPEC_HASH');
  const expectedExec = executionJobId(spec, lease, envelope.job_spec_hash);
  if (expectedExec !== envelope.execution_job_id) throw new WorkerReject('WRONG_EXECUTION_JOB_ID_BINDING');
  if (process.env.ATM_EXECUTION_JOB_ID && process.env.ATM_EXECUTION_JOB_ID !== envelope.execution_job_id) {
    throw new WorkerReject('WRONG_EXECUTION_JOB_ID_BINDING');
  }
  if (lease.worker_id !== WORKER_ID) throw new WorkerReject('WRONG_LEASE');
  if (lease.canonical_opportunity_id !== spec.canonical_opportunity_id || lease.scope_hash !== spec.scope_hash) {
    throw new WorkerReject('WRONG_LEASE');
  }
  if (process.env.ATM_WORK_LEASE_ID && process.env.ATM_WORK_LEASE_ID !== lease.lease_id) throw new WorkerReject('WRONG_LEASE');
  if (process.env.ATM_SCOPE_HASH && process.env.ATM_SCOPE_HASH !== spec.scope_hash) throw new WorkerReject('WRONG_SCOPE_HASH');
  if (process.env.ATM_JOB_SPEC_HASH && process.env.ATM_JOB_SPEC_HASH !== envelope.job_spec_hash) throw new WorkerReject('WRONG_JOB_SPEC_HASH');
  const acquired = dateMs(lease.acquired_at, 'WRONG_LEASE');
  const heartbeat = dateMs(lease.heartbeat_at, 'WRONG_LEASE');
  const expires = dateMs(lease.expires_at, 'EXPIRED_LEASE');
  if (expires <= now || lease.terminal_state !== null) throw new WorkerReject('EXPIRED_LEASE');
  if (heartbeat < acquired || heartbeat > expires || heartbeat > now + 300_000 || now - heartbeat > 900_000) {
    throw new WorkerReject('STALE_LEASE');
  }
  if (spec.deadline !== null && dateMs(spec.deadline, 'MALFORMED_JOB') <= now) throw new WorkerReject('DEADLINE_EXPIRED');
  const actualWorker = currentWorkerSha();
  if (actualWorker !== envelope.worker_source_sha) throw new WorkerReject('WRONG_WORKER_SOURCE_SHA');
  const root = realpathSync(resolve(targetRoot));
  const workerRoot = realpathSync(process.cwd());
  if (pathInside(root, workerRoot) || pathInside(workerRoot, root)) throw new WorkerReject('TARGET_OVERLAPS_WORKER_SOURCE');
  const head = git(root, ['rev-parse', 'HEAD']);
  if (head !== spec.target_base_sha) throw new WorkerReject('TARGET_BASE_SHA_MISMATCH');
  const remote = normalizeRepo(git(root, ['config', '--get', 'remote.origin.url']));
  if (remote !== normalizeRepo(spec.repository_or_input)) throw new WorkerReject('TARGET_REPOSITORY_MISMATCH');
  const changed = changedPaths(root);
  if (changed.length) throw new WorkerReject('TARGET_DIRTY_AT_PREPARE');
  const snapshot = snapshotTarget(root, validateAllowedPaths(spec.allowed_paths), head, remote, changed);
  return { envelope, snapshot };
}

function assertTargetUnchanged(state: WorkerState): TargetSnapshot {
  const spec = state.envelope.worker_job_spec;
  const root = state.target_root;
  const head = git(root, ['rev-parse', 'HEAD']);
  if (head !== spec.target_base_sha) throw new WorkerReject('TARGET_BASE_SHA_MISMATCH');
  const paths = changedPaths(root);
  if (paths.length) {
    const outside = paths.filter((path) => !pathWithin(path, spec.allowed_paths));
    if (outside.length) throw new WorkerReject('CHANGED_PATH_OUTSIDE_SCOPE', outside.join(','));
    throw new WorkerReject('TARGET_CHANGED_AFTER_PREPARE', paths.join(','));
  }
  const snapshot = snapshotTarget(
    root,
    spec.allowed_paths,
    head,
    normalizeRepo(git(root, ['config', '--get', 'remote.origin.url'])),
    paths,
  );
  if (snapshot.snapshotHash !== state.initial_target_snapshot_hash) throw new WorkerReject('TARGET_CONTENT_DRIFT');
  return snapshot;
}

function findingSummary(raw: any): FindingSummary {
  const ruleId = String(raw.ruleId ?? raw.rule_id ?? 'UNKNOWN_RULE');
  return {
    rule_id: ruleId,
    severity: String(raw.severity ?? 'WARNING'),
    location: String(raw.location ?? 'unknown'),
    evidence: String(raw.evidence ?? ''),
    status: UNKNOWN_RULES.has(ruleId) ? 'UNKNOWN' : 'UNRESOLVED',
  };
}

function ext(path: string): string {
  const idx = path.lastIndexOf('.');
  return idx < 0 ? '' : path.slice(idx).toLowerCase();
}

function inspectOutcome(text: string): ('UNKNOWN' | 'AMBIGUOUS')[] {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const outcome = String(value.outcome ?? value.status ?? '').toUpperCase();
    return outcome === 'UNKNOWN' || outcome === 'AMBIGUOUS' ? [outcome] : [];
  } catch {
    return [];
  }
}

function uncertaintySignals(findings: readonly FindingSummary[], outcomes: readonly string[]): readonly string[] {
  return [...new Set([
    ...outcomes,
    ...findings.filter((finding) => finding.status === 'UNKNOWN' || finding.status === 'AMBIGUOUS').map((finding) => finding.status),
  ])];
}

function evaluateCriteria(
  spec: WorkerJobSpecRaw,
  findings: readonly FindingSummary[],
  outcomes: readonly string[],
): string[] {
  const passed: string[] = [];
  const ids = new Set(findings.map((finding) => finding.rule_id));
  const signals = uncertaintySignals(findings, outcomes);
  for (const criterion of spec.frozen_acceptance_criteria) {
    if (criterion.startsWith('finding:')) {
      const id = criterion.slice('finding:'.length);
      if (!ids.has(id)) throw new WorkerReject('ACCEPTANCE_CRITERION_FAILED', criterion);
      passed.push(criterion);
      continue;
    }
    if (criterion.startsWith('min_findings:')) {
      const count = Number(criterion.slice('min_findings:'.length));
      if (findings.length < count) throw new WorkerReject('ACCEPTANCE_CRITERION_FAILED', criterion);
      passed.push(criterion);
      continue;
    }
    if (criterion === 'result_preserves_unknown') {
      if (!signals.includes('UNKNOWN')) throw new WorkerReject('ACCEPTANCE_CRITERION_FAILED', criterion);
      passed.push(criterion);
      continue;
    }
    if (criterion === 'result_preserves_ambiguous') {
      if (!signals.includes('AMBIGUOUS')) throw new WorkerReject('ACCEPTANCE_CRITERION_FAILED', criterion);
      passed.push(criterion);
      continue;
    }
    if (criterion === 'no_authority_expansion' || criterion === 'outgoing_spend_usd:0') {
      passed.push(criterion);
    }
  }
  return passed;
}

function resultStatus(state: WorkerState, observedOutcomes: readonly string[]): WorkerDomainStatus {
  if (state.cancellation_requested) return 'CANCELLED';
  const signals = uncertaintySignals(state.findings, observedOutcomes);
  if (signals.includes('UNKNOWN')) return 'UNKNOWN';
  if (signals.includes('AMBIGUOUS')) return 'AMBIGUOUS';
  return state.findings.length ? 'COMPLETED_WITH_FINDINGS' : 'COMPLETED';
}

function makeResult(
  state: WorkerState,
  status: WorkerDomainStatus,
  limitations: string[],
  finishedAt = new Date().toISOString(),
): WorkerResult {
  const spec = state.envelope.worker_job_spec;
  const base = {
    schema: 'ZUNGUN_WORKER_RESULT_V1' as const,
    type: 'RESULT' as const,
    origin: 'ZUNGUN' as const,
    worker_id: WORKER_ID,
    execution_job_id: state.envelope.execution_job_id,
    job_id: spec.job_id,
    work_lease_id: state.envelope.work_lease.lease_id,
    scope_hash: spec.scope_hash,
    job_spec_hash: state.envelope.job_spec_hash,
    worker_source_sha: state.envelope.worker_source_sha,
    target_repository: spec.repository_or_input,
    target_base_sha: spec.target_base_sha!,
    final_target_sha: git(state.target_root, ['rev-parse', 'HEAD']),
    allowed_paths: [...spec.allowed_paths],
    changed_paths: changedPaths(state.target_root),
    execution_state: status,
    tests_checks: [...new Set(state.progress.flatMap((progress) => progress.tests_checks_run))].sort(),
    resolved_findings: [],
    unresolved_findings: state.findings.filter((finding) => finding.status === 'UNRESOLVED'),
    unknown_findings: state.findings.filter((finding) => finding.status !== 'UNRESOLVED'),
    artifact_identifiers: state.artifacts.map((artifact) => artifact.id),
    evidence_identifiers: [...new Set(state.progress.flatMap((progress) => progress.new_evidence_refs))].sort(),
    content_hashes: [...new Set(state.artifacts.map((artifact) => artifact.sha256))].sort(),
    limitations,
    outgoing_spend_usd: 0 as const,
    started_at: state.started_at,
    finished_at: finishedAt,
  };
  const result = { ...base, result_hash: canonicalHash(base) };
  validatePublishedWorkerResult(result);
  return result;
}

function terminalize(root: string, state: WorkerState, status: WorkerDomainStatus, limitations: string[]): WorkerResult {
  const result = makeResult(state, status, limitations);
  state.domain_status = status;
  state.terminal = true;
  state.known_side_effect_state = 'PROVEN_NO_TARGET_MUTATION';
  state.result = result;
  saveState(root, state);
  return result;
}

function quarantine(root: string, state: WorkerState, error: WorkerReject): WorkerResult {
  if (state.terminal && state.result) return state.result;
  const before = state.progress.length
    ? state.progress[state.progress.length - 1]!.artifact_after_hash
    : state.initial_target_snapshot_hash;
  const artifact = writeArtifact(root, state, 'FAIL_CLOSED', {
    schema: 'ZUNGUN_WORKER_FAIL_CLOSED_V1',
    reason_code: error.reasonCode,
    message: error.message,
    execution_identity_hash: state.execution_identity_hash,
  });
  const progress = makeProgress(
    state,
    before,
    artifact.sha256,
    ['immutable_scope_revalidation'],
    [artifact.id],
    'QUARANTINED',
    'fail-closed boundary prevented unsafe continuation',
    error.reasonCode,
  );
  addProgress(root, state, progress);
  return terminalize(root, state, 'QUARANTINED', [error.reasonCode]);
}

function maybeCrash(point: 'AFTER_ACK' | 'DURING_SPECIALIST' | 'AFTER_RESULT_READY'): void {
  if (process.env.NODE_ENV === 'test' && process.env.ZUNGUN_WORKER_TEST_CRASH_POINT === point) {
    process.kill(process.pid, 'SIGKILL');
  }
}

export class ZungunWorkerAdapter {
  prepare(raw: unknown, targetRoot: string, stateRootInput?: string): WorkerState {
    assertSafeAmbientEnvironment();
    assertNoAuthorityExpansion(raw);
    const parsed = validateRawEnvelope(raw);
    const root = stateRoot(stateRootInput, targetRoot);
    mkdirSync(root, { recursive: true });
    const existingPath = statePath(root, parsed.execution_job_id);
    if (existsSync(existingPath)) {
      const existing = loadState(root, parsed.execution_job_id);
      if (canonicalHash(parsed) !== canonicalHash(existing.envelope)) {
        throw new WorkerReject('CONFLICTING_DUPLICATE_EXECUTION_IDENTITY');
      }
      if (currentWorkerSha() !== parsed.worker_source_sha) throw new WorkerReject('WRONG_WORKER_SOURCE_SHA');
      assertIdentity(existing, parsed, targetRoot);
      return existing;
    }
    const { envelope, snapshot } = validateEnvelope(raw, targetRoot);
    const identity = executionIdentityHash(envelope);
    const realTarget = realpathSync(resolve(targetRoot));
    const at = new Date().toISOString();
    const ack = makeAck(envelope, identity, at);
    const state: WorkerState = {
      schema: STATE_SCHEMA,
      envelope,
      execution_identity_hash: identity,
      target_root: realTarget,
      started_at: at,
      acknowledged_at: at,
      ack,
      checkpoint_seq: 0,
      completed_phases: [],
      artifacts: [],
      progress: [],
      findings: [],
      target_instruction_conflicts: [],
      known_side_effect_state: 'NONE',
      domain_status: 'PENDING',
      cancellation_requested: false,
      terminal: false,
      result: null,
      initial_target_snapshot_hash: snapshot.snapshotHash,
    };
    saveState(root, state);
    return state;
  }

  async executeOne(
    raw: unknown,
    targetRoot: string,
    stateRootInput?: string,
  ): Promise<{ state: WorkerState; progress?: ProgressReceipt; result?: WorkerResult }> {
    const prepared = this.prepare(raw, targetRoot, stateRootInput);
    const root = stateRoot(stateRootInput, targetRoot);
    let state = loadState(root, prepared.envelope.execution_job_id);
    assertIdentity(state, prepared.envelope, targetRoot);
    if (state.terminal) {
      if (state.result) return { state, result: state.result };
      return { state };
    }
    if (state.cancellation_requested) return { state, result: terminalize(root, state, 'CANCELLED', ['COOPERATIVE_CANCELLATION']) };
    if (Date.now() - Date.parse(state.started_at) > state.envelope.execution_budget_ms) {
      return { state, result: terminalize(root, state, 'CANCELLED', ['EXECUTION_BUDGET_EXHAUSTED']) };
    }
    if (Date.parse(state.envelope.work_lease.expires_at) <= Date.now()) {
      return { state, result: terminalize(root, state, 'CANCELLED', ['LEASE_EXPIRED_DURING_EXECUTION']) };
    }
    if (state.envelope.worker_job_spec.deadline && Date.parse(state.envelope.worker_job_spec.deadline) <= Date.now()) {
      return { state, result: terminalize(root, state, 'CANCELLED', ['DEADLINE_EXPIRED_DURING_EXECUTION']) };
    }

    try {
      assertTargetUnchanged(state);
      state.domain_status = 'RUNNING';
      const next = state.completed_phases.length;

      if (next === 0) {
        const snapshot = assertTargetUnchanged(state);
        const conflicts = detectTargetConflicts(state.target_root, snapshot.files);
        state.target_instruction_conflicts = [...conflicts];
        const artifact = writeArtifact(root, state, 'TARGET_BOUNDARY', {
          schema: 'ZUNGUN_TARGET_BOUNDARY_V1',
          execution_job_id: state.envelope.execution_job_id,
          target_base_sha: snapshot.head,
          target_repository: snapshot.remote,
          allowed_paths: state.envelope.worker_job_spec.allowed_paths,
          file_count: snapshot.files.length,
          snapshot_hash: snapshot.snapshotHash,
          target_instruction_conflicts: conflicts,
          scope_preserved: true,
          git_hooks_policy: 'DISABLED_FOR_ADAPTER_GIT_COMMANDS',
          network_policy: 'LOCAL_ONLY_READ_ONLY_V1',
          state_outside_target: true,
        });
        state.completed_phases.push('TARGET_BOUNDARY_AUDIT');
        const progress = makeProgress(
          state,
          state.initial_target_snapshot_hash,
          artifact.sha256,
          ['target_base_sha', 'target_repository', 'allowed_paths', 'symlink_escape', 'target_instruction_conflict'],
          [artifact.id, ...conflicts.map((value) => `conflict:${canonicalHash(value)}`)],
          'TARGET_BOUNDARY_AUDITED',
          conflicts.length
            ? 'malicious/contradictory target instructions detected and immutable ATM scope preserved'
            : 'immutable target boundary independently revalidated',
        );
        addProgress(root, state, progress);
        return { state: loadState(root, state.envelope.execution_job_id), progress };
      }

      if (next === 1) {
        const snapshot = assertTargetUnchanged(state);
        const findings: FindingSummary[] = [];
        const outcomes: ('UNKNOWN' | 'AMBIGUOUS')[] = [];
        let blackout: Record<string, unknown> | null = null;
        for (const file of snapshot.files) {
          const text = String(readFileSync(resolve(state.target_root, file.path), 'utf8'));
          outcomes.push(...inspectOutcome(text));
          if (!TEXT_EXTENSIONS.has(ext(file.path))) continue;
          for (const rawFinding of analyzeSource(file.path, text)) findings.push(findingSummary(rawFinding));
          if (/openapi\s*:\s*["']?3\./i.test(text) || file.path.toLowerCase().includes('openapi')) {
            try {
              for (const rawFinding of analyzeOpenApi(text, file.path).findings) findings.push(findingSummary(rawFinding));
            } catch {
              // Malformed target specs are untrusted input. Static source analysis remains valid.
            }
          }
        }
        const profiles = state.envelope.worker_job_spec.required_capabilities.filter((value) => value.startsWith('zungun.')).sort();
        if (
          profiles.some((value) => [
            'zungun.blackout_testing',
            'zungun.network_resilience',
            'zungun.reconciliation',
            'zungun.resumable_transfer',
            'zungun.offline_sync',
            'zungun.idempotency_retry',
            'zungun.ambiguous_timeout',
          ].includes(value))
        ) {
          const drill = await runLinkBlackoutDrill();
          blackout = {
            operation_id: drill.operationId,
            business_effect_count: drill.businessEffectCount,
            second_side_effect_send_count: drill.secondSideEffectSendCount,
            transport_attempt_count: drill.transportAttemptCount,
            reconciliation_query_count: drill.reconciliationQueryCount,
            deferred_transport_attempt_count: drill.deferredTransportAttemptCount,
            deferred_runtime_reopen_count: drill.deferredRuntimeReopenCount,
            deferred_checkpoint_offset: drill.deferredCheckpointOffset,
            deferred_persistent_state: drill.deferredPersistentState,
            final_core_complete: drill.finalCoreComplete,
            final_evidence_complete: drill.finalEvidenceComplete,
            proof_manifest_sha256: drill.proofManifestSha256,
            proof_bundle_sha256: canonicalHash(drill.proofBundle),
          };
        }
        maybeCrash('DURING_SPECIALIST');
        const unique = [...new Map(findings.map((finding) => [canonicalHash(finding), finding])).values()].sort((a, b) =>
          `${a.location}:${a.rule_id}`.localeCompare(`${b.location}:${b.rule_id}`),
        );
        state.findings = unique;
        const artifactValue: AnalysisArtifact = {
          schema: 'ZUNGUN_SPECIALIST_ANALYSIS_V1',
          execution_job_id: state.envelope.execution_job_id,
          profiles,
          findings: unique,
          target_instruction_conflicts: state.target_instruction_conflicts,
          observed_outcomes: [...new Set(outcomes)].sort() as ('UNKNOWN' | 'AMBIGUOUS')[],
          blackout,
          limitations: [
            'Static Link Doctor findings require domain review before target mutation.',
            'Worker adapter is read-only in v1; it does not claim external business effect beyond Zungun proof surfaces.',
          ],
        };
        const artifact = writeArtifact(root, state, 'SPECIALIST_ANALYSIS', artifactValue);
        state.completed_phases.push('SPECIALIST_ANALYSIS');
        const before = state.progress[state.progress.length - 1]!.artifact_after_hash;
        const evidence = [artifact.id, ...unique.map((finding) => `finding:${finding.rule_id}:${canonicalHash(finding).slice(0, 16)}`)];
        if (blackout) evidence.push(`blackout-proof:${String(blackout.proof_manifest_sha256)}`);
        const signals = uncertaintySignals(unique, outcomes);
        const progress = makeProgress(
          state,
          before,
          artifact.sha256,
          ['link_doctor', ...(blackout ? ['link_blackout_drill', 'reconcile_before_retry', 'resumable_transfer_reopen'] : [])],
          evidence,
          'SPECIALIST_ANALYSIS_COMPLETE',
          `specialist evidence produced: findings=${unique.length}, uncertainty=${signals.join(',') || 'NONE'}, blackout=${blackout ? 'PROVEN' : 'NOT_REQUESTED'}`,
        );
        addProgress(root, state, progress);
        return { state: loadState(root, state.envelope.execution_job_id), progress };
      }

      if (next === 2) {
        const snapshot = assertTargetUnchanged(state);
        const analysisArtifact = state.artifacts.find((artifact) => artifact.kind === 'SPECIALIST_ANALYSIS');
        if (!analysisArtifact) throw new WorkerReject('MISSING_ANALYSIS_ARTIFACT');
        const analysis = JSON.parse(
          String(readFileSync(join(executionDir(root, state.envelope.execution_job_id), analysisArtifact.relative_path), 'utf8')),
        ) as AnalysisArtifact;
        const criteria = evaluateCriteria(state.envelope.worker_job_spec, state.findings, analysis.observed_outcomes);
        const checkResults: Record<string, string> = {};
        for (const check of state.envelope.worker_job_spec.deterministic_checks) {
          if (check === 'link_doctor') checkResults[check] = 'PASS';
          else if (check === 'target_clean') checkResults[check] = changedPaths(state.target_root).length === 0 ? 'PASS' : 'FAIL';
          else if (check === 'scope_unchanged') checkResults[check] = snapshot.snapshotHash === state.initial_target_snapshot_hash ? 'PASS' : 'FAIL';
          else if (check === 'hash_artifacts') checkResults[check] = state.artifacts.every((artifact) => /^[0-9a-f]{64}$/.test(artifact.sha256)) ? 'PASS' : 'FAIL';
          else if (check === 'blackout_core') {
            checkResults[check] = analysis.blackout?.final_evidence_complete === true && analysis.blackout?.second_side_effect_send_count === 0 ? 'PASS' : 'FAIL';
          } else if (check === 'no_authority_expansion') checkResults[check] = 'PASS';
        }
        const failed = Object.entries(checkResults).filter(([, value]) => value !== 'PASS').map(([key]) => key);
        if (failed.length) throw new WorkerReject('DETERMINISTIC_CHECK_FAILED', failed.join(','));
        const status = resultStatus(state, analysis.observed_outcomes);
        const artifact = writeArtifact(root, state, 'VERIFICATION', {
          schema: 'ZUNGUN_WORKER_VERIFICATION_V1',
          execution_job_id: state.envelope.execution_job_id,
          criteria_passed: criteria,
          deterministic_checks: checkResults,
          target_snapshot_hash: snapshot.snapshotHash,
          target_changed_paths: [],
          result_domain_status: status,
          unknown_ambiguous_preserved: status === 'UNKNOWN' || status === 'AMBIGUOUS' || uncertaintySignals(state.findings, analysis.observed_outcomes).length === 0,
          authority_scope_preserved: true,
          outgoing_spend_usd: 0,
        });
        state.completed_phases.push('DETERMINISTIC_VERIFICATION');
        const before = state.progress[state.progress.length - 1]!.artifact_after_hash;
        const progress = makeProgress(
          state,
          before,
          artifact.sha256,
          ['acceptance_criteria', ...Object.keys(checkResults).sort()],
          [artifact.id],
          'RESULT_READY',
          `acceptance delta: ${criteria.length} criteria and ${Object.keys(checkResults).length} deterministic checks passed; terminal domain status=${status}`,
        );
        addProgress(root, state, progress);
        const limitations = ['READ_ONLY_SPECIALIST_ADAPTER_V1', 'NETWORK_POLICY_LOCAL_ONLY'];
        if (state.target_instruction_conflicts.length) limitations.push('TARGET_INSTRUCTION_CONFLICTS_PRESERVED_WITHOUT_SCOPE_EXPANSION');
        const result = terminalize(root, state, status, limitations);
        maybeCrash('AFTER_RESULT_READY');
        return { state: loadState(root, state.envelope.execution_job_id), progress, result };
      }

      return { state, result: terminalize(root, state, state.domain_status, ['UNEXPECTED_PHASE_STATE']) };
    } catch (error) {
      if (error instanceof WorkerReject) {
        state = loadState(root, prepared.envelope.execution_job_id);
        const result = quarantine(root, state, error);
        return { state: loadState(root, prepared.envelope.execution_job_id), result };
      }
      throw error;
    }
  }

  async run(
    raw: unknown,
    targetRoot: string,
    stateRootInput?: string,
    onEvent?: (event: unknown) => void,
  ): Promise<WorkerState> {
    const prepared = this.prepare(raw, targetRoot, stateRootInput);
    onEvent?.(prepared.ack);
    maybeCrash('AFTER_ACK');
    if (prepared.terminal) {
      if (prepared.result) {
        validatePublishedWorkerResult(prepared.result);
        onEvent?.(prepared.result);
      }
      return prepared;
    }
    for (let guard = 0; guard < 8; guard += 1) {
      const step = await this.executeOne(raw, targetRoot, stateRootInput);
      if (step.progress) onEvent?.(step.progress);
      if (step.result) {
        validatePublishedWorkerResult(step.result);
        onEvent?.(step.result);
        return loadState(stateRoot(stateRootInput, targetRoot), prepared.envelope.execution_job_id);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    throw new WorkerReject('EXECUTION_PHASE_BOUND_EXCEEDED');
  }

  status(executionJobId: string, stateRootInput?: string): Record<string, unknown> {
    const id = canonicalExecutionId(executionJobId);
    const state = loadState(stateRoot(stateRootInput), id);
    return {
      schema: 'ZUNGUN_WORKER_STATUS_V1',
      type: 'STATUS',
      origin: 'ZUNGUN',
      worker_id: WORKER_ID,
      execution_job_id: id,
      execution_identity_hash: state.execution_identity_hash,
      checkpoint_seq: state.checkpoint_seq,
      completed_phases: state.completed_phases,
      domain_status: state.domain_status,
      cancellation_requested: state.cancellation_requested,
      terminal: state.terminal,
      result_hash: state.result?.result_hash ?? null,
    };
  }

  collect(executionJobId: string, stateRootInput?: string): WorkerResult {
    const id = canonicalExecutionId(executionJobId);
    const state = loadState(stateRoot(stateRootInput), id);
    if (!state.result) throw new WorkerReject('RESULT_NOT_READY');
    validatePublishedWorkerResult(state.result);
    return state.result;
  }

  cancel(executionJobId: string, stateRootInput?: string): WorkerResult {
    const id = canonicalExecutionId(executionJobId);
    const root = stateRoot(stateRootInput);
    const state = loadState(root, id);
    if (state.terminal && state.result) return state.result;
    state.cancellation_requested = true;
    saveState(root, state);
    return terminalize(root, state, 'CANCELLED', ['COOPERATIVE_CANCELLATION']);
  }
}

export function parseEnvelopeFile(path: string): unknown {
  try {
    const resolved = resolve(path);
    const info = statSync(resolved);
    if (!info.isFile()) throw new WorkerReject('MALFORMED_JOB');
    if (Number(info.size) > MAX_JOB_INPUT_BYTES) throw new WorkerReject('JOB_INPUT_TOO_LARGE');
    return JSON.parse(String(readFileSync(resolved, 'utf8')));
  } catch (error) {
    if (error instanceof WorkerReject) throw error;
    throw new WorkerReject('MALFORMED_JOB', error instanceof Error ? error.message : 'MALFORMED_JOB');
  }
}

export function resolveStateRoot(input?: string): string {
  return stateRoot(input);
}
