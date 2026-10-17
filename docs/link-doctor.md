# zungun doctor — Link diagnostics

`npm run doctor:link -- <source files...>` performs deterministic local source analysis. `npm run doctor:link -- --openapi api.yaml` analyzes OpenAPI 3.x JSON/YAML and emits a draft `zungun.link.yaml` scaffold. Source is not uploaded.

Rules: `ZL001_UNSAFE_SIDE_EFFECT_RETRY`, `ZL002_MISSING_IDEMPOTENCY_CONTRACT`, `ZL003_STALE_CONNECTIVITY_BOOLEAN`, `ZL004_NO_DURABLE_MUTATION_OUTBOX`, `ZL005_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_FAILURE`, `ZL006_AMBIGUOUS_TIMEOUT_COLLAPSED_TO_SUCCESS`, `ZL007_NO_SEMANTIC_REVALIDATION_FOR_DELAYED_ACTION`, `ZL008_MONOLITHIC_LARGE_MUTATION`, `ZL009_NON_RESUMABLE_LARGE_UPLOAD`, `ZL010_BULK_CAN_STARVE_CRITICAL`, `ZL011_NO_PROCESS_DEATH_RECOVERY`, `ZL012_NO_REBOOT_RECOVERY`, `ZL013_SECRET_OR_PAYLOAD_DIAGNOSTIC_RISK`, `ZL014_NO_OPERATION_EXPIRY`, `ZL015_NO_RECEIVER_RECONCILIATION_PATH`, `ZL016_CONNECTED_WITHOUT_VALIDATION_CHECK`.

Findings include rule, severity, location, evidence, explanation, limitations and assurance tier. The analyzer is intentionally conservative and can produce false positives. A mutating OpenAPI operation is never assumed retry-safe. Missing annotations remain `UNKNOWN_REQUIRES_ANNOTATION` rather than being silently upgraded.
