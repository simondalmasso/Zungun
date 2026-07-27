# Toolchain gate

```text
TOOLCHAIN_GATE=BLOCKED_LOCALLY
CAUSE=NPM_REGISTRY_DNS_UNAVAILABLE_IN_EPHEMERAL_RUNTIME
AFFECTED_GATES=PACKAGE_LOCK;NPM_CI;WRANGLER_TYPES;WRANGLER_DEPLOY_DRY_RUN
LOCAL_CODE_GATES=PASS
REMOTE_EXECUTION=NOT_AUTHORIZED
```

The missing gates are not replaced with approximations. The proposed manual GitHub Actions workflow uses the exact source tree, exact dependency pins, immutable action SHAs, read-only repository permissions, no repository or Cloudflare secrets, and no deploy command without `--dry-run`.
