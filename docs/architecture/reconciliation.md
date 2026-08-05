# Reconciliation model

The reconciliation engine normalizes device, receiver, application, middleware, ERP and reviewer facts. It detects missing application acknowledgements, missing receipts, duplicate facts, external orphans and contradictory effects. It derives `EFFECT_CONFIRMED`, `NO_EFFECT_CONFIRMED`, `REJECTED`, `DUPLICATE_CONFIRMED`, `COMPENSATION_REQUIRED` or `UNKNOWN` without inventing evidence.

Reviews are revisioned and retained. Completeness certificates name the declared route, shift, device or batch and the devices that reported. They make no claim about unreported devices or facts outside that scope.
