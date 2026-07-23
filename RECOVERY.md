# Zungun remote toolchain recovery

```text
BRANCH=recovery/remote-toolchain-v1
BRANCH_CLASSIFICATION=NONCANONICAL_RECOVERY_ONLY
CODE_STATUS=RECOVERY_SOURCE_NONCANONICAL
DEPLOYABLE=NO
SOURCE_OF_TRUTH=NO
CLOUDFLARE_DEPLOY=FORBIDDEN
PRODUCTION=FORBIDDEN
MERGE=FORBIDDEN_PENDING_AUDIT
```

This branch exists only to execute one controlled GitHub Actions toolchain-recovery run against the preserved Phase 0 source artifact.

The workflow must not deploy, use secrets, alter Cloudflare, modify `main`, or treat generated outputs as canonical. Its first run is evidence collection only. Dependency, TypeScript, lint, test, configuration, or audit failures must be reported before any correction is attempted.

Expected preserved input artifact:

```text
zungun-staging-source-0.1.0.tar
ae01b71644950b626e057aadbef7199ea367a1449c63b8fd242e64147c2d1ed2
```
