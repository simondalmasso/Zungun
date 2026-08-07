# Persistent receiver

The reference receiver uses SQLite with ordered migrations, durable deduplication, replay ledger, transactional claims, leases and fencing tokens. Application effects and receipts remain separate from transport and receiver acceptance.

Migration 5 adds `witness_evidence`. Sender ingest verifies a complete chain ending in `CUSTODY_ACCEPTED`; one SQLite transaction persists that prefix and appends receiver-generated `DELIVERED_DURABLY`. Identical sender replay is idempotent and divergent history fails closed.

Responder/action/recheck/resolution evidence is accepted only through role-protected Witness attestation after durable receiver evidence exists. Read, ingest, attest and reconcile are separate permissions.

The machine-readable API is `services/receiver/openapi/openapi.yaml`. Local startup is described in [local development](../runbooks/local-development.md).
