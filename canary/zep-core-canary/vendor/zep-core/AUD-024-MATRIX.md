# AUD-024 remediation matrix

## F1 — Logical message content mutable after validation/storage

Status: REMEDIATED.

Implementation:
- `validateMessage` snapshots caller bytes.
- The validated `payload` property returns a defensive copy on every access.
- `extensions` accept only bounded JSON-like data, reject accessors/non-plain objects/non-finite values, deep-clone into null-prototype objects and deep-freeze the result.
- `InMemoryMessageStore` accepts only objects branded by `validateMessage`.

Evidence: `ZEP-ADV-001` plus deduplication property test.

## F2 — One recipient ACK completed a multi-recipient message

Status: REMEDIATED.

Implementation:
- `DeliveryStateMachine` owns the intended recipient set and an idempotent per-recipient acknowledgement ledger.
- Global `ACKNOWLEDGED` is rejected unless every intended recipient is acknowledged.
- Partial acknowledgement remains nonterminal and exposes pending recipients.

Evidence: `ZEP-ADV-002`, `ZEP-ADV-007`, and acknowledgement-order property test.

## F3 — Required TransportAdapter contract absent

Status: REMEDIATED.

Implementation:
- Exported `TransportAdapter` with `capabilities`, `status`, `send`, `receive`, and `cancel`.
- Exported operation contexts and normalized `TransportStatus`, `ReceiveBatch`, and `CancelResult`.
- Exported runtime invocation boundary functions that validate contexts and every adapter result.

Evidence: `ZEP-ADV-003` and `ZEP-ADV-008`; `CompleteTestAdapter` is compile-time checked against the interface.

## F4 — Untrusted structural fields lacked runtime validation

Status: REMEDIATED.

Implementation:
- Runtime validation for fragments, receipts, capabilities, status, send results, receive batches, cancel results, contexts, identifiers, booleans, safe integers, epochs and optional references.
- Malformed fractional, negative, NaN and overflow values are rejected before semantic use.

Evidence: `ZEP-ADV-004`, `ZEP-ADV-005`, and `ZEP-ADV-008`.

## F5 — Route selector could not enforce deadline plausibility

Status: REMEDIATED.

Implementation:
- `TransportCapabilities` now carries a deterministic conservative `estimatedCompletionDurationMs`.
- `selectRoute` receives effective `nowMs`, safely calculates completion time and removes any route completing at or after expiry before ranking.

Evidence: `ZEP-ADV-006`, including equality and near-expiry cases.

## F6 — External checksum sidecar named a different local path

Status: REMEDIATED IN NEW DELIVERY.

Implementation:
- The new external checksum sidecar contains only the portable archive basename `zungun-zep-core-v0.1.1-local-20260725.tar.gz`.

## Preserved boundaries

- Previous blocked archive remains unchanged.
- No GitHub, Cloudflare, PR, main, second commit, production or deployment action.
- This delivery is noncanonical pending independent post-implementation audit.
