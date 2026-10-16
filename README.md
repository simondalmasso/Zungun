# Zungun

> **Repository authority:** [GitHub is canonical](https://github.com/simondalmasso/Zungun). [GitLab is the legacy mirror target](https://gitlab.com/simondalmasso/Zungun); it was stale at the 2026-10-16 cutover and is **not yet verified as a live mirror**. See [Repository authority and cutover record](REPOSITORY_AUTHORITY.md).

Zungun is an independent evidence and continuity layer for critical operations under unstable connectivity. It preserves explicit ambiguity, separates transport acceptance from receiver durability and business effect, and records only evidence a responsible boundary is allowed to assert.

**Zungun Link** adds a semantic connectivity runtime for existing applications: durable offline mutation queuing, validated-link planning, safe retry after ambiguous timeout, critical-data-first delivery, resumable large evidence transfer, exact-base delta policy, declarative prefetch and receiver reconciliation. It does not replace TCP/QUIC, Android networking, the application backend, or Witness.

## Components

- [Zungun Link architecture](docs/link-architecture.md)
- [Link quickstart](docs/guides/link-quickstart.md)
- [Link Doctor / OpenAPI scaffold](docs/link-doctor.md)
- [ORDER 081 verification map](docs/order-081-verification.md)
- [Protocol core](docs/architecture/protocol.md)
- [Witness evidence continuity](docs/architecture/witness.md)
- [Threat model](docs/architecture/threat-model.md)
- [Android runtime](docs/guides/android-runtime.md)
- [Persistent receiver](docs/guides/receiver.md)
- [Receipt security](docs/architecture/security.md)
- [Reconciliation](docs/architecture/reconciliation.md)
- [Control Room](docs/guides/control-room.md)
- [Resilience Lab and Blackout Drill](docs/guides/resilience-lab.md)
- [Incident Proof Bundle](docs/reference/incident-proof-bundle.md)

## Existing REST API adoption

Start with one critical endpoint rather than rewriting an application:

```text
STEP_0  run Link Doctor locally
STEP_1  wrap one mutation with L0 Link planning
STEP_2  split critical core from deferred attachments
STEP_3  add allowlisted Receiver Proxy L1 for durable idempotency/reconciliation
STEP_4  add native L2 receiver/effect evidence only where justified
STEP_5  enable Witness / Proof Bundle / Blackout Drill for that workflow
```

`npm run doctor:link -- --openapi openapi.yaml` inventories local OpenAPI writes and emits a draft policy scaffold. Unknown business semantics remain `UNKNOWN_REQUIRES_ANNOTATION`; HTTP method alone never establishes retry safety.

## Evidence boundaries

Zungun does not claim universal exactly-once execution, operator or standards-body endorsement, satellite-network truth, sensor truth, regulatory certification, production scale, or business-effect proof from transport acceptance alone. `UNKNOWN`, `CONFLICT`, and unresolved required evidence are explicit non-success/incomplete states. L0 does not claim L1/L2 assurance. Emulator CI does not exhaustively prove OEM background behavior.
