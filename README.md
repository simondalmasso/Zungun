# Zungun — Delivery Assurance

> An Android SDK/runtime and receiver contract for critical field operations that must remain explicit and recoverable when mobile connectivity is unreliable.

Zungun focuses on critical mutations, not generic offline caching. It preserves a stable operation identity, persists pending work, and reconciles ambiguous outcomes with receiver evidence before risking another side effect. Transport acceptance, receiver durability, business effect, and final evidence remain separate states.

**[Live demo](https://zungun.simondalmasso44.workers.dev/) · [Developer guide](https://zungun.simondalmasso44.workers.dev/developers) · [Architecture](docs/link-architecture.md) · [Strategic assessment](docs/strategy/delivery-assurance-assessment.md)**

## What it does

- **Durable delivery planning:** retain pending critical operations and resume work under constrained connectivity.
- **Receiver idempotency:** reuse a stable identity so repeated requests can be deduplicated at the receiver's storage boundary.
- **Reconciliation before retry:** query the receiver when a timeout leaves the business outcome unknown and the receiver supports that contract.
- **Verifiable evidence:** keep sender, transport, receiver, and business-effect evidence distinct.
- **Developer and operations tooling:** Link Doctor, the Control demo, proof inspection, and deterministic resilience exercises.

## How it fits

    Android operation
        → durable local state + stable identity
        → delivery plan and transport attempt
        → receiver idempotency / reconciliation
        → inspectable evidence and an explicit outcome

Zungun is not a universal exactly-once protocol. Stronger guarantees require receiver participation and a queryable evidence boundary. WorkManager, Firebase offline features, PowerSync, Ditto, and Couchbase Lite solve overlapping parts of scheduling, persistence, and offline sync; Zungun must prove incremental value for side-effecting operations.

## Quick start

    npm ci --ignore-scripts --no-audit --no-fund
    npm run demo:link

For the deeper local verification suite:

    npm run verify:deep

To run the deterministic comparative assurance benchmark:

    npm run benchmark:assurance

The benchmark compares naive HTTP retry, receiver idempotency, a SQLite outbox baseline, and Zungun Link reconciliation under a deterministic response-loss-after-commit fault. It is a correctness harness, not a real-network or Android/OEM performance benchmark. See the [comparative assurance benchmark](docs/reference/comparative-assurance-benchmark.md).

For public-site SEO and browser checks, see the [public-site guide](docs/guides/public-site.md). These checks are correctness evidence, not proof of production-scale performance, OEM background reliability, customer savings, or willingness to pay.

## Live surfaces

| Route | Purpose | Indexing |
| --- | --- | --- |
| / | Product scope and demo entry point | Indexable |
| /developers | SDK overview and integration boundaries | Indexable |
| /control | Bounded field-work demo | Noindex |
| /messages | Honest delivery-state demo | Noindex |
| /ops | Persisted execution evidence | Noindex |

The deployed public-site source of truth is cloudflare/public/. Its release uses the existing guarded ORDER-083 deployment procedure and verifies the deployed source identity.

## Current product stance

**CONDITIONAL GO:** validate one high-cost workflow with design partners and publish a reproducible benchmark. Do not claim Zungun is a necessary infrastructure standard, a DOCOMO partner, a certified product, or a proven revenue stream. The current evidence and five go/no-go gates are in the [Delivery Assurance assessment](docs/strategy/delivery-assurance-assessment.md).

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
- [Public site, SEO, and production E2E](docs/guides/public-site.md)
- [Repository authority and migration record](REPOSITORY_AUTHORITY.md)

## Evidence boundaries

UNKNOWN, CONFLICT, and unresolved required evidence are incomplete states, not success. L0 Link planning does not claim L1 receiver durability or L2 business-effect assurance. An HTTP success response is not proof of the business effect. Emulator CI does not exhaustively prove OEM background behavior or real satellite-network performance.

GitHub is the canonical development repository. GitLab is a historical legacy snapshot and is not synchronized or maintained as a mirror.
