# Zungun

Zungun is an independent evidence and continuity layer for critical operational events under unstable connectivity. It preserves explicit ambiguity, separates transport acceptance from receiver durability and business effect, and records only the evidence a responsible boundary is allowed to assert.

Working category: **Operational Evidence Continuity**. Bring your own sensor, transport and control room; Zungun verifies the evidence that crosses those boundaries. It does not infer physical-world truth from network delivery.

## Components

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
- [Local development](docs/runbooks/local-development.md)
- [Order 080 verification](docs/runbooks/order-080-verification.md)

## Boundaries

Zungun does not claim universal exactly-once execution, operator or standards-body endorsement, satellite-network truth, sensor truth, responder physical action, or business-effect proof from transport acceptance alone. `UNKNOWN`, `CONFLICT`, and `EXPIRED_WITHOUT_RESOLUTION` are explicit non-success outcomes. Completeness is meaningful only inside a persisted declared reporting scope.
