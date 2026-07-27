# AUD-028 delta-integrity remediation matrix

## ZUNGUN-AUD-20260726-ZEP-CORE-EVIDENCE-INTEGRITY-REAUDIT-004

Classification in delivery 005: BLOCK.

### Finding

The runtime, tests, fuzz corpus, package hashes and deterministic repack all passed. The sole integrity failure was in `evidence/004-to-005-file-delta.txt`: it omitted the intentional removal of `evidence/003-to-004.diff.txt` and therefore incorrectly declared `REMOVED_COUNT=0`.

The removed source artifact is fixed by exact identity:

- `PATH=evidence/003-to-004.diff.txt`
- `SOURCE_SHA256=7c0e925bd27a2dbbb79ffa53257644ce692903bbe6be125fdea8b5536ae10d4d`
- `TARGET_STATE=ABSENT`

The authoritative historical delta is:

- `UNCHANGED=21`
- `CHANGED=11`
- `ADDED=4`
- `REMOVED=1`

### Remediation in delivery 006

- Deliveries 001 through 005 remain immutable and preserved.
- Runtime source, tests, fuzz tool and `tsconfig.json` remain byte-identical to deliveries 004 and 005.
- The historical `004→005` manifest is regenerated from the union of source and target paths and now contains the explicit `REMOVED` record and correct counts.
- A new `005→006` manifest is independently generated with the same union-of-paths algorithm.
- Manifest generation declares self-reference and `evidence/SHA256SUMS.txt` exclusions explicitly.
- Internal checksums, inventory, verify/fuzz logs, static scans and deterministic archive evidence are regenerated.

### Acceptance evidence

- Correct historical removal path and SHA are present exactly once.
- Historical counts equal `21/11/4/1`.
- New `005→006` manifest counts agree with an independent recomputation.
- `npm run verify:deep`: 48/48 tests and 4,138 fuzz cases over 49 runtime exports.
- Code/test/tool/config identity against delivery 005: PASS for 19/19 files.
- Clean extraction verification: PASS.
- Deterministic USTAR + gzip level 6 repack: byte-identical.

### Boundaries

No GitHub, Cloudflare, main, PR, second commit, deployment, production or final-cryptography action is authorized or performed by this delivery.
