# Protocol and wire contract

The protected historical TypeScript oracle under `canary/zep-core-canary/vendor/zep-core` remains authoritative for the original protocol contract. Product additions under `packages/protocol-core` extend it without editing that oracle.

`zungun.operation.v1` binds operation identity, idempotency identity, tenant, declared scope, work order, message commitment, payload, priority, retry budget, cancellation policy, semantic-revalidation requirement, deadline and replay nonce. Serialization and commitments are deterministic.

Transport acceptance, receiver acceptance, application effect, application acknowledgement and signed receipt are separate facts. A timeout or missing acknowledgement remains `UNKNOWN` rather than being guessed as success or failure. Terminal execution states remain irreversible.

Witness uses the separate `zungun-witness/1` contract described in [Witness evidence continuity](witness.md). The portable evidence container is `zungun-proof-bundle/1`, described in [Incident Proof Bundle](../reference/incident-proof-bundle.md).

API compatibility is versioned explicitly in protocol/schema identifiers and in the receiver OpenAPI document. Adding evidence surfaces must not silently change the meaning of existing operation or receipt fields.
