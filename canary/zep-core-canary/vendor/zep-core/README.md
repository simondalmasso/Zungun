# Zungun ZEP Core v0.1.5-local — AUD-028 delta-integrity remediation

Transport-agnostic TypeScript implementation of the ZEP v0.1 semantic core, based on Google Drive contract document `1YpKHOueu9crd4pZ8aGqUGPMMrHB4Tr5VKQWq8CD_pOQ` at pinned source revision `AIroW37af-KzerY_CQ_8m_IqpppI7RaVw5-FUwMG_cHyZ3yEu4lPw34skceIxI8WmWpYtqHNs6phzzPWQyBXEmaNF__XPkxwfPIX7GSnonY`.

- `DELIVERY_ID=ZUNGUN-ARQ-ZEP-CORE-IMPLEMENTATION-20260726-006`
- `SOURCE_DELIVERY_ID=ZUNGUN-ARQ-ZEP-CORE-IMPLEMENTATION-20260726-005`
- `SOURCE_BLOCK_AUDIT_ID=ZUNGUN-AUD-20260726-ZEP-CORE-EVIDENCE-INTEGRITY-REAUDIT-004`
- `SOURCE_BLOCK_ORDER_ID=ZUNGUN-ARQ-AUD-20260726-028`
- `VERSION=0.1.5-local`
- `CANONICAL=NO_PENDING_INDEPENDENT_REAUDIT`

This evidence-delta-integrity-only delivery preserves deliveries 001 through 005 unchanged. Runtime source, tests, fuzz tool and TypeScript configuration are byte-identical to deliveries 004 and 005. The only corrective objective is to repair the historical `004→005` file-delta evidence by recording the intentional removal of `evidence/003-to-004.diff.txt` with SHA-256 `7c0e925bd27a2dbbb79ffa53257644ce692903bbe6be125fdea8b5536ae10d4d` and the exact counts `UNCHANGED=21`, `CHANGED=11`, `ADDED=4`, `REMOVED=1`.

Delivery 006 also contains a separately generated `005→006` manifest. Both manifests are produced from the union of source and target paths and therefore classify removed paths explicitly. Self-referential manifest files and `evidence/SHA256SUMS.txt` are declared exclusions where applicable.

The package contains no Android, BLE implementation, SMS implementation, satellite integration, Cloudflare action, GitHub write, PR, second commit, production cryptography, deployment, or network runtime dependency.

## Verification

```bash
npm run verify
npm run fuzz
# or both:
npm run verify:deep
```

Fresh package result:

- 48/48 total tests
- 14/14 semantic vectors
- 28/28 adversarial tests
- 6/6 property groups
- 4,138 deterministic public-boundary fuzz cases
- 49 runtime exports classified
- 0 raw native errors
- 0 unexpected accepts in strict negative cases
- 0 unclassified runtime exports
- TypeScript strict typecheck and build pass
- Zero runtime, optional, peer or development dependencies

See `AUD-028-MATRIX.md`, prior matrices, both delta manifests, identity evidence, logs, source hashes, static scans, toolchain and deterministic archive evidence under `evidence/`.
