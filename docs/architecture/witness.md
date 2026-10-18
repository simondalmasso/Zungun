# Zungun Witness evidence continuity

Zungun Witness is an application-layer evidence chain for critical operational events across unreliable or multi-vendor connectivity. The schema is `zungun-witness/1`. Hashes prove integrity of attributed assertions; they do not prove that the underlying physical-world assertion is true.

## Trust boundaries

The modeled boundaries are `SENSOR_OR_SOURCE`, `ZUNGUN_WITNESS`, `TRANSPORT`, `RECEIVER`, `INCIDENT_PLATFORM`, and `RESPONDER`. Supported transport vocabulary is vendor-neutral: `CELLULAR`, `WIFI`, `LORA_RADIO`, `MESH`, `STORE_FORWARD`, `HTTP_WEBHOOK`, `SATELLITE`, and `HUMAN`.

A transport assertion is never receiver durability. Receiver durability is never application effect. Ownership is never action, and action is never resolution.

## State model

| State | Evidence boundary | Meaning |
| --- | --- | --- |
| `DETECTED` | source | A source observed or asserted the event. |
| `COMMITTED_LOCAL` | Zungun local | The sender durably committed its event record. |
| `CUSTODY_ACCEPTED` | transport | A named route accepted custody. |
| `DELIVERED_DURABLY` | receiver | The receiver transactionally persisted the sender chain and its own durable extension. |
| `OWNED_BY_RESPONDER` | responder | A responder explicitly accepted ownership. |
| `ACTION_STARTED` | responder | A responder attested that action began. |
| `CONDITION_RECHECKED` | source | The relevant condition was observed again. |
| `RESOLVED` | responder | Resolution was attested after a condition recheck. |
| `UNKNOWN` | derived | Required evidence is missing or unrecoverable. |
| `CONFLICT` | derived | Valid evidence histories contradict. |
| `EXPIRED_WITHOUT_RESOLUTION` | derived | The evidence window expired without resolution proof. |
| `RECONCILED` | derived | Histories were reconciled with an explicit code. |

The happy path is `DETECTED -> COMMITTED_LOCAL -> CUSTODY_ACCEPTED -> DELIVERED_DURABLY -> OWNED_BY_RESPONDER -> ACTION_STARTED -> CONDITION_RECHECKED -> RESOLVED -> RECONCILED`. Intermediate uncertainty may instead end in `UNKNOWN`, `CONFLICT`, or `EXPIRED_WITHOUT_RESOLUTION`.

## Integrity and sender/receiver ownership

Every item binds incident identity, evidence identity, state, class, emitter, authorization scope, observed and monotonic time, provenance, reason, claims, previous state/hash and chain position. Verification reconstructs every canonical SHA-256 value and rejects position changes, duplicate IDs, monotonic regression, invalid transitions, boundary violations, or altered content.

Android owns only `DETECTED`, `COMMITTED_LOCAL`, and `CUSTODY_ACCEPTED`. The receiver verifies that sender prefix, persists it, and appends `DELIVERED_DURABLY` in the receiver database transaction. An identical retry is idempotent. Divergent history fails closed.

Responder states are appended only through separately authorized receiver APIs. `RESOLVED` cannot be appended before `CONDITION_RECHECKED`.

## Reconciliation

Sender and receiver histories are independently verified. Same-position hash divergence returns `CONFLICT`. When the sender lost a response but the receiver has a valid durable extension, reconciliation returns `RECEIVER_DURABLE_EVIDENCE_RECOVERED`. Existing uncertainty remains explicit rather than being upgraded optimistically.
