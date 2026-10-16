# Recovery record — historical and superseded for repository authority

This file is retained for audit continuity. Its original recovery-only flags describe the state at commit 13d6745217672da16985d815c427aa4c953de227; they are not the current repository-authority policy.

## Current authority

```text
CANON=https://github.com/simondalmasso/Zungun
LEGACY=https://gitlab.com/simondalmasso/Zungun
SOURCE_OF_TRUTH=YES_FOR_REPOSITORY_CONTENT
GITLAB_MIRROR=NO
DEPLOYMENT_STATUS=NOT_VERIFIED_BY_THIS_FILE
PRODUCTION=NOT_ASSERTED
```

The GitHub merge commit 73d400c82fb62015b1710593084e8fe15139f692 promoted the full product checkout as the default checkout. GitLab remains a reduced historical snapshot and is not a mirror target. See [REPOSITORY_AUTHORITY.md](REPOSITORY_AUTHORITY.md) for the comparison and [the Delivery Assurance assessment](docs/strategy/delivery-assurance-assessment.md) for the current product hypothesis.

This promotion establishes repository authority only. It does not authorize a Cloudflare deployment, certify production behavior, establish willingness to pay, or replace order-specific test and approval gates.

## Preserved original recovery snapshot

The following values are preserved as historical evidence for the earlier recovery-only state:

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

At that stage, the branch was intended only to execute one controlled GitHub Actions toolchain-recovery run against the preserved Phase 0 source artifact. Dependency, TypeScript, lint, test, configuration, or audit failures were to be reported before any correction was attempted.

Preserved input artifact:

```text
zungun-staging-source-0.1.0.tar
ae01b71644950b626e057aadbef7199ea367a1449c63b8fd242e64147c2d1ed2
```