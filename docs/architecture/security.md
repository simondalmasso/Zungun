# Security architecture

Zungun separates authentication, authorization, transport acceptance, application evidence, and receipt verification. None of these layers is treated as proof of another.

## Principal and permission model

The receiver uses an `IdentityProvider` boundary. The bundled static provider supports distinct principals with one or more explicit roles:

- `ingest`: submit operation envelopes;
- `reader`: read operations, reconciliation, completeness and public receipt keys;
- `worker`: claim operations, record application effects, cancel eligible operations and read verification keys;
- `reviewer`: inspect evidence and record evidence-bound reconciliation decisions;
- `admin`: declare scope populations, manage signing keys and read authorization audit records.

Permission checks are performed per route and deny by default. Authentication and authorization decisions are written to `auth_audit` without bearer credentials. A development principal set is created only for loopback, non-production startup. Binding beyond loopback or enabling production mode requires explicit identity configuration.

## Signing-key lifecycle

The file-backed P-256 provider stores a versioned key history, active key identifier, validity windows and revocation timestamps. Updates use an exclusive lock, a temporary file, `fsync`, atomic rename and mode `0600`. Every read reloads the durable state so separate provider instances observe rotation and revocation. Corruption, a busy lock, missing active key, expiration or revocation fails closed.

Receipts bind the operation ID, message commitment, receiver identity, application outcome, application reference, declared scope, validity interval and replay nonce. Clients verify the canonical payload digest, P-256 signature, key validity, revocation status and every operation-specific binding before changing local state to terminal.

## Production seams

Static bearer principals are a reference implementation, not a claim of enterprise identity completeness. Production deployments should implement `IdentityProvider` using an organizational identity service and should supply Android credentials through `CredentialProvider`. Credentials are not written to evidence or authorization audit detail.

## Supply-chain evidence

CI derives the CycloneDX component list from the resolved npm and Gradle lock graphs, enforces Gradle dependency verification metadata, applies a deny-unknown license policy, executes npm and OSV vulnerability checks, scans tracked text for credential patterns, and records source commit/tree plus dependency-manifest digests.
