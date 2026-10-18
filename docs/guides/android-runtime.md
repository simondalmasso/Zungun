# Android runtime

The native Android runtime uses Room and WorkManager so critical operations survive offline periods and process/device restart.

On first enqueue, one Room transaction stores the operation, ordinary `QUEUED` evidence and the Witness prefix `DETECTED -> COMMITTED_LOCAL`. The database schema is version 4; migration `3 -> 4` adds `witness_evidence` with a unique `(operationId, chainPosition)` index.

Before HTTP delivery, `DeliveryWorker` persists the transport attempt and one `CUSTODY_ACCEPTED` Witness record. Retries reuse the same chain position rather than duplicating custody. The HTTP client sends the operation envelope and then the sender Witness chain to the configured receiver. Android never creates `DELIVERED_DURABLY`.

A returned execution receipt is accepted only after digest, P-256 signature, key validity/revocation and operation/scope/nonce binding checks. Receiver acceptance without qualifying application receipt is not business-effect success.

The external consumer is a separate Gradle project that consumes Maven coordinate `com.zungun:zungun-runtime:1.0.80`, never `project(:runtime)`. CI verifies the produced AAR SHA-256 before and after standalone consumption.
