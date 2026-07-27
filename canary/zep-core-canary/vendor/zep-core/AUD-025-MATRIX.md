# AUD-025 remediation matrix

## ZEP-AUD025-001 — Public acknowledgement bypass

Status: REMEDIATED.

Implementation:
- Removed the raw `recordRecipientAcknowledgement(recipientId, context)` mutation surface.
- Added `ReceiptVerifier` as an explicit trust boundary.
- `verifyEndRecipientReceipt` validates the complete receipt, message binding, receipt kind, authentication declaration, verifier result and causal timestamps.
- Verified receipts receive an unforgeable runtime brand held in a module-private `WeakSet`.
- `DeliveryStateMachine.recordVerifiedRecipientAcknowledgement` accepts only that branded proof.
- Global `ACKNOWLEDGED` remains impossible until every intended recipient has a verified acknowledgement.

Negative evidence:
- `ZEP-ADV-009` raw acknowledgement method absent.
- `ZEP-ADV-010` forged verified token rejected.
- `ZEP-ADV-011` acknowledged outcome without verifier rejected.
- `ZEP-ADV-012` verifier rejection prevents acknowledgement.

## ZEP-AUD025-002 — Semantically incapable transport selected

Status: REMEDIATED.

Implementation:
- `selectRoute` now receives a validated `RouteRequirements` object.
- ZEP v0.1 requires binary support.
- Multi-fragment delivery requires fragmentation support.
- Optional transport-receipt requirements are explicit.
- `END_RECIPIENT_ACK` messages require end-recipient receipt support.
- Capability mismatches are excluded before scoring and fail with `CAPABILITY_MISMATCH` when no capable route remains.
- Deadline feasibility remains strict: completion at or after expiry is excluded.

Negative evidence:
- `ZEP-ADV-016` no-binary route excluded.
- `ZEP-ADV-017` no-fragmentation route excluded.
- `ZEP-ADV-018` no-final-ack route excluded.
- `ZEP-ADV-019` no-transport-receipt route excluded when required.

## ZEP-AUD025-003 — Locale-dependent route tie-break

Status: REMEDIATED.

Implementation:
- Replaced `String.localeCompare` with a locale-independent code-unit order.

Negative evidence:
- `ZEP-ADV-020` identical result for `z` and `ä` regardless of input order.

## ZEP-AUD025-004 — Causally impossible receipt

Status: REMEDIATED.

Implementation:
- Receipt must satisfy `message.createdAtMs <= receipt.observedAtMs < message.expiresAtMs`.
- Outcome application additionally requires `receipt.observedAtMs <= context.atMs`.
- Acknowledgement history preserves the receipt observation time rather than rewriting it to a later effective clock.

Negative evidence:
- `ZEP-ADV-013` pre-creation receipt rejected.
- `ZEP-ADV-014` receipt at or after expiry rejected.
- `ZEP-ADV-015` future receipt relative to outcome observation rejected.

## ZEP-AUD025-005 — Receive limit and cursor semantics

Status: REMEDIATED.

Implementation:
- `adapterReceive` enforces `items.length <= context.limit`.
- `hasMore=true` requires a non-null continuation cursor.
- The cursor invariant is also enforced by `validateReceiveBatch`.

Negative evidence:
- `ZEP-ADV-021` oversized batch rejected.
- `ZEP-ADV-022` non-progressing `hasMore` batch rejected.

## Preserved boundaries

- Delivery 001 remains unchanged.
- Delivery 002 remains unchanged.
- No GitHub, Cloudflare, PR, main, second commit, production, deployment or final-cryptography action.
- This delivery remains noncanonical pending an independent post-implementation audit pinned to exact document revisions and archive hash.
