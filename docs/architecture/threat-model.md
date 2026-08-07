# Threat model

This document describes the repository candidate. It is not a production certification or a claim that a hostile endpoint, operator, backend, source, or human can always be detected.

## Assets and boundaries

Critical assets are stable operation/idempotency identity, message commitments, local queue state, Witness chains, execution receipts, receiver persistence, signing-key state, authorization audit records, reconciliation decisions, proof bundles, and declared completeness scopes.

The main trust boundaries are source/device, local durable storage, transport, receiver, application/ERP, responder, and reviewer/reconciler. A compromised legitimate boundary can make a false assertion with internally valid integrity metadata; Zungun records attribution and continuity, not omniscient truth.

## Main threats and controls

| Threat | Control |
| --- | --- |
| Duplicate retry | Stable identity, receiver deduplication and replay ledger. |
| Response loss after receiver write | Explicit `UNKNOWN` plus sender/receiver Witness reconciliation. |
| Altered evidence | Canonical hash chain and deterministic tamper tests. |
| Boundary overclaim | State-specific trust-boundary validation and reserved receiver states. |
| Cross-role access | Separate ingest/read/attest/reconcile permissions and negative tests. |
| Concurrent/stale worker | Transactional lease and fencing token. |
| Receipt tamper/stale/revoked key | P-256 verification, binding checks and key lifecycle validation. |
| Dependency substitution | Lockfiles and strict Gradle verification metadata. |
| Proof-bundle alteration | Per-object hashes, manifest hash and offline chain verification. |
| Redaction hiding chain changes | Redaction marker binds original hash and reason; critical chain/manifest redaction is forbidden. |
| Missing evidence interpreted as success | Explicit `UNKNOWN`, `CONFLICT`, and `EXPIRED_WITHOUT_RESOLUTION`. |

## Residual risk

Zungun cannot prove radio propagation, satellite availability, sensor correctness, human truthfulness, physical remediation, or honesty of a fully compromised authority. Production operation additionally requires organizational identity, protected key custody, backup, monitoring, retention policy, incident response, and infrastructure controls outside this repository.
