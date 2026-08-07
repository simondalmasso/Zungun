# Reconciliation and declared completeness

Reconciliation derives an operational verdict from immutable facts. It never manufactures an application acknowledgement and never upgrades a verdict merely because a human reviewed it.

`APPLICATION_ACK` qualifies only when its source is the application. Review and manual-resolution records are retained as distinct evidence and excluded from the fact set that computes business-effect truth. Re-running reconciliation over the same operational facts yields the same proof hash.

Manual resolution records bind target verdict, rationale, referenced fact IDs, actor, revision, previous proof hash and new content-derived proof hash. A reviewer cannot convert `UNKNOWN` or `NO_EFFECT_CONFIRMED` into `EFFECT_CONFIRMED` without qualifying application evidence and a valid receipt.

Completeness requires a persisted scope manifest containing expected reporting devices, expected operation IDs and optionally an expected count. Missing declared devices or operations prevents completeness. An undeclared population cannot receive a completeness certificate.

Witness histories are verified independently before comparison. Same-position divergence returns `CONFLICT`. A receiver-only durable extension can reconcile a sender-side lost response as `RECEIVER_DURABLE_EVIDENCE_RECOVERED`. Uncertainty evidence remains explicit until a permitted, evidence-supported transition exists.
