# Zungun product baseline

## Source

- Repository: `simonkey888/Zungun`
- Mission base SHA: `5c49374d5fa54858108cffe437520b793d0cfeb4`
- GAOS LEAN implementation branch: `feat/gaos-lean-product-baseline-v1`
- Order: `ZUNGUN-ARQ-CANONICAL-PRODUCT-BASELINE-059`

## Product today

The repository provides a TypeScript ZEP semantic protocol core and a stateless validation canary. The canary exposes health and envelope-validation behavior. It does not provide a messaging network or user-facing delivery product.

## Invariants for this checkpoint

- Runtime source bytes remain unchanged from the mission base SHA.
- Dependency versions remain unchanged.
- All changed paths are limited to governance, documentation, reusable CI, and verification tooling.
- Existing canary and core type checks, tests, fuzzers, and Wrangler dry-run build must pass on the implementation branch.
- No default-branch change, Cloudflare write, deploy, merge, release, or production mutation is allowed.

## Reusable CI

`.github/workflows/gaos-lean-baseline.yml` is both branch-triggered and callable with `workflow_call`. It validates the GAOS LEAN schemas and event log, enforces the exact scope boundary from the mission base SHA, reruns runtime regression checks, and proves that Wrangler remains dry-run only.

## Evidence and release boundary

- The active checkpoint is `/ops/evidence/GAOS-LEAN-BASELINE-CP001.json`.
- Release remains explicitly unauthorized in `/ops/releases/GAOS-LEAN-BASELINE-001.json`.
