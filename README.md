# Zungun — Delivery Assurance

> **Product hypothesis:** an Android SDK/runtime and receiver contract for durable delivery of critical app operations under intermittent, low-bandwidth, or satellite-enabled connectivity. Backend-agnostic by design; commercial value still requires independent benchmark and buyer evidence.

Zungun is focused on **critical mutations**, not generic offline caching. It persists an operation locally, preserves a stable identity, applies an explicit retry contract, and reconciles ambiguous delivery with receiver evidence before risking another side effect. It keeps transport acceptance, receiver durability, business effect, and final evidence separate.

The current technical foundation is split into:

- **Zungun Link:** delivery planning under constrained connectivity, priority for critical payloads, deferred/resumable evidence transfer, exact-base delta policy and safe reconciliation.
- **Witness:** continuity and integrity of operation evidence.
- **Receiver contract:** durable idempotency and a query/reconciliation path, with stronger assurance only where the receiver can prove it.
- **Proof and operations tooling:** inspectable receipts, incident bundles, Control Room and reproducible blackout/resilience exercises.

This is not a claim of universal exactly-once execution. The strongest guarantees require receiver participation. Android WorkManager, Firebase offline features, PowerSync, Ditto and Couchbase Lite already solve overlapping parts of scheduling, persistence and offline sync. Zungun must demonstrate incremental value for side-effecting operations across existing backends.

## Start with one critical endpoint

1. Run Link Doctor locally to inventory OpenAPI writes.
2. Wrap one mutation with an explicit Link delivery profile.
3. Split critical core data from deferred attachments where the workflow supports it.
4. Add the receiver idempotency/reconciliation boundary only where needed.
5. Compare against a fair Room + WorkManager + backend-outbox baseline under reproducible fault injection.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run demo:link
npm run benchmark:assurance
```

The fixture is local evidence, not proof of production-scale behavior, OEM background reliability, customer savings or paid demand.

## Current commercial stance

**CONDITIONAL GO:** validate one high-cost workflow with design partners and publish a reproducible benchmark. Do not claim Zungun is a necessary infrastructure standard, a DOCOMO partner, a certified product, or a proven revenue stream. The current evidence and five go/no-go gates are in [the Delivery Assurance assessment](docs/strategy/delivery-assurance-assessment.md).

## Architecture and verification

- [Delivery Assurance strategic assessment](docs/strategy/delivery-assurance-assessment.md)
- [Zungun Link architecture](docs/link-architecture.md)
- [Link quickstart](docs/guides/link-quickstart.md)
- [Link Doctor / OpenAPI scaffold](docs/link-doctor.md)
- [Protocol core](docs/architecture/protocol.md)
- [Witness evidence continuity](docs/architecture/witness.md)
- [Threat model](docs/architecture/threat-model.md)
- [Android runtime](docs/guides/android-runtime.md)
- [Persistent receiver](docs/guides/receiver.md)
- [Receipt security](docs/architecture/security.md)
- [Reconciliation](docs/architecture/reconciliation.md)
- [Control Room](docs/guides/control-room.md)
- [Resilience Lab and Blackout Drill](docs/guides/resilience-lab.md)
- [Comparative assurance benchmark](docs/reference/comparative-assurance-benchmark.md)
- [Incident Proof Bundle](docs/reference/incident-proof-bundle.md)
- [Repository authority and migration record](REPOSITORY_AUTHORITY.md)

## Evidence boundaries

UNKNOWN, CONFLICT, and unresolved required evidence are incomplete states, not success. L0 Link planning does not claim L1 receiver durability or L2 business-effect assurance. An HTTP success response is not proof of the business effect. Emulator CI does not exhaustively prove OEM background behavior or real satellite-network performance.

GitHub is the canonical development repository. GitLab is a historical legacy snapshot and is not synchronized or maintained as a mirror.
