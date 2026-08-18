#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ENTRYPOINT = 'tools/atm-worker-entrypoint.mjs';
const WORKER_ID = 'zungun';
let leaseExpiresMs = 0;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`missing_${name}`);
  return value;
}
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}
function canonicalJson(value) { return JSON.stringify(normalize(value)); }
function sha256Text(value) { return createHash('sha256').update(value).digest('hex'); }
function sha256Json(value) { return sha256Text(canonicalJson(value)); }
function fail(message, code = 30) { process.stderr.write(String(message) + '\n'); process.exit(code); }
function remainingMs(capMs) {
  const remaining = leaseExpiresMs - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) fail('atm_work_lease_expired', 18);
  return Math.max(1, Math.min(Number(capMs), Math.floor(remaining)));
}
function boundedSpawn(command, args, options, capMs) {
  const run = spawnSync(command, args, { ...options, timeout: remainingMs(capMs) });
  if (run.error?.code === 'ETIMEDOUT') fail('atm_work_lease_expired_or_subprocess_timeout', 18);
  if (Date.now() >= leaseExpiresMs) fail('atm_work_lease_expired_after_subprocess', 18);
  return run;
}
function git(args, cwd) {
  const run = boundedSpawn('git', args, { cwd, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, 180000);
  if (run.status !== 0) fail(String(run.stderr || run.stdout || 'git_failed'), 29);
  return String(run.stdout || '').trim();
}
function normalizeRepo(value) {
  let text = String(value || '').trim();
  if (text.endsWith('.git')) text = text.slice(0, -4);
  return text.replace(/\/$/, '');
}

try {
  const specPath = required('ATM_JOB_SPEC_PATH');
  const resultPath = required('ATM_TASK_RESULT_PATH');
  const executionJobId = required('ATM_EXECUTION_JOB_ID');
  const workLeaseId = required('ATM_WORK_LEASE_ID');
  const leaseExpiresAt = required('ATM_WORK_LEASE_EXPIRES_AT');
  const scopeHash = required('ATM_SCOPE_HASH');
  const jobSpecHash = required('ATM_JOB_SPEC_HASH');
  const sourceSha = required('ATM_WORKER_SOURCE_SHA');
  leaseExpiresMs = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(leaseExpiresMs) || leaseExpiresMs <= Date.now()) fail('invalid_or_expired_atm_work_lease', 18);
  if (process.env.ATM_MAX_SPEND_USD !== '0') fail('nonzero_spend_boundary', 20);
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) fail('invalid_worker_source_sha', 21);

  const rawSpec = readFileSync(specPath, 'utf8');
  if (sha256Text(rawSpec) !== jobSpecHash) fail('atm_job_spec_hash_mismatch', 22);
  const spec = JSON.parse(rawSpec);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('atm_job_spec_not_object', 23);
  if (spec.scope_hash !== scopeHash) fail('atm_scope_hash_mismatch', 24);
  if (String(spec.max_spend_usd) !== '0') fail('atm_nonzero_spend', 25);
  if (!String(spec.task_type || '').startsWith('zungun_')) fail('unsupported_atm_task_type', 26);
  const targetRepository = String(spec.repository_or_input || '').trim();
  const targetBaseSha = String(spec.target_base_sha || '').trim();
  if (!targetRepository.startsWith('https://github.com/')) fail('target_repository_must_be_public_github_https', 27);
  if (!/^[0-9a-f]{40}$/.test(targetBaseSha)) fail('target_base_sha_required_exact', 28);
  if (!Array.isArray(spec.allowed_paths) || spec.allowed_paths.length === 0) fail('allowed_paths_required', 29);

  const now = Date.now();
  const lease = {
    lease_id: workLeaseId,
    canonical_opportunity_id: String(spec.canonical_opportunity_id),
    worker_id: WORKER_ID,
    scope_hash: scopeHash,
    acquired_at: new Date(now - 1000).toISOString(),
    expires_at: leaseExpiresAt,
    heartbeat_at: new Date(now).toISOString(),
    terminal_state: null,
  };
  const envelope = {
    schema: 'ZUNGUN_ATM_WORKER_JOB_V1',
    execution_job_id: executionJobId,
    job_spec_hash: jobSpecHash,
    worker_id: WORKER_ID,
    worker_source_sha: sourceSha,
    execution_budget_ms: remainingMs(600000),
    worker_job_spec: spec,
    work_lease: lease,
  };

  const ioRoot = dirname(resultPath);
  const nativeRoot = join(ioRoot, 'zungun-native');
  const stateRoot = join(ioRoot, 'zungun-native-state');
  const targetRoot = join(ioRoot, 'zungun-native-target');
  mkdirSync(nativeRoot, { recursive: true });
  mkdirSync(stateRoot, { recursive: true });
  const nativeJobPath = join(nativeRoot, 'job.json');
  writeFileSync(nativeJobPath, canonicalJson(envelope) + '\n', { encoding: 'utf8', flag: 'wx' });

  git(['clone', '--no-checkout', '--filter=blob:none', targetRepository, targetRoot], ioRoot);
  git(['fetch', '--depth=1', 'origin', targetBaseSha], targetRoot);
  git(['checkout', '--detach', targetBaseSha], targetRoot);
  const checkedOutHead = git(['rev-parse', 'HEAD'], targetRoot);
  if (checkedOutHead !== targetBaseSha) fail('zungun_target_base_mismatch', 30);
  const checkedOutRemote = normalizeRepo(git(['config', '--get', 'remote.origin.url'], targetRoot));
  if (checkedOutRemote !== normalizeRepo(targetRepository)) fail('zungun_target_repository_mismatch', 31);

  const cliPath = join(process.cwd(), 'dist', 'tools', 'worker-adapter', 'src', 'cli.js');
  if (!existsSync(cliPath)) fail('native_zungun_cli_missing_after_prepare', 32);
  const run = boundedSpawn(
    process.execPath,
    [cliPath, 'run', '--job', nativeJobPath, '--target-root', targetRoot, '--state-root', stateRoot],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    envelope.execution_budget_ms,
  );
  if (run.status !== 0) {
    process.stderr.write(String(run.stderr || run.stdout || 'zungun_native_worker_failed') + '\n');
    process.exit(run.status || 33);
  }
  const rows = String(run.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const nativeResult = [...rows].reverse().find((row) => row && row.schema === 'ZUNGUN_WORKER_RESULT_V1');
  if (!nativeResult) fail('zungun_native_result_missing', 34);
  if (nativeResult.worker_id !== WORKER_ID || nativeResult.worker_source_sha !== sourceSha) fail('zungun_native_source_binding_mismatch', 35);
  if (nativeResult.execution_job_id !== executionJobId || nativeResult.work_lease_id !== workLeaseId) fail('zungun_native_execution_binding_mismatch', 36);
  if (nativeResult.scope_hash !== scopeHash || nativeResult.job_spec_hash !== jobSpecHash) fail('zungun_native_scope_binding_mismatch', 37);
  if (normalizeRepo(nativeResult.target_repository) !== normalizeRepo(targetRepository)) fail('zungun_native_target_repository_mismatch', 38);
  if (nativeResult.target_base_sha !== targetBaseSha || nativeResult.final_target_sha !== targetBaseSha) fail('zungun_native_target_binding_mismatch', 39);
  if (canonicalJson(nativeResult.allowed_paths) !== canonicalJson(spec.allowed_paths)) fail('zungun_native_allowed_paths_mismatch', 40);
  if (!Array.isArray(nativeResult.changed_paths) || nativeResult.changed_paths.length !== 0) fail('zungun_native_target_mutated', 41);
  if (nativeResult.outgoing_spend_usd !== 0) fail('zungun_native_nonzero_spend', 42);
  if (Date.now() >= leaseExpiresMs) fail('atm_work_lease_expired_before_result', 18);

  const targetIdentity = `${normalizeRepo(targetRepository)}@${targetBaseSha}`;
  const inputBytes = Buffer.from(targetIdentity, 'utf8');
  const taskResult = {
    schema: 'ATM_TASK_RESULT_V1',
    execution_job_id: executionJobId,
    work_lease_id: workLeaseId,
    scope_hash: scopeHash,
    job_spec_hash: jobSpecHash,
    task_type: String(spec.task_type),
    producer: {
      worker_id: WORKER_ID,
      worker_source_sha: sourceSha,
      worker_entrypoint: ENTRYPOINT,
      native_entrypoint: 'dist/tools/worker-adapter/src/cli.js',
      native_protocol: 'ZUNGUN_ATM_WORKER_JOB_V1',
    },
    bridge_target: {
      repository: normalizeRepo(targetRepository),
      target_base_sha: targetBaseSha,
      checked_out_head: checkedOutHead,
      allowed_paths: [...spec.allowed_paths],
    },
    native_contract_hash: sha256Json(envelope),
    native_worker_result_hash: sha256Json(nativeResult),
    native_worker_result: nativeResult,
    task_output: {
      kind: 'SHA256_UTF8_INPUT_V1',
      sha256: sha256Text(inputBytes),
      byte_length: inputBytes.length,
    },
    outgoing_spend_usd: 0,
  };
  writeFileSync(resultPath, canonicalJson(taskResult) + '\n', { encoding: 'utf8', flag: 'wx' });
  process.exit(0);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 50);
}
