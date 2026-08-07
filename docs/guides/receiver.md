# Persistent receiver

The receiver uses a relational SQLite database with ordered migrations, durable deduplication, replay ledger, transactional claims, leases and fencing tokens. Application effects and receipts are recorded separately from transport and receiver acceptance. Health and readiness endpoints are unauthenticated; operational APIs require bearer authentication.

The machine-readable contract is `services/receiver/openapi/openapi.yaml`. Local startup is documented in [local development](../runbooks/local-development.md).
