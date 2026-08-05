# Zungun

Zungun is an application-level critical-operation system for unstable connectivity. It preserves explicit ambiguity, distinguishes transport acceptance from business effect, issues verifiable receipts only when justified, and reports completeness only within a declared reporting scope.

## Components

- [Protocol core](docs/architecture/protocol.md)
- [Android runtime](docs/guides/android-runtime.md)
- [Persistent receiver](docs/guides/receiver.md)
- [Receipt security](docs/architecture/security.md)
- [Reconciliation](docs/architecture/reconciliation.md)
- [Control Room](docs/guides/control-room.md)
- [Resilience Lab](docs/guides/resilience-lab.md)
- [Local development](docs/runbooks/local-development.md)

## Boundaries

Zungun does not claim universal exactly-once execution, operator or standards-body endorsement, satellite-network semantics, or business-effect proof from transport acceptance alone. `UNKNOWN` is a valid outcome until sufficient evidence exists.
