# Reconciliation and declared completeness

Reconciliation derives an operational verdict from immutable facts. It never creates an application acknowledgement and never upgrades a verdict merely because a human reviewed it.

## Fact integrity

`APPLICATION_ACK` qualifies only when `source=APPLICATION`. `RECONCILIATION_REVIEW`, `MANUAL_RESOLUTION` and `EXTERNAL_ASSERTION` are distinct fact kinds. Review and manual-resolution records are excluded from the evidence set that computes business-effect truth.

A reconciliation rerun over the same operational facts produces the same proof hash. The receiver stores a new review revision only when the derived proof changes.

## Manual resolution

A manual-resolution record contains the target verdict, rationale, referenced fact IDs, actor, revision, previous proof hash and new content-derived proof hash. The target must equal the verdict supported by current evidence. Therefore a reviewer cannot convert `UNKNOWN` or `NO_EFFECT_CONFIRMED` into `EFFECT_CONFIRMED` without qualifying application evidence and a valid signed receipt.

## Declared population

Completeness requires a persisted scope manifest. Each revision names expected reporting devices, expected operation IDs and optionally an expected operation count, plus declaration time, provenance and predecessor manifest hash.

The certificate reports observed and missing devices, observed and missing operation IDs, terminal and unknown operation IDs, declaration version and provenance. An unseen declared device or operation prevents completeness. An explicitly empty declared population can be complete; an undeclared population cannot produce a certificate.
