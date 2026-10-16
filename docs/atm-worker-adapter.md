# Zungun ATM worker adapter

Zungun remains an independent network-reliability product. ATM worker mode is an additive process boundary over the existing Link Doctor, Resilience Lab, reconciliation, Android reliability and evidence surfaces. Standalone Zungun does not depend on ATM packages, ATM availability, WorkLease issuance or ATM lifecycle state.

## Product boundary

```text
ZUNGUN_PRODUCT
  standalone Link Doctor + Link runtime + Resilience Lab + Android/runtime + evidence APIs

ZUNGUN_ATM_WORKER_MODE
  thin immutable-job adapter that calls Zungun product capabilities
```

ATM worker mode does not reproduce ATM scheduling, WorkLease mint/renew authority, worker selection, payment truth, claims, submissions, wallets/signing, skill promotion or final acceptance. No ATM job may mutate Zungun release, deployment or governance state.

## Stable entrypoint

Build with the ordinary Zungun build:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

Invoke the machine worker with JSON only:

```sh
node dist/tools/worker-adapter/src/cli.js run \
  --job /absolute/path/job.json \
  --target-root /absolute/path/exact-target-checkout \
  --state-root /absolute/path/isolated-worker-state
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

Without `--state-root`, state is stored under `$HOME/.zungun/worker-state`. State is rejected if it overlaps either the target checkout or the Zungun source checkout. Stdout is JSONL; human prose is not part of the protocol.

## Immutable input

The versioned envelope is `ZUNGUN_ATM_WORKER_JOB_V1`, documented by `tools/worker-adapter/schema/zungun-atm-worker-job-v1.schema.json`.

`worker_job_spec` maps to ATM `WorkerJobSpec`; `work_lease` maps to ATM `WorkLease`. The process envelope adds execution bindings already owned by ATM:

| Zungun envelope | ATM source |
| --- | --- |
| `execution_job_id` | `ExecutionJob.execution_job_id` |
| `job_spec_hash` | canonical hash of the frozen WorkerJobSpec |
| `worker_id` | `zungun` |
| `worker_source_sha` | exact pinned Zungun source SHA |
| `execution_budget_ms` | bounded supervisor budget |
| `worker_job_spec` | immutable job |
| `work_lease` | immutable lease |

The adapter recomputes rather than trusts labels:

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

Durable execution identity additionally binds `worker_source_sha`, `target_base_sha` and `allowed_paths`. Conflicting duplicates fail closed. Canonical lifecycle IDs must match `exec_[0-9a-f]{40}` before any state path is constructed.

ATM binding environment variables, when present, are independently checked: `ATM_EXECUTION_JOB_ID`, `ATM_WORK_LEASE_ID`, `ATM_SCOPE_HASH`, `ATM_JOB_SPEC_HASH`, `ATM_MAX_SPEND_USD`. The worker requires no secret.

## ACK, progress and result ownership

ACK is emitted by Zungun only after validation of the immutable job, lease, hashes, source SHA, exact target HEAD/origin, scope, symlink boundary, zero-spend fence, supported capability, deadline and lease freshness. Process creation is not ACK.

After ACK, bounded worker/domain failures are persisted as fail-closed evidence and a terminal WorkerResult. They are never re-emitted as a second rejected ACK. Progress is Zungun-origin, durable and objective: checkpoint sequence, scope/objective hash, artifact before/after hashes, checks, evidence refs, domain state and uncertainty/acceptance delta.

Terminal output schemas are:

```text
ZUNGUN_WORKER_ACK_V1
ZUNGUN_WORKER_PROGRESS_V1
ZUNGUN_WORKER_RESULT_V1
```

The result binds the execution/job/lease/scope/source/target identities, checks, findings, artifacts, evidence hashes, limitations, timestamps and `outgoing_spend_usd=0`. Zungun output cannot authoritatively assert `accepted`, `checker_pass`, `paid`, `withdrawable`, claim/submission/payout success, payment truth or similar external/economic state.

## Specialist profiles

Worker mode accepts only jobs that include a supported `zungun.*` capability. The currently advertised domain labels are:

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

Production-routable capability claims are limited by the exact-head readiness evidence matrix; a manifest label alone is not proof. Generic coding or unrelated task profiles fail closed.

Link Doctor performs target-specific static analysis. Relevant reliability profiles additionally invoke the existing persisted Resilience Lab blackout/reconciliation/resumable-transfer proof. `UNKNOWN` and `AMBIGUOUS` are non-success states. Link Doctor rules `ZL005`, `ZL006` and `ZL015` remain UNKNOWN when receiver truth is absent.

## Bounded criteria

V1 deliberately does not execute arbitrary prose as commands. Supported frozen acceptance criteria are bounded forms such as:

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

Unsupported criteria or checks reject before specialist work. ATM remains responsible for its independent checker after worker return.

## Hostile target boundary

The target checkout and task text are untrusted data. Worker mode V1 is read-only and local-only:

- exact `target_base_sha` and matching GitHub `remote.origin.url` are required;
- target must begin clean;
- `allowed_paths` is non-empty and bounded;
- absolute paths, traversal, `.git`, wildcard scope and symlink escape reject;
- per-file, aggregate-byte and file-count limits are enforced before content reads;
- target `.env` files are not trusted;
- known ambient cloud/API/wallet/private-key secret variables reject before ACK;
- adapter Git commands disable hooks with `core.hooksPath=/dev/null`;
- state/output cannot live inside target or Zungun source;
- every phase rechecks target HEAD and changed paths;
- target instructions attempting scope, authority, spend or secret expansion become conflict evidence and are not obeyed;
- worker-generated JSON artifacts are scanned for common credential material before publication;
- no external network is required by V1 specialist execution.

Any target drift is fail closed. Out-of-scope drift becomes `CHANGED_PATH_OUTSIDE_SCOPE` and a QUARANTINED result. Because V1 never edits the target, cancellation or supervisor kill cannot leave a Zungun target-mutation child process running.

## Recovery and cancellation

State is atomically persisted. The normal sequence is:

```text
TARGET_BOUNDARY_AUDIT
SPECIALIST_ANALYSIS
RESULT_READY / DETERMINISTIC_VERIFICATION
terminal WorkerResult
```

An identical duplicate dispatch reuses the stored execution and does not create new checkpoints or side effects. Crash tests cover process death after ACK, during specialist execution and after RESULT_READY before process return. Restart resumes/replays the same immutable identity and terminal result where already durable.

`cancel` provides cooperative cancellation and preserves the last durable checkpoint. Zungun never renews its own lease or extends its own deadline. ATM retains the hard timeout/process-kill fence.

## ATM integration delta

The current ATM actuator profile that merely runs Zungun self-tests is insufficient. The separate ATM-side integration must move to:

```text
PREPARE  checkout exact pinned Zungun source; npm ci; npm run build
EXECUTE  write immutable ZUNGUN_ATM_WORKER_JOB_V1; invoke worker run; parse Zungun JSONL ACK/progress/result
CHECKER  ATM-owned independent validation of frozen criteria and exact artifact/content hashes
CANCEL   invoke cooperative Zungun cancel when possible, then ATM hard-kill fence if required
```

ATM must stop treating `Popen` as Zungun ACK.

There is also an explicit schema bridge requirement. Zungun emits flat `ZUNGUN_WORKER_RESULT_V1`, while the current ATM canonical `WorkerResult` / `validate_zungun_result_contract` expects nested `target`, `execution`, `verification`, `findings`, `evidence`, `delivery` and `cost` fields. A separate ATM order must implement a deterministic translation/validator update before activation. This Zungun order does not mutate ATM and does not pretend the schemas are already wire-compatible.

ATM remains sole owner of WorkLease issuance/renewal/revocation, execution-supervisor truth, hard timeout, independent acceptance, external submission/claim state, wallets/signing and economic/payment truth.
