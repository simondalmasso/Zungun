# Protocol and wire contract

The historical TypeScript oracle under `canary/zep-core-canary/vendor/zep-core` remains authoritative for the original 49-export contract, `LogicalMessage`, validation, receipt semantics, routing and delivery-state transitions. Product additions live under `packages/protocol-core` and do not replace the oracle.

`zungun.operation.v1` binds stable operation identity, idempotency identity, tenant, bounded scope, work order, message commitment, payload, priority, retry budget, cancellation policy, semantic-revalidation requirement, deadline and replay nonce. Serialization is deterministic and commitments use SHA-256.

Transport acceptance, receiver acceptance, application effect, application acknowledgement and signed receipt are separate facts. Terminal states remain irreversible. A timeout or missing acknowledgement remains `UNKNOWN` rather than being guessed as success or failure.
