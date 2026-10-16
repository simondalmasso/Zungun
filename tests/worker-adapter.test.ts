import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { canonicalHash } from '../tools/worker-adapter/src/protocol.js';
import { validatePublishedWorkerResult } from '../tools/worker-adapter/src/worker.js';

type Json = Record<string, any>;
const ROOT = process.cwd();
const CLI = resolve(ROOT, 'dist/tools/worker-adapter/src/cli.js');
const FIXTURE = resolve(ROOT, 'testdata/worker-fixture-reliability-001');
const TARGET_URL = 'https://github.com/example/zungun-worker-reliability-fixture';

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function currentWorkerSha(): string {
  return git(ROOT, ['rev-parse', 'HEAD']);
}
function makeTarget(extra?: (root: string) => void): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), 'zungun-worker-target-'));
  cpSync(FIXTURE, root, { recursive: true });
  extra?.(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'Zungun Fixture']);
  git(root, ['remote', 'add', 'origin', TARGET_URL + '.git']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture base']);
  return { root, sha: git(root, ['rev-parse', 'HEAD']) };
}
function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}
function rebind(envelope: Json): Json {
  const spec = envelope.worker_job_spec;
  const scopePayload = { ...spec };
  delete scopePayload.scope_hash;
  spec.scope_hash = canonicalHash(scopePayload);
  envelope.work_lease.scope_hash = spec.scope_hash;
  envelope.job_spec_hash = canonicalHash(spec);
  envelope.execution_job_id = 'exec_' + canonicalHash({
    opportunity_id: spec.canonical_opportunity_id,
    worker_id: 'zungun',
    work_lease_id: envelope.work_lease.lease_id,
    scope_hash: spec.scope_hash,
    job_spec_hash: envelope.job_spec_hash,
  }).slice(0, 40);
  return envelope;
}
function envelopeFor(sha: string, overrides?: (value: Json) => void): Json {
  const value: Json = {
    schema: 'ZUNGUN_ATM_WORKER_JOB_V1',
    execution_job_id: '',
    job_spec_hash: '',
    worker_id: 'zungun',
    worker_source_sha: currentWorkerSha(),
    execution_budget_ms: 120000,
    worker_job_spec: {
      job_id: 'fixture-zungun-worker-reliability-001',
      canonical_opportunity_id: 'opp_fixture_zungun_reliability_001',
      external_source: 'atm-fixture',
      external_url: 'https://example.invalid/opportunities/zungun-reliability-001',
      task_type: 'NETWORK_RELIABILITY_AUDIT',
      frozen_acceptance_criteria: [
        'finding:ZL001_UNSAFE_SIDE_EFFECT_RETRY',
        'finding:ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE',
        'finding:ZL015_NO_RECEIVER_RECONCILIATION_PATH',
        'min_findings:6',
        'result_preserves_unknown',
        'no_authority_expansion',
        'outgoing_spend_usd:0',
      ],
      repository_or_input: TARGET_URL,
      deadline: iso(3600000),
      scope_hash: '',
      max_spend_usd: '0',
      required_capabilities: [
        'zungun.reliability_audit',
        'zungun.idempotency_retry',
        'zungun.ambiguous_timeout',
        'zungun.reconciliation',
        'zungun.blackout_testing',
        'zungun.resumable_transfer',
      ],
      structured_requirements: ['audit only; do not mutate target'],
      target_base_sha: sha,
      allowed_paths: ['src', 'README.md', 'evidence'],
      expected_deliverable: 'machine-readable reliability evidence',
      deterministic_checks: [
        'link_doctor',
        'target_clean',
        'scope_unchanged',
        'hash_artifacts',
        'blackout_core',
        'no_authority_expansion',
      ],
    },
    work_lease: {
      lease_id: 'lease_fixture_zungun_001',
      canonical_opportunity_id: 'opp_fixture_zungun_reliability_001',
      worker_id: 'zungun',
      scope_hash: '',
      acquired_at: iso(-1000),
      expires_at: iso(3600000),
      heartbeat_at: iso(-500),
      terminal_state: null,
    },
  };
  rebind(value);
  overrides?.(value);
  return value;
}
function writeJob(dir: string, value: Json): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'job.json');
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
  return path;
}
function parseLines(text: string): Json[] {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function invoke(
  command: string,
  envelope: Json | undefined,
  target: string,
  stateRoot: string,
  env: Record<string, string> = {},
): { status: number; events: Json[]; stderr: string } {
  const job = envelope ? writeJob(stateRoot, envelope) : undefined;
  const args = [CLI, command];
  if (job) args.push('--job', job, '--target-root', target);
  if (['status', 'collect', 'cancel'].includes(command)) {
    if (!envelope) throw new Error('envelope required');
    args.push('--execution-job-id', envelope.execution_job_id);
  }
  args.push('--state-root', stateRoot);
  const run = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: run.status ?? -1,
    events: parseLines(String(run.stdout || '')),
    stderr: String(run.stderr || ''),
  };
}
function invokeRawLifecycle(command: string, executionId: string, stateRoot: string): { status: number; events: Json[] } {
  const run = spawnSync(process.execPath, [CLI, command, '--execution-job-id', executionId, '--state-root', stateRoot], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  });
  return { status: run.status ?? -1, events: parseLines(String(run.stdout || '')) };
}
function correctEnv(envelope: Json): Record<string, string> {
  return {
    ATM_EXECUTION_JOB_ID: envelope.execution_job_id,
    ATM_WORK_LEASE_ID: envelope.work_lease.lease_id,
    ATM_SCOPE_HASH: envelope.worker_job_spec.scope_hash,
    ATM_JOB_SPEC_HASH: envelope.job_spec_hash,
    ATM_MAX_SPEND_USD: '0',
  };
}
function reason(run: { events: Json[] }): string {
  return String(run.events.at(-1)?.reason_code ?? run.events.at(-1)?.limitations?.[0] ?? '');
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
function cleanup(...paths: string[]): void {
  for (const path of paths) rmSync(path, { recursive: true, force: true });
}

async function crashAndResume(point: 'AFTER_ACK' | 'DURING_SPECIALIST' | 'AFTER_RESULT_READY', expectedCheckpoint: number): Promise<void> {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), `zungun-worker-crash-${point.toLowerCase()}-`));
  try {
    const envelope = envelopeFor(target.sha);
    const job = writeJob(state, envelope);
    const child: ChildProcess = spawn(process.execPath, [CLI, 'run', '--job', job, '--target-root', target.root, '--state-root', state], {
      cwd: ROOT,
      env: {
        ...process.env,
        ...correctEnv(envelope),
        NODE_ENV: 'test',
        ZUNGUN_WORKER_TEST_CRASH_POINT: point,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`crash timeout ${point}`)), 10000);
      child.on('exit', () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
    const before = invoke('status', envelope, target.root, state);
    assert.equal(before.status, 0);
    assert.equal(before.events[0]?.checkpoint_seq, expectedCheckpoint);
    const identity = before.events[0]?.execution_identity_hash;
    const resumed = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.events[0]?.type, 'ACK');
    assert.equal(resumed.events[0]?.execution_identity_hash, identity);
    assert.equal(resumed.events.at(-1)?.type, 'RESULT');
    assert.equal(invoke('status', envelope, target.root, state).events[0]?.checkpoint_seq, 3);
  } finally {
    cleanup(target.root, state);
  }
}

test('real immutable fixture emits Zungun ACK, meaningful progress, specialist evidence, UNKNOWN WorkerResult', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-state-'));
  try {
    const envelope = envelopeFor(target.sha);
    const run = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.equal(run.status, 0, JSON.stringify(run.events) + ' ' + run.stderr);
    assert.equal(run.events[0]?.type, 'ACK');
    assert.equal(run.events[0]?.origin, 'ZUNGUN');
    assert.equal(run.events[0]?.status, 'ACKNOWLEDGED');
    const progress = run.events.filter((event) => event.type === 'PROGRESS');
    assert.ok(progress.length >= 2);
    for (let index = 0; index < progress.length; index += 1) {
      assert.equal(progress[index]!.origin, 'ZUNGUN');
      assert.equal(progress[index]!.checkpoint_seq, index + 1);
      assert.notEqual(progress[index]!.artifact_before_hash, progress[index]!.artifact_after_hash);
      assert.ok(progress[index]!.new_evidence_refs.length > 0);
    }
    const result = run.events.at(-1)!;
    assert.equal(result.type, 'RESULT');
    assert.equal(result.origin, 'ZUNGUN');
    assert.equal(result.execution_state, 'UNKNOWN');
    assert.equal(result.outgoing_spend_usd, 0);
    assert.deepEqual(result.changed_paths, []);
    assert.ok(result.unresolved_findings.some((finding: Json) => finding.rule_id === 'ZL001_UNSAFE_SIDE_EFFECT_RETRY'));
    assert.ok(result.unknown_findings.some((finding: Json) => finding.rule_id === 'ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE'));
    assert.ok(result.unknown_findings.some((finding: Json) => finding.rule_id === 'ZL015_NO_RECEIVER_RECONCILIATION_PATH'));
    assert.ok(result.limitations.includes('TARGET_INSTRUCTION_CONFLICTS_PRESERVED_WITHOUT_SCOPE_EXPANSION'));
    assert.ok(result.evidence_identifiers.some((value: string) => value.startsWith('blackout-proof:')));
    assert.ok(result.content_hashes.every((value: string) => /^[0-9a-f]{64}$/.test(value)));
    console.log('WORKER_FIXTURE_RESULT_HASH=' + result.result_hash);
    console.log('WORKER_FIXTURE_CONTENT_HASHES=' + result.content_hashes.join(','));
  } finally {
    cleanup(target.root, state);
  }
});

test('prepare fails closed for immutable binding, capability, spend, authority, and path violations', () => {
  const target = makeTarget();
  try {
    const base = envelopeFor(target.sha);
    const cases: [string, (value: Json) => void, string][] = [
      ['wrong lease', (value) => { value.work_lease.worker_id = 'boqa'; }, 'WRONG_LEASE'],
      ['expired lease', (value) => { value.work_lease.expires_at = iso(-1000); }, 'EXPIRED_LEASE'],
      ['terminal lease', (value) => { value.work_lease.terminal_state = 'COMPLETED'; }, 'EXPIRED_LEASE'],
      ['stale lease', (value) => { value.work_lease.heartbeat_at = iso(-3600000); }, 'STALE_LEASE'],
      ['wrong scope', (value) => { value.worker_job_spec.scope_hash = '0'.repeat(64); }, 'WRONG_SCOPE_HASH'],
      ['wrong execution id', (value) => { value.execution_job_id = 'exec_' + '0'.repeat(40); }, 'WRONG_EXECUTION_JOB_ID_BINDING'],
      ['wrong job hash', (value) => { value.job_spec_hash = '0'.repeat(64); }, 'WRONG_JOB_SPEC_HASH'],
      ['wrong source', (value) => { value.worker_source_sha = '0'.repeat(40); }, 'WRONG_WORKER_SOURCE_SHA'],
      ['target base mismatch', (value) => { value.worker_job_spec.target_base_sha = '0'.repeat(40); rebind(value); }, 'TARGET_BASE_SHA_MISMATCH'],
      ['path escape', (value) => { value.worker_job_spec.allowed_paths = ['../escape']; rebind(value); }, 'PATH_ESCAPE'],
      ['unsupported capability', (value) => { value.worker_job_spec.required_capabilities = ['zungun.generic_coder']; rebind(value); }, 'UNSUPPORTED_CAPABILITY'],
      ['nonzero spend', (value) => { value.worker_job_spec.max_spend_usd = '1'; rebind(value); }, 'NONZERO_SPEND'],
      ['authority field', (value) => { value.financial_authority = true; }, 'AUTHORITY_EXPANSION_REQUEST'],
      ['repository mismatch', (value) => { value.worker_job_spec.repository_or_input = 'https://github.com/example/other'; rebind(value); }, 'TARGET_REPOSITORY_MISMATCH'],
    ];
    for (const [name, mutate, expected] of cases) {
      const state = mkdtempSync(join(tmpdir(), 'zungun-worker-negative-'));
      try {
        const value = clone(base);
        mutate(value);
        const run = invoke('prepare', value, target.root, state);
        assert.equal(run.status, 2, `${name}:${JSON.stringify(run.events)}`);
        assert.equal(reason(run), expected, name);
      } finally {
        cleanup(state);
      }
    }
  } finally {
    cleanup(target.root);
  }
});

test('post-ACK failing acceptance becomes durable terminal WorkerResult, never a second rejected ACK', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-criterion-fail-'));
  try {
    const envelope = envelopeFor(target.sha, (value) => {
      value.worker_job_spec.frozen_acceptance_criteria.push('finding:ZL999_NEVER_PRESENT');
      rebind(value);
    });
    const run = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.events[0]?.status, 'ACKNOWLEDGED');
    assert.equal(run.events.filter((event) => event.status === 'REJECTED').length, 0);
    const result = run.events.at(-1)!;
    assert.equal(result.type, 'RESULT');
    assert.equal(result.execution_state, 'QUARANTINED');
    assert.ok(result.limitations.includes('ACCEPTANCE_CRITERION_FAILED'));
    const rerun = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.deepEqual(rerun.events.map((event) => event.type), ['ACK', 'RESULT']);
    assert.equal(rerun.events.at(-1)?.result_hash, result.result_hash);
  } finally {
    cleanup(target.root, state);
  }
});

test('post-ACK deterministic-check failure becomes durable terminal WorkerResult', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-check-fail-'));
  try {
    const envelope = envelopeFor(target.sha, (value) => {
      value.worker_job_spec.required_capabilities = ['zungun.reliability_audit', 'zungun.evidence_generation'];
      value.worker_job_spec.deterministic_checks = ['link_doctor', 'blackout_core'];
      rebind(value);
    });
    const run = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.events[0]?.status, 'ACKNOWLEDGED');
    assert.equal(run.events.at(-1)?.execution_state, 'QUARANTINED');
    assert.ok(run.events.at(-1)?.limitations.includes('DETERMINISTIC_CHECK_FAILED'));
  } finally {
    cleanup(target.root, state);
  }
});

test('Link Doctor alone preserves ambiguous timeout and reconciliation findings as UNKNOWN', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-link-unknown-'));
  try {
    const envelope = envelopeFor(target.sha, (value) => {
      value.worker_job_spec.required_capabilities = ['zungun.reliability_audit'];
      value.worker_job_spec.deterministic_checks = ['link_doctor', 'target_clean', 'scope_unchanged', 'hash_artifacts'];
      value.worker_job_spec.frozen_acceptance_criteria = [
        'finding:ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE',
        'finding:ZL015_NO_RECEIVER_RECONCILIATION_PATH',
        'result_preserves_unknown',
        'outgoing_spend_usd:0',
      ];
      rebind(value);
    });
    const run = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.equal(run.status, 0, run.stderr);
    const result = run.events.at(-1)!;
    assert.equal(result.execution_state, 'UNKNOWN');
    assert.ok(result.unknown_findings.some((finding: Json) => finding.rule_id === 'ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE'));
    assert.ok(result.unknown_findings.some((finding: Json) => finding.rule_id === 'ZL015_NO_RECEIVER_RECONCILIATION_PATH'));
  } finally {
    cleanup(target.root, state);
  }
});

test('symlink escape is rejected before ACK', () => {
  const target = makeTarget((root) => {
    symlinkSync('/etc/hosts', join(root, 'src', 'escape-link'));
  });
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-symlink-'));
  try {
    const envelope = envelopeFor(target.sha);
    const run = invoke('prepare', envelope, target.root, state);
    assert.equal(run.status, 2);
    assert.equal(reason(run), 'SYMLINK_ESCAPE');
  } finally {
    cleanup(target.root, state);
  }
});

test('oversized tracked target file is rejected before it is read', () => {
  const target = makeTarget((root) => {
    writeFileSync(join(root, 'src', 'too-large.ts'), 'x'.repeat(1024 * 1024 + 1));
  });
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-oversize-'));
  try {
    const envelope = envelopeFor(target.sha);
    const run = invoke('prepare', envelope, target.root, state);
    assert.equal(run.status, 2);
    assert.equal(reason(run), 'TARGET_FILE_TOO_LARGE');
  } finally {
    cleanup(target.root, state);
  }
});

test('target file-count bound fails closed', () => {
  const target = makeTarget((root) => {
    const many = join(root, 'src', 'many');
    mkdirSync(many, { recursive: true });
    for (let index = 0; index < 2050; index += 1) writeFileSync(join(many, `f-${index}.txt`), 'x\n');
  });
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-many-files-'));
  try {
    const envelope = envelopeFor(target.sha);
    const run = invoke('prepare', envelope, target.root, state);
    assert.equal(run.status, 2);
    assert.equal(reason(run), 'TARGET_FILE_COUNT_EXCEEDED');
  } finally {
    cleanup(target.root, state);
  }
});

test('target .env is never implicitly trusted', () => {
  const target = makeTarget((root) => writeFileSync(join(root, '.env'), 'PRIVATE_KEY=not-read-by-worker\n'));
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-env-file-'));
  try {
    const envelope = envelopeFor(target.sha, (value) => {
      value.worker_job_spec.allowed_paths.push('.env');
      rebind(value);
    });
    const run = invoke('prepare', envelope, target.root, state);
    assert.equal(run.status, 2);
    assert.equal(reason(run), 'TARGET_ENV_FILE_FORBIDDEN');
  } finally {
    cleanup(target.root, state);
  }
});

test('ambient high-risk secret environment is rejected before ACK', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-secret-env-'));
  try {
    const envelope = envelopeFor(target.sha);
    const run = invoke('prepare', envelope, target.root, state, { OPENAI_API_KEY: 'sk-test-secret-material-1234567890' });
    assert.equal(run.status, 2);
    assert.equal(reason(run), 'AMBIENT_SECRET_ENV_FORBIDDEN');
  } finally {
    cleanup(target.root, state);
  }
});

test('changed path outside allowed scope is quarantined and never presented as pass', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-drift-'));
  try {
    const envelope = envelopeFor(target.sha);
    assert.equal(invoke('prepare', envelope, target.root, state).status, 0);
    writeFileSync(join(target.root, 'outside.txt'), 'external drift\n');
    const run = invoke('execute', envelope, target.root, state);
    assert.equal(run.status, 0);
    const result = run.events.at(-1)!;
    assert.equal(result.type, 'RESULT');
    assert.equal(result.execution_state, 'QUARANTINED');
    assert.ok(result.limitations.includes('CHANGED_PATH_OUTSIDE_SCOPE'));
    assert.ok(result.changed_paths.includes('outside.txt'));
  } finally {
    cleanup(target.root, state);
  }
});

test('identical duplicate dispatch returns existing execution without duplicate progress or side effect', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-duplicate-'));
  try {
    const envelope = envelopeFor(target.sha);
    const first = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.equal(first.status, 0);
    const firstResult = first.events.at(-1)!;
    const second = invoke('run', envelope, target.root, state, correctEnv(envelope));
    assert.equal(second.status, 0);
    assert.deepEqual(second.events.map((value) => value.type), ['ACK', 'RESULT']);
    assert.equal(second.events.at(-1)?.result_hash, firstResult.result_hash);
    assert.equal(invoke('status', envelope, target.root, state).events[0]?.checkpoint_seq, 3);
  } finally {
    cleanup(target.root, state);
  }
});

test('conflicting duplicate target identity fails closed', () => {
  const target = makeTarget();
  const otherRoot = mkdtempSync(join(tmpdir(), 'zungun-worker-target-copy-'));
  cpSync(target.root, otherRoot, { recursive: true });
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-conflict-'));
  try {
    const envelope = envelopeFor(target.sha);
    assert.equal(invoke('prepare', envelope, target.root, state).status, 0);
    const run = invoke('prepare', envelope, otherRoot, state);
    assert.equal(run.status, 2);
    assert.equal(reason(run), 'CONFLICTING_DUPLICATE_TARGET_ROOT');
  } finally {
    cleanup(target.root, otherRoot, state);
  }
});

test('crash after ACK resumes same immutable execution', async () => crashAndResume('AFTER_ACK', 0));
test('crash during specialist execution resumes same immutable execution', async () => crashAndResume('DURING_SPECIALIST', 1));
test('crash after RESULT_READY before return replays durable terminal result', async () => crashAndResume('AFTER_RESULT_READY', 3));

test('cooperative cancellation preserves durable checkpoint and stops new work', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-cancel-'));
  try {
    const envelope = envelopeFor(target.sha);
    assert.equal(invoke('prepare', envelope, target.root, state).status, 0);
    const first = invoke('execute', envelope, target.root, state);
    assert.equal(first.events[0]?.checkpoint_seq, 1);
    const cancelled = invoke('cancel', envelope, target.root, state);
    assert.equal(cancelled.events[0]?.execution_state, 'CANCELLED');
    const status = invoke('status', envelope, target.root, state);
    assert.equal(status.events[0]?.checkpoint_seq, 1);
    assert.equal(status.events[0]?.terminal, true);
    assert.equal(invoke('run', envelope, target.root, state).events.at(-1)?.execution_state, 'CANCELLED');
  } finally {
    cleanup(target.root, state);
  }
});

for (const outcome of ['UNKNOWN', 'AMBIGUOUS'] as const) {
  test(`${outcome} target evidence is preserved and never silently converted to success`, () => {
    const target = makeTarget((root) => {
      writeFileSync(join(root, 'src', 'reliability-client.ts'), 'export function stable(): boolean { return true; }\n');
      writeFileSync(join(root, 'evidence', 'outcome.bin'), JSON.stringify({ schema: 'EXTERNAL_RELIABILITY_OBSERVATION_V1', outcome }) + '\n');
    });
    const state = mkdtempSync(join(tmpdir(), `zungun-worker-${outcome.toLowerCase()}-`));
    try {
      const envelope = envelopeFor(target.sha, (value) => {
        value.worker_job_spec.required_capabilities = ['zungun.reliability_audit'];
        value.worker_job_spec.deterministic_checks = ['link_doctor', 'target_clean', 'scope_unchanged', 'hash_artifacts'];
        value.worker_job_spec.frozen_acceptance_criteria = [
          outcome === 'UNKNOWN' ? 'result_preserves_unknown' : 'result_preserves_ambiguous',
          'outgoing_spend_usd:0',
        ];
        rebind(value);
      });
      const run = invoke('run', envelope, target.root, state, correctEnv(envelope));
      assert.equal(run.status, 0, JSON.stringify(run.events) + ' ' + run.stderr);
      assert.equal(run.events.at(-1)?.execution_state, outcome);
      assert.notEqual(run.events.at(-1)?.execution_state, 'COMPLETED');
    } finally {
      cleanup(target.root, state);
    }
  });
}

test('malformed lifecycle execution IDs cannot traverse state root', () => {
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-id-'));
  try {
    for (const id of ['../escape', '/tmp/escape', 'exec_short', 'not-an-exec']) {
      for (const command of ['status', 'collect', 'cancel']) {
        const run = invokeRawLifecycle(command, id, state);
        assert.equal(run.status, 2, `${command}:${id}`);
        assert.equal(reason(run), 'MALFORMED_EXECUTION_JOB_ID');
      }
    }
  } finally {
    cleanup(state);
  }
});

test('oversized worker job input fails closed before JSON parsing', () => {
  const target = makeTarget();
  const state = mkdtempSync(join(tmpdir(), 'zungun-worker-job-oversize-'));
  try {
    const job = join(state, 'job.json');
    writeFileSync(job, '{"padding":"' + 'x'.repeat(300 * 1024) + '"}\n');
    const run = spawnSync(process.execPath, [CLI, 'prepare', '--job', job, '--target-root', target.root, '--state-root', state], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    });
    const events = parseLines(String(run.stdout || ''));
    assert.equal(run.status, 2);
    assert.equal(reason({ events }), 'JOB_INPUT_TOO_LARGE');
  } finally {
    cleanup(target.root, state);
  }
});

test('state root cannot overlap target or Zungun source checkout', () => {
  const target = makeTarget();
  const envelope = envelopeFor(target.sha);
  const targetState = join(target.root, '.worker-state');
  const workerState = join(ROOT, '.worker-state-should-not-exist');
  try {
    const targetRun = invoke('prepare', envelope, target.root, targetState);
    assert.equal(targetRun.status, 2);
    assert.equal(reason(targetRun), 'STATE_ROOT_OVERLAPS_TARGET');
    const workerRun = invoke('prepare', envelope, target.root, workerState);
    assert.equal(workerRun.status, 2);
    assert.equal(reason(workerRun), 'STATE_ROOT_OVERLAPS_WORKER_SOURCE');
  } finally {
    cleanup(target.root, targetState, workerState);
  }
});

test('forged worker self-declared external acceptance is forbidden by publication contract', () => {
  assert.throws(
    () => validatePublishedWorkerResult({ type: 'RESULT', origin: 'ZUNGUN', accepted: true, checker_pass: true }),
    (error: any) => error?.reasonCode === 'WORKER_RESULT_AUTHORITY_FORBIDDEN',
  );
});
