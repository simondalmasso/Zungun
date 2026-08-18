# Zungun ATM worker adapter

Zungun remains a standalone network-reliability product. This adapter is a thin process boundary for ATM and does not import ATM packages or reproduce ATM scheduling, WorkLease issuance, payment truth, claims, submissions, worker selection, or skill promotion.

## Stable entrypoint

Build once with the ordinary Zungun build:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

Then invoke the worker with machine-readable JSON only:

```sh
node dist/tools/worker-adapter/src/cli.js run \
  --job /absolute/path/job.json \
  --target-root /absolute/path/exact-target-checkout
```

Lifecycle commands use the same executable:

```text
prepare --job JOB --target-root TARGET
execute --job JOB --target-root TARGET
run --job JOB --target-root TARGET
status --execution-job-id EXECUTION_ID
collect --execution-job-id EXECUTION_ID
cancel --execution-job-id EXECUTION_ID
```

`--state-root PATH` is optional. Without it, durable worker state is stored under `$HOME/.zungun/worker-state`. ATM should provide an isolated HOME as it already does for subprocess workers. Target repositories never contain worker state.

Stdout is JSONL. Human prose is not part of the protocol. ACK, progress and result records carry `origin:"ZUNGUN"`.

## Input mapping from current ATM contracts

The envelope schema is `tools/worker-adapter/schema/zungun-atm-worker-job-v1.schema.json`.

`worker_job_spec` is the current ATM `WorkerJobSpec.model_dump(mode="json")` unchanged. `work_lease` is the current ATM `WorkLease.model_dump(mode="json")` unchanged. The adapter adds only execution-process bindings that ATM already owns:

| Zungun envelope | ATM source |
| --- | --- |
| `execution_job_id` | `ExecutionJob.execution_job_id` |
| `job_spec_hash` | ATM `canonical_hash(WorkerJobSpec.model_dump(mode="json"))` |
| `worker_id` | `zungun` |
| `worker_source_sha` | pinned actuator/source SHA |
| `execution_budget_ms` | bounded supervisor execution budget |
| `worker_job_spec` | immutable `WorkerJobSpec` |
| `work_lease` | immutable `WorkLease` |

The adapter recomputes ATM's current hashes instead of trusting labels:

```text
scope_hash = SHA256(canonical_json(worker_job_spec excluding scope_hash))
job_spec_hash = SHA256(canonical_json(worker_job_spec))
execution_job_id = "exec_" + SHA256(canonical_json({
  opportunity_id: canonical_opportunity_id,
  worker_id: "zungun",
  work_lease_id: lease_id,
  scope_hash,
  job_spec_hash
}))[0:40]
```

The durable Zungun execution identity additionally binds `worker_source_sha`, `target_base_sha` and `allowed_paths`. A restart with different bindings is rejected.

Current ATM safe environment variables are independently checked when present: `ATM_EXECUTION_JOB_ID`, `ATM_WORK_LEASE_ID`, `ATM_SCOPE_HASH`, `ATM_JOB_SPEC_HASH`, and `ATM_MAX_SPEND_USD`. No secret is required by the worker.

## ACK and process ownership

ACK is emitted only after Zungun validates the immutable job, lease, hashes, worker source, exact target HEAD, target origin, path scope, symlink boundary, zero-spend fence, capability fence, deadline and lease freshness. Spawning the process is not ACK.

ATM's current `CheckoutSubprocessActuator._run_first_with_ack()` manufactures an ATM-side ACK immediately after `Popen`. Integration must replace that behavior for this worker with: write the immutable envelope, start this entrypoint, read the first Zungun JSONL ACK, validate all bindings, and only then transition the supervisor execution to ACKNOWLEDGED/RUNNING.

## Specialist profiles

The adapter accepts only jobs containing at least one supported `zungun.*` capability:

- `zungun.reliability_audit`
- `zungun.network_resilience`
- `zungun.offline_sync`
- `zungun.idempotency_retry`
- `zungun.ambiguous_timeout`
- `zungun.reconciliation`
- `zungun.android_background_work`
- `zungun.resumable_transfer`
- `zungun.blackout_testing`
- `zungun.evidence_generation`

`git`, `github`, `filesystem`, `shell`, `node`, and `evidence` are accepted only as auxiliary capability labels. A job with no Zungun domain capability or a generic-coder profile fails closed.

Link Doctor performs target-specific analysis. Blackout/reconciliation/resumable profiles additionally invoke the existing persisted Resilience Lab blackout drill, including UNKNOWN creation, reconcile-before-retry, duplicate-effect prevention and deferred-transfer reopen/resume proof.

## Bounded deterministic criteria

V1 intentionally does not execute arbitrary prose as commands. Supported frozen acceptance criteria are:

```text
finding:ZLNNN_RULE_NAME
min_findings:N
no_authority_expansion
outgoing_spend_usd:0
result_preserves_unknown
result_preserves_ambiguous
```

Supported deterministic checks are:

```text
link_doctor
target_clean
scope_unchanged
hash_artifacts
blackout_core
no_authority_expansion
```

Unsupported criteria/checks reject. ATM remains responsible for its independent checker after the worker returns.

## Target repository boundary

The target is untrusted input. V1 is deliberately read-only: it never edits the target. It requires exact `target_base_sha`, a matching GitHub `remote.origin.url`, a clean initial checkout and non-empty bounded `allowed_paths`. Absolute paths, `..`, `.git`, wildcard scope and symlink escape reject.

Every phase rechecks HEAD and changed paths. Any target drift is fail-closed. Drift outside `allowed_paths` produces `CHANGED_PATH_OUTSIDE_SCOPE` and a QUARANTINED result; in-scope external drift also stops because it invalidates the immutable base snapshot.

Repository text attempting to widen scope, alter lease/execution identity, enable financial/claim/submission/payment/wallet/signing authority, request nonzero spend or exfiltrate secrets is recorded as `TARGET_INSTRUCTION_CONFLICT`. It never changes worker authority. Safe read-only analysis can continue inside the original ATM scope.

## Durable progress and recovery

State is written atomically after every phase before the progress record is emitted. The sequence is:

```text
TARGET_BOUNDARY_AUDIT
SPECIALIST_ANALYSIS
DETERMINISTIC_VERIFICATION
```

Each progress receipt binds execution ID, checkpoint sequence, objective/scope hash, artifact before/after hashes, tests/checks, new evidence references, domain state, uncertainty/acceptance delta, error signature and timestamp. No timestamp-only heartbeat counts as progress.

An identical duplicate dispatch returns the stored ACK/state/result without adding checkpoints. SIGKILL/restart reloads the same execution identity and continues from the durable next phase. No target side effect exists to repeat in v1; the Resilience Lab side-effect proof itself is idempotency/reconciliation-specific and independently hashed.

`cancel` sets durable cooperative cancellation and returns a CANCELLED WorkerResult while preserving the last checkpoint. The worker does not renew its lease or deadline. ATM retains hard timeout/kill authority.

## UNKNOWN and AMBIGUOUS

Target evidence carrying an explicit `outcome`/`status` of `UNKNOWN` or `AMBIGUOUS` is never converted to success. The terminal WorkerResult preserves that status even when the process completed normally. Transport completion, HTTP success or process exit are not treated as application/business effect.

## Output records

ACK schema: `ZUNGUN_WORKER_ACK_V1`.
Progress schema: `ZUNGUN_WORKER_PROGRESS_V1`.
Result schema: `ZUNGUN_WORKER_RESULT_V1`.

WorkerResult contains immutable bindings, target/base/final SHA, changed paths, execution state, checks, resolved/unresolved/unknown findings, artifact/evidence identifiers, SHA-256 content identities, limitations, timestamps and `outgoing_spend_usd:0`. It does not assert payment, withdrawal, external acceptance, claim success or submission success.

## Required ATM actuator delta (not performed here)

Current profile:

```text
PREPARE  npm ci --ignore-scripts --no-audit --no-fund
EXECUTE  npm run test:link-blackout
CHECKER  npm run test:reconciliation
```

Required next integration:

```text
PREPARE  checkout pinned Zungun source; npm ci; npm run build
EXECUTE  write immutable ZUNGUN_ATM_WORKER_JOB_V1 JSON; invoke worker:zungun run; parse Zungun JSONL ACK/progress/result
CHECKER  ATM-owned independent checks against returned artifact hashes, target/base identity and acceptance criteria
CANCEL   invoke worker:zungun cancel before supervisor hard-kill when cooperative shutdown is available
```

ATM must stop treating `Popen` as Zungun ACK. ATM remains the only WorkLease issuer/renewer, execution supervisor, independent checker, submitter, claimant and economic/payment authority.
