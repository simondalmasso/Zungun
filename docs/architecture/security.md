# Security architecture

Zungun separates authentication, authorization, transport acceptance, receiver durability, application evidence, receipt verification, Witness attestation, and reconciliation. None is treated as proof of another.

## Least privilege

The receiver supports roles `ingest`, `reader`, `worker`, `reviewer`, and `admin`. Witness permissions are separate: `witness:ingest`, `witness:read`, `witness:attest`, and `witness:reconcile`. Sender/receiver transport states are reserved and cannot be manufactured through the attestation endpoint. Authentication and authorization decisions are written to `auth_audit` without bearer credential values.

Static bearer principals are a reference implementation for controlled operation. Non-loopback or production use requires explicit identity configuration and organizational credential handling.

## Receipt keys

Execution receipts bind operation ID, message commitment, receiver identity, application outcome/reference, declared scope, validity interval and replay nonce. Clients verify canonical digest, P-256 signature, key ID, validity/revocation and operation-specific bindings before terminal success.

## Supply chain and secrets

CI uses npm/Gradle locks, strict Gradle dependency verification metadata, license policy, vulnerability checks, tracked-text secret scanning, SBOM generation, and source/tree provenance. Generated reports must not print secret values.

## Witness integrity

Witness uses canonical SHA-256 chaining as an integrity mechanism, not as a replacement for source authentication or physical-world verification. See the [threat model](threat-model.md).
