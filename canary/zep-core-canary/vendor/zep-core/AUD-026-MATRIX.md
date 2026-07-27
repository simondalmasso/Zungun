# AUD-026 remediation matrix

## ZEP-AUD026-001 — Partial-recipient machine could reach global ACK

Status: REMEDIATED.

Implementation:
- `DeliveryStateMachine` can only be constructed from a complete object branded by `validateMessage`.
- The machine retains the exact validated `LogicalMessage` instance, not a caller-supplied message ID or recipient subset.
- `applySendResult` requires the exact bound message instance before interpreting any outcome.
- Runtime-branded verified receipt proofs are associated through a module-private `WeakMap` with the exact message instance against which verification occurred.
- `recordVerifiedRecipientAcknowledgement` rejects a proof produced for a substitute message even when message ID and commitment match.
- Global `ACKNOWLEDGED` remains impossible until every recipient in the bound message is acknowledged.

Negative evidence:
- `ZEP-ADV-023` rejects substitute-message outcome application and direct substitute-message proof injection.
- `ZEP-ADV-024` rejects the legacy constructor shape that accepted partial recipient arguments.
- Public-boundary fuzzing generates message sizes from 2 through 12 recipients and rejects subset-message proof substitution.
- Recipient-order property testing still requires all intended recipients.

## ZEP-AUD026-002 — Provider-private fields survived validators

Status: REMEDIATED.

Implementation:
- Structural validators use exact key allowlists.
- Validated objects are reconstructed only from normalized allowed fields rather than spreading the provider object.
- Exact-key enforcement covers messages, fragments, receipts, capabilities, status, send outcomes, received items, receive batches, cancel outcomes, adapter contexts, attempt contexts, receive contexts, route requirements, route policy, outcome context, transition context and safe error records.
- Symbol keys, hidden fields and accessors are rejected.
- Nested message extensions remain the sole explicitly extensible boundary and are independently bounded, normalized and frozen.

Negative evidence:
- `ZEP-ADV-025` injects provider-private fields across all relevant structural boundaries and verifies rejection before mutation.
- Deterministic fuzzing injects 128 distinct private fields into each exact structural validator.

## ZEP-AUD026-003 — Null inputs leaked raw TypeError

Status: REMEDIATED.

Implementation:
- Public object boundaries require inspectable plain records before property access.
- Array, `Uint8Array`, `Set`, adapter and state-machine checks catch hostile proxy inspection failures.
- Transition and outcome contexts are snapshotted before use.
- Adapter-thrown native exceptions are normalized to retryable `TEMPORARY_UNAVAILABLE` ZEP errors.
- Arrays are snapshotted with intrinsic operations instead of trusting caller-overridden `.map` methods.

Negative evidence:
- `ZEP-ADV-026` classifies every runtime export and exercises nulls, primitive types, revoked proxies, throwing accessors, overridden array methods and adapter-native exceptions.
- Deterministic public-boundary fuzzing executes 4,138 cases with `RAW_NATIVE_ERRORS=0` and `UNCLASSIFIED_EXPORTS=0`.

## ZEP-AUD026-004 — Truthy non-boolean altered permanent rejection semantics

Status: REMEDIATED.

Implementation:
- `OutcomeContext` is validated atomically from an exact snapshot before any state mutation.
- `alternativeEligibleRouteExists` must be a primitive boolean.
- `atMs`, `attemptId`, capability and optional verifier are validated before interpreting a send result.
- `authorizeUnknownRetry` also requires a primitive boolean for duplication-risk acceptance.

Negative evidence:
- `ZEP-ADV-027` rejects string truthiness and verifies no state mutation.
- `ZEP-ADV-028` rejects null and extra context fields before mutation.
- Property testing covers truthy non-booleans.
- Deterministic fuzzing covers strings, numbers, arrays, objects, boxed booleans, null and undefined.

## Additional hardening discovered before publication

- Transition targets are runtime-enum validated.
- `TransitionContext` uses an exact allowlist and validates every optional identifier.
- Safe error records reject unsupported error-code strings.
- Revoked proxies cannot escape as native errors through plain-record, byte-array, set or state-machine checks.
- Verified receipt tokens cannot be reused across distinct validated message instances.

## Preserved boundaries

- Deliveries 001, 002, 003 and blocked delivery 004 remain unchanged.
- No GitHub, Cloudflare, PR, main, second commit, production, deployment or final-cryptography action.
- Delivery 005 remains noncanonical until an independent re-audit is pinned to its exact report revision, bundle revision, archive size and hashes.
