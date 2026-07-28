# Audit records

This directory stores immutable, reviewable audit records keyed by audit ID. An audit record references exact GitHub SHAs, runs, artifacts and preserved evidence; it does not modify implementation code.

Implementation certification requires an independent AUD context. Pre-build governance, incident, authorization and release-readiness audits may be performed before CI when their mission contract does not require a completed run.

Recommended path:

```text
audit/<AUDIT_ID>.yaml
```

Existing Drive audit history remains authoritative during `CANONICAL_MODE=HYBRID` until a dedicated migration audit imports or references it without loss.
