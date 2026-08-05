# Receipt security and threat model

Receipts use ECDSA P-256 with SHA-256. The signed payload binds operation ID, message commitment, receiver ID, application result, bounded scope, protocol version, timestamps and replay nonce. Key IDs, validity windows, rotation and revocation are verified before signature acceptance.

The provider boundary supports a secure local file provider and can be implemented by a production KMS or HSM without changing receipt semantics. Local private-key files are created with owner-only permissions and are never committed.

Threats addressed include replay, identity reuse with changed commitment, signature or payload alteration, stale or revoked keys, lease theft, stale fencing tokens, unsafe diagnostics, excessive privileges and contradictory external facts. Production authentication, TLS termination, KMS policy and secret rotation are deployment responsibilities described in [security operations](../runbooks/security-operations.md).
