# ORDER 081 verification map

Gates 20–36 are exact-head, read-only CI checks. The final seal additionally requires an exact-head successful Order 075/077 baseline run proving Gates 01–19 on the same SHA.

| Gate | Evidence |
|---|---|
|20|Link TypeScript build/type/lint/unit|
|21|Planner determinism, invariants and replay|
|22|Shared TypeScript/Kotlin vector corpus exact match|
|23|Android LinkSnapshot contract and callback observer|
|24|Room Witness v4 → Link v5 migration/recovery|
|25|priority/deadline/dependency/fairness|
|26|critical-core/deferred split|
|27|exact-base delta safety|
|28|content-addressed resumable heavy transfer|
|29|prefetch/good-link policy|
|30|transport capability and per-transfer network-binding safety|
|31|ambiguous acceptance → UNKNOWN → query → acceptance recovered, second side-effect send zero; bounded-negative retry only|
|32|Receiver Proxy L1 security/compatibility|
|33|Link Doctor and OpenAPI scaffold|
|34|Link Witness/proof/Control Room semantics|
|35|Resilience Lab + Blackout Drill + security negative matrix|
|36|same-head 01–35 success, hashes, no skips, clean tree, manifest|

No gate authorizes merge, deploy, release, production mutation, paid API use, secret exposure, force-push or history rewrite.
