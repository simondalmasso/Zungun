# ATM integration handoff boundary

Worker identity: `zungun`
Repository: https://github.com/simonkey888/Zungun
Protocol: `ZUNGUN_ATM_WORKER_JOB_V1`
Entry point: `node dist/tools/worker-adapter/src/cli.js run --job <job.json> --target-root <exact-target-checkout> --state-root <isolated-state>`
Recommended max concurrency: 1
Cost ceiling: USD 0
Financial/claim/submission/model authority: 0
Project core continues: YES

ATM must write the immutable envelope, start the pinned Zungun source, read and validate the first Zungun-origin ACK, persist Zungun-origin progress, collect the terminal Zungun result and independently check frozen criteria/artifact hashes. `Popen` is not worker ACK.

Schema bridge required before ATM activation: Zungun emits flat `ZUNGUN_WORKER_RESULT_V1`; current ATM `WorkerResult` / `validate_zungun_result_contract` expects nested `target`, `execution`, `verification`, `findings`, `evidence`, `delivery` and `cost` structures. The separate ATM integration order must implement an explicit deterministic translation or validator update. Zungun does not mutate ATM in ORDER-WR-001.

ATM retains WorkLease issuance/renewal/revocation, supervisor truth, hard timeout/kill, independent acceptance, submission/claim, wallet/signing and economic/payment truth. Worker output asserting external acceptance or economic truth is rejected at the Zungun publication boundary and remains non-authoritative at ATM.
