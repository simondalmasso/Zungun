# Satellite Adapter Decision Record (ADR) Template

Use one copy per candidate integration. Do not fill unknown fields with assumptions.

## Status

- Decision: PROPOSED / ACCEPTED / REJECTED / DEFERRED
- Date and reviewer:
- Repository commit:
- Provider/product/API version:
- Official documentation URLs and access date:
- Evidence links:

## User need

- Use case:
- Sender and receiver:
- One-way / two-way:
- Payload size and encoding:
- Frequency / peak rate:
- Latency and expiry target:
- Offline duration:
- Acceptable loss, duplication, and reordering:
- Criticality and consequence of a lost/duplicate effect:
- Budget ceiling and explicit approval for paid tests:

## Transport classification

Choose exactly what the integration provides:
- DIRECT_TO_DEVICE_NTN
- SATELLITE_IOT
- SATELLITE_IP
- SATELLITE_BACKHAUL_ONLY
- TERRESTRIAL_SMS
- LOCAL_RADIO
- OTHER / UNKNOWN

Explain whether the device can transmit while it has no terrestrial IP connectivity. A cloud API that requires Internet access is not direct offline connectivity.

## Device and service prerequisites

- Exact hardware / firmware / OS:
- Antenna and sky-view requirements:
- Country/region and supported coverage:
- Provisioning/subscription requirements:
- App/API access constraints:
- Power and thermal constraints:
- Regulatory and emergency-use caveats:

## Protocol and operational contract

- Authentication and credential rotation:
- TLS / end-to-end encryption:
- Payload and segmentation limits:
- Rate limits / quotas / cost per message or byte:
- Store-and-forward behavior:
- Provider message IDs:
- Delivery receipts and exact semantics:
- Status query / bounded negative result:
- Idempotency support and key scope:
- Callback retry and ordering:
- Timeout and cancellation behavior:
- Firmware/API compatibility policy:

## Zungun integration mapping

- Existing transport interface to reuse:
- DeliveryProfile mapping:
- Durable outbox and stable operation identity:
- Receiver idempotency boundary:
- Reconciliation query:
- Witness evidence events:
- Failure states and fail-closed behavior:
- Bulk/critical prioritization:
- No-link and budget-exhausted behavior:

## Threat model

Assess replay, spoofing, destination substitution, key theft, malicious payloads/fragments, denial of service, queue exhaustion, prompt injection in received content, metadata leakage, provider compromise, and unsafe local bridge exposure.

## Alternatives

Compare at least two viable options where available: capabilities, proof quality, coverage, payload/latency, device requirements, cost, vendor lock-in, integration effort, and operational risk.

## Verification plan

- Static/contract tests:
- Fake-adapter resilience tests:
- Receiver idempotency/reconciliation tests:
- Provider sandbox:
- Hardware-in-the-loop:
- Field test and explicit authorization:
- Exact success evidence:
- Rollback and kill switch:
- CI run and commit SHA:

## Decision and evidence level

- Chosen option and rationale:
- Rejected options and reasons:
- Known gaps:
- Evidence level: DOCUMENTED / DESIGNED / IMPLEMENTED_NOT_FIELD_TESTED / SANDBOX_VERIFIED / HARDWARE_VERIFIED / PRODUCTION_VERIFIED
- Sign-off:

Never use PRODUCTION_VERIFIED without current evidence from the real provider/device path and receiver. CI or simulator success alone is insufficient.
