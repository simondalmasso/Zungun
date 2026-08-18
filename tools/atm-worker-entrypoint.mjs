#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ENTRYPOINT = 'tools/atm-worker-entrypoint.mjs';
const WORKER_ID = 'zungun';

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
function git(args, cwd) {
  const run = spawnSync('git', args, { cwd, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (run.status !== 0) fail(String(run.stderr || run.stdout || 'git_failed'), 29);
  return String(run.stdout || '').trim();
}

try {
  const specPath = required('ATM_JOB_SPEC_PATH');
  const resultPath = required('ATM_TASK_RESULT_PATH');
  const executionJobId = required('ATM_EXECUTION_JOB_ID');
  const workLeaseId = required('ATM_WORK_LEASE_ID');
  const scopeHash = required('ATM_SCOPE_HASH');
  const jobSpecHash = required('ATM_JOB_SPEC_HASH');
  const sourceSha = required('ATM_WORKER_SOURCE_SHA');
  if (process.env.ATM_MAX_SPEND_USD !== '0') fail('nonzero_spend_boundary', 20);
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) fail('invalid_worker_source_sha', 21);

  const rawSpec = readFileSync(specPath, 'utf8');
  if (sha256Text(rawSpec) !== jobSpecHash) fail('atm_job_spec_hash_mismatch', 22);
  const spec = JSON.parse(rawSpec);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('atm_job_spec_not_object', 23);
  if (spec.scope_hash !== scopeHash) fail('atm_scope_hash_mismatch', 24);
  if (String(spec.max_spend_usd) !== '0') fail('atm_nonzero_spend', 25);
  if (!String(spec.task_type || '').startsWith('zungun_')) fail('unsupported_atm_task_type', 26);
  if (spec.target_base_sha !== sourceSha) fail('target_base_must_equal_pinned_worker_source_for_integration_fixture', 27);
  if (spec.repository_or_input !== 'https://github.com/simonkey888/Zungun') fail('integration_fixture_target_mismatch', 28);

  const now = Date.now();
  const lease = {
    lease_id: workLeaseId,
    canonical_opportunity_id: String(spec.canonical_opportunity_id),
    worker_id: WORKER_ID,
    scope_hash: scopeHash,
    acquired_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 15 * 60 * 1000).toISOString(),
    heartbeat_at: new Date(now).toISOString(),
    terminal_state: null,
  };
  const envelope = {
    schema: 'ZUNGUN_ATM_WORKER_JOB_V1',
    execution_job_id: executionJobId,
    job_spec_hash: jobSpecHash,
    worker_id: WORKER_ID,
    worker_source_sha: sourceSha,
    execution_budget_ms: 600000,
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

  git(['clone', '--no-checkout', '--filter=blob:none', String(spec.repository_or_input), targetRoot], ioRoot);
  git(['fetch', '--depth=1', 'origin', sourceSha], targetRoot);
  git(['checkout', '--detach', sourceSha], targetRoot);
  if (git(['rev-parse', 'HEAD'], targetRoot) !== sourceSha) fail('zungun_target_source_mismatch', 29);

  const cliPath = join(process.cwd(), 'dist', 'tools', 'worker-adapter', 'src', 'cli.js');
  if (!existsSync(cliPath)) fail('native_zungun_cli_missing_after_prepare', 30);
  const run = spawnSync(
    process.execPath,
    [cliPath, 'run', '--job', nativeJobPath, '--target-root', targetRoot, '--state-root', stateRoot],
    { cwd: process.cwd(), env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (run.status !== 0) {
    process.stderr.write(String(run.stderr || run.stdout || 'zungun_native_worker_failed') + '\n');
    process.exit(run.status || 31);
  }
  const rows = String(run.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const nativeResult = [...rows].reverse().find((row) => row && row.schema === 'ZUNGUN_WORKER_RESULT_V1');
  if (!nativeResult) fail('zungun_native_result_missing', 32);
  if (nativeResult.worker_id !== WORKER_ID || nativeResult.worker_source_sha !== sourceSha) fail('zungun_native_source_binding_mismatch', 33);
  if (nativeResult.execution_job_id !== executionJobId || nativeResult.work_lease_id !== workLeaseId) fail('zungun_native_execution_binding_mismatch', 34);
  if (nativeResult.scope_hash !== scopeHash || nativeResult.job_spec_hash !== jobSpecHash) fail('zungun_native_scope_binding_mismatch', 35);
  if (nativeResult.target_base_sha !== sourceSha || nativeResult.final_target_sha !== sourceSha) fail('zungun_native_target_binding_mismatch', 36);
  if (!Array.isArray(nativeResult.changed_paths) || nativeResult.changed_paths.length !== 0) fail('zungun_native_target_mutated', 37);
  if (nativeResult.outgoing_spend_usd !== 0) fail('zungun_native_nonzero_spend', 38);

  const inputBytes = Buffer.from(String(spec.repository_or_input), 'utf8');
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
  fail(error instanceof Error ? error.message : String(error), 40);
}
