# ORDER-WR-001 remote truth

Observed 2026-08-18.

- Control order: https://github.com/simonkey888/ATM-Agent-Teller-Machine/issues/25
- Zungun repository: https://github.com/simonkey888/Zungun
- canonical default branch: `recovery/remote-toolchain-v1`
- canonical base at worker-PR creation: `73d400c82fb62015b1710593084e8fe15139f692`
- `main`: ABSENT in current remote branch search; the named default above is authoritative.
- current Zungun governance/product direction: https://github.com/simonkey888/Zungun/issues/10 — Android Critical Operation Runtime / safe semantic execution after delay; preserve existing core and keep satellite as a constrained-network profile, not the product category.
- current open worker/readiness PR: https://github.com/simonkey888/Zungun/pull/20 on `feat/zungun-atm-worker-adapter-001`; final exact HEAD is bound dynamically by exact-head CI/artifact.
- other current open PR: https://github.com/simonkey888/Zungun/pull/16, HEAD `9c8dbef3cc50ffd10bf326aabbcf2b11154d6f61`, OPEN+DRAFT+UNMERGED; it is a separate forensic/legacy line and is not an implementation base for ORDER-WR-001.
- worker adapter source/schema/docs live under `tools/worker-adapter/**` and `docs/atm-worker-adapter.md`; standalone product tests/workflows remain present and are required by the exact-head readiness workflow.
- Zungun README and Issue #10 define an independent evidence/continuity product roadmap. ATM worker mode is additive and does not supersede that roadmap.
- no ATM repository source change, production deployment, submission, claim, payment operation or merge is authorized by this order.

`UNWRITTEN_FACTS_USED=0`. Final exact-head identity and CI results are generated in the completion job and published as the `ATM-WORKER-READY-R1` workflow artifact.
