import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { canonicalHash } from '../tools/worker-adapter/src/protocol.js';

type Json = Record<string, any>;
const ROOT = process.cwd();
const CLI = resolve(ROOT, 'dist/tools/worker-adapter/src/cli.js');

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}
function currentWorkerSha(): string {
  return git(ROOT, ['rev-parse', 'HEAD']);
}
function makeShadow(source: string, remote: string): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), 'zungun-worker-shadow-'));
  cpSync(resolve(ROOT, source), root, { recursive: true });
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'shadow@example.invalid']);
  git(root, ['config', 'user.name', 'Zungun Shadow']);
  git(root, ['remote', 'add', 'origin', remote + '.git']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'bounded shadow source']);
  return { root, sha: git(root, ['rev-parse', 'HEAD']) };
}
function bind(value: Json): Json {
  const spec = value.worker_job_spec;
  const scopePayload = { ...spec };
  delete scopePayload.scope_hash;
  spec.scope_hash = canonicalHash(scopePayload);
  value.work_lease.scope_hash = spec.scope_hash;
  value.job_spec_hash = canonicalHash(spec);
  value.execution_job_id = 'exec_' + canonicalHash({
    opportunity_id: spec.canonical_opportunity_id,
    worker_id: 'zungun',
    work_lease_id: value.work_lease.lease_id,
    scope_hash: spec.scope_hash,
    job_spec_hash: value.job_spec_hash,
  }).slice(0, 40);
  return value;
}
function envelope(
  targetSha: string,
  remote: string,
  issueUrl: string,
  capabilities: string[],
  allowedPaths: string[],
  criteria: string[],
  checks: string[],
): Json {
  return bind({
    schema: 'ZUNGUN_ATM_WORKER_JOB_V1',
    execution_job_id: '',
    job_spec_hash: '',
    worker_id: 'zungun',
    worker_source_sha: currentWorkerSha(),
    execution_budget_ms: 120000,
    worker_job_spec: {
      job_id: 'shadow-' + canonicalHash(issueUrl).slice(0, 16),
      canonical_opportunity_id: 'shadow_' + canonicalHash(issueUrl).slice(0, 20),
      external_source: 'public-github-shadow',
      external_url: issueUrl,
      task_type: 'NETWORK_RELIABILITY_AUDIT',
      frozen_acceptance_criteria: criteria,
      repository_or_input: remote,
      deadline: iso(3600000),
      scope_hash: '',
      max_spend_usd: '0',
      required_capabilities: capabilities,
      structured_requirements: ['read-only shadow qualification; never submit or mutate third-party remote'],
      target_base_sha: targetSha,
      allowed_paths: allowedPaths,
      expected_deliverable: 'machine-readable shadow reliability evidence',
      deterministic_checks: checks,
    },
    work_lease: {
      lease_id: 'lease_shadow_' + canonicalHash(issueUrl).slice(0, 20),
      canonical_opportunity_id: 'shadow_' + canonicalHash(issueUrl).slice(0, 20),
      worker_id: 'zungun',
      scope_hash: '',
      acquired_at: iso(-1000),
      expires_at: iso(3600000),
      heartbeat_at: iso(-500),
      terminal_state: null,
    },
  });
}
function writeJob(stateRoot: string, value: Json): string {
  mkdirSync(stateRoot, { recursive: true });
  const path = join(stateRoot, 'job.json');
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  return path;
}
function safeEnv(value: Json): Record<string, string | undefined> {
  const env = { ...process.env };
  for (const key of [
    'GITHUB_TOKEN', 'GH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET', 'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY', 'STRIPE_SECRET_KEY', 'WALLET_PRIVATE_KEY', 'PRIVATE_KEY', 'MNEMONIC', 'SEED_PHRASE',
  ]) delete env[key];
  return {
    ...env,
    ATM_EXECUTION_JOB_ID: value.execution_job_id,
    ATM_WORK_LEASE_ID: value.work_lease.lease_id,
    ATM_SCOPE_HASH: value.worker_job_spec.scope_hash,
    ATM_JOB_SPEC_HASH: value.job_spec_hash,
    ATM_MAX_SPEND_USD: '0',
  };
}
function invoke(command: string, value: Json, target: string, stateRoot: string): { status: number; events: Json[]; stderr: string } {
  const job = writeJob(stateRoot, value);
  const run = spawnSync(process.execPath, [CLI, command, '--job', job, '--target-root', target, '--state-root', stateRoot], {
    cwd: ROOT,
    encoding: 'utf8',
    env: safeEnv(value),
  });
  return {
    status: run.status ?? -1,
    events: String(run.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
    stderr: String(run.stderr || ''),
  };
}
function cleanup(...paths: string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

test('public Hermes #13566 is CAN_HANDLE and executes end-to-end as bounded local shadow', () => {
  const remote = 'https://github.com/NousResearch/hermes-agent';
  const issue = 'https://github.com/NousResearch/hermes-agent/issues/13566';
  const target = makeShadow('testdata/worker-shadow-hermes-13566', remote);
  const state = mkdtempSync(join(tmpdir(), 'zungun-shadow-hermes-state-'));
  try {
    const job = envelope(
      target.sha,
      remote,
      issue,
      ['zungun.reliability_audit', 'zungun.network_resilience', 'zungun.idempotency_retry', 'zungun.reconciliation'],
      ['cron/scheduler.py'],
      [
        'finding:ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE',
        'finding:ZL015_NO_RECEIVER_RECONCILIATION_PATH',
        'result_preserves_unknown',
        'outgoing_spend_usd:0',
      ],
      ['link_doctor', 'target_clean', 'scope_unchanged', 'hash_artifacts', 'blackout_core'],
    );
    const run = invoke('run', job, target.root, state);
    assert.equal(run.status, 0, run.stderr + JSON.stringify(run.events));
    assert.equal(run.events[0]?.type, 'ACK');
    assert.ok(run.events.filter((event) => event.type === 'PROGRESS').length >= 2);
    const result = run.events.at(-1)!;
    assert.equal(result.type, 'RESULT');
    assert.equal(result.execution_state, 'UNKNOWN');
    assert.deepEqual(result.changed_paths, []);
    assert.ok(result.unknown_findings.some((finding: Json) => finding.rule_id === 'ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE'));
    assert.ok(result.unknown_findings.some((finding: Json) => finding.rule_id === 'ZL015_NO_RECEIVER_RECONCILIATION_PATH'));
    assert.ok(result.content_hashes.length >= 3);
    console.log('SHADOW_CAN_HANDLE_SOURCE=' + issue);
    console.log('SHADOW_CAN_HANDLE_RESULT_HASH=' + result.result_hash);
    console.log('SHADOW_CAN_HANDLE_ARTIFACT_HASHES=' + result.content_hashes.join(','));
  } finally {
    cleanup(target.root, state);
  }
});

test('public OpenCode #33376 is honest CANNOT_HANDLE for model context-window management', () => {
  const remote = 'https://github.com/anomalyco/opencode';
  const issue = 'https://github.com/anomalyco/opencode/issues/33376';
  const target = makeShadow('testdata/worker-shadow-opencode-33376', remote);
  const state = mkdtempSync(join(tmpdir(), 'zungun-shadow-opencode-state-'));
  try {
    const job = envelope(
      target.sha,
      remote,
      issue,
      ['model.context_window_management'],
      ['packages/opencode/src/session/message-v2.ts'],
      ['outgoing_spend_usd:0'],
      ['target_clean'],
    );
    const run = invoke('prepare', job, target.root, state);
    assert.equal(run.status, 2);
    assert.equal(run.events.at(-1)?.status, 'REJECTED');
    assert.equal(run.events.at(-1)?.reason_code, 'UNSUPPORTED_CAPABILITY');
    console.log('SHADOW_CANNOT_HANDLE_SOURCE=' + issue);
    console.log('SHADOW_CANNOT_HANDLE_REASON=UNSUPPORTED_CAPABILITY');
  } finally {
    cleanup(target.root, state);
  }
});
