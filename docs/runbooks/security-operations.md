# Security operations runbook

## Identity configuration

Set `ZUNGUN_PRINCIPALS_JSON` to an array of explicit principal definitions. Do not expose the development principal set beyond loopback. Production or non-loopback startup fails unless identity configuration is supplied.

## Key rotation

Use an administrator principal on `POST /api/v1/keys/rotate` with `nowMs` and `validityMs`. Existing keys remain available for historical verification. Confirm `/ready` reports the new active key.

## Key revocation

Use `POST /api/v1/keys/{keyId}/revoke`. Revocation is persisted atomically and survives restart. Receipts checked at or after the revocation time fail verification. Revoking the active key makes readiness fail until a non-revoked active key is established.

## Corruption and concurrency

A corrupt key store causes startup/readiness failure. Concurrent mutation uses an exclusive sidecar lock and fails with `KEY_STORE_BUSY` rather than overwriting another revision. Investigate and preserve the corrupt or locked files before recovery; do not silently regenerate identity.

## Authorization audit

Administrators can read `/api/v1/auth-audit`. Entries contain subject, action, resource, allow/deny decision and reason class. Bearer values are never stored.
