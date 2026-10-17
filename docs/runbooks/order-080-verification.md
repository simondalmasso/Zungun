# Order 080 verification runbook

This runbook describes deterministic candidate verification; it does not authorize merge, deployment, release, production mutation, billing, paid services, or secret disclosure.

## Local reproduction

Use Node 22.16+ from a clean checkout with the committed lockfile:

```text
npm ci
npm run verify:deep
npm run test:witness
npm run verify:witness-bundle
npm run generate:witness-fixture
```

`verify:deep` covers formatting, lint, type safety, immutable oracle checks, complete Node tests, resilience/Blackout Drill, package consumer, docs, placeholders, secret scan and security evidence. Inspect generated artifacts instead of relying only on exit status.

## Android

The canonical CI installs Android platform/build-tools 35, uses Gradle 8.10.2 with strict verification, builds/publishes `com.zungun:zungun-runtime:1.0.80`, verifies its SHA-256, and compiles an independent consumer project. Android instrumentation covers Room migration/recovery, WorkManager delivery and the real HTTP/receiver evidence path.

## Troubleshooting

Do not relax dependency verification, skip a required gate, convert an ambiguous result to success, or hide a failed run. Fix the first causal failure and rerun on the new exact HEAD. Preserve failed historical runs and artifacts. A green badge tied to an older SHA is not completion evidence.

Final evidence must record exact HEAD/tree, ancestry, gate/run/job mapping, artifacts/hashes, supply-chain evidence, no-production/no-billing status and residual physical-world limitations before handoff to independent AUD.
