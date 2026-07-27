# ZUNGUN — ARQ — CLOUDFLARE CANARY LOCAL MATRIX

```text
ORDER_ID=ZUNGUN-ARQ-CF-CANARY-20260726-031
DELIVERY_ID=ZUNGUN-ARQ-ZEP-CF-CANARY-IMPLEMENTATION-20260726-001
SOURCE_PREFLIGHT_ORDER=ZUNGUN-ARQ-CF-PREFLIGHT-20260726-030
SOURCE_PREFLIGHT_REPORT=21 — ARQ — CLOUDFLARE READ-ONLY PREFLIGHT REPORT — 2026-07-26
```

| Finding | Local disposition | Remaining gate |
|---|---|---|
| CF-PREFLIGHT-001: Cloudflare auth/account unavailable | Not bypassed; no Cloudflare call or secret added | Resolve only after canary and CI evidence pass independent audit |
| CF-PREFLIGHT-002: audited core is not a Worker | Remediated locally by a stateless Worker wrapper; core remains byte-identical | Independent source audit and official Wrangler dry-run |
| CF-PREFLIGHT-003: GitHub branch is recovery-only/nondeployable | No GitHub write performed; exact materialization plan included | Independent authorization for one exact commit and one manual workflow run |
| CF-PREFLIGHT-004: worker/account/environment/target unresolved | Provisional canary name fixed locally; no account/environment inferred | Resolve authenticated account and target after CI evidence audit |

```text
LOCAL_UNIT_TESTS=37/37
LOCAL_FUZZ_CASES=3392
LOCAL_FUZZ_UNEXPECTED_ACCEPTS=0
LOCAL_FUZZ_NATIVE_FAILURES=0
LOCAL_FUZZ_REFLECTIONS=0
CORE_SOURCE_IDENTITY=40/40
CONFIG_BINDINGS=0
CONFIG_CUSTOM_ROUTES=0
CONFIG_ENVIRONMENTS=0
CONFIG_REDIRECTS=0
WRANGLER_TYPES=NOT_EXECUTED_REGISTRY_UNAVAILABLE
WRANGLER_DRY_RUN=NOT_EXECUTED_REGISTRY_UNAVAILABLE
REMOTE_MUTATIONS=0
```
