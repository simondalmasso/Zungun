#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const jobSpecPath = requiredEnv('ATM_JOB_SPEC_PATH');
const taskResultPath = requiredEnv('ATM_TASK_RESULT_PATH');
const expectedJobSpecHash = requiredEnv('ATM_JOB_SPEC_HASH');
const executionJobId = requiredEnv('ATM_EXECUTION_JOB_ID');
const workLeaseId = requiredEnv('ATM_WORK_LEASE_ID');
const scopeHash = requiredEnv('ATM_SCOPE_HASH');
const workerSourceSha = requiredEnv('ATM_WORKER_SOURCE_SHA');

const rawSpec = readFileSync(jobSpecPath);
if (sha256(rawSpec) !== expectedJobSpecHash) {
  throw new Error('MATERIALIZED_JOB_SPEC_HASH_MISMATCH');
}
const spec = JSON.parse(rawSpec.toString('utf8'));
if (spec.task_type !== 'deterministic_digest_v1') {
  throw new Error('UNSUPPORTED_ATM_TASK_TYPE');
}
if (typeof spec.repository_or_input !== 'string') {
  throw new Error('FROZEN_INPUT_REQUIRED');
}

const frozenInput = Buffer.from(spec.repository_or_input, 'utf8');
const result = {
  schema: 'ATM_TASK_RESULT_V1',
  execution_job_id: executionJobId,
  work_lease_id: workLeaseId,
  scope_hash: scopeHash,
  job_spec_hash: expectedJobSpecHash,
  task_type: spec.task_type,
  producer: {
    worker_source_sha: workerSourceSha,
    worker_entrypoint: 'tools/atm-worker-entrypoint.mjs'
  },
  task_output: {
    kind: 'SHA256_UTF8_INPUT_V1',
    sha256: sha256(frozenInput),
    byte_length: frozenInput.length
  },
  outgoing_spend_usd: 0
};

const fd = openSync(taskResultPath, 'wx', 0o600);
try {
  writeFileSync(fd, JSON.stringify(result), 'utf8');
} finally {
  closeSync(fd);
}
