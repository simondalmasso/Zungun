# Worker security boundary

Assets protected: Zungun canonical source, target repositories, ATM lifecycle/lease truth, credentials, evidence integrity and external/economic authority.

Trust boundaries:
- WorkerJobSpec and WorkLease are immutable ATM inputs and are revalidated by Zungun.
- Target repository files, README/AGENTS-like instructions, source text and fixtures are attacker-controlled data.
- Zungun-generated evidence is non-economic worker evidence; ATM independently checks acceptance.

V1 allowed effects are read-only target analysis plus worker-local durable state/artifacts outside both the target and Zungun source checkout. External network is not required by specialist execution.

Fail-closed protections:
- exact worker/job/lease/scope/source/target/base/path bindings;
- stale, expired or terminal lease rejection;
- nonzero-spend and authority-expansion rejection;
- canonical execution IDs before state-path construction;
- path traversal, `.git`, wildcard and symlink escape rejection;
- target/state/source overlap rejection;
- target `.env` rejection;
- known ambient cloud/API/wallet/private-key secret variables rejected before ACK;
- adapter Git commands use `core.hooksPath=/dev/null`;
- per-file, aggregate-byte and file-count limits are enforced before content reads;
- generated JSON artifacts are scanned for common credential patterns before publication;
- target drift is quarantined and cannot become PASS;
- UNKNOWN/AMBIGUOUS receiver truth remains non-success.

Cancellation is cooperative; ATM retains the hard timeout/process-kill fence. V1 starts no long-lived target-mutation child process, so a worker kill cannot leave Zungun-authored target edits running.

Known limitations: static target-instruction conflict detection is evidence, not a universal prompt-injection classifier; secret scanning is defense-in-depth, not a guarantee that arbitrary secret formats are detectable; Android CI is not exhaustive OEM proof.
