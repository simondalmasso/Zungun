# Exact-head CI binding

This committed record defines the binding rule, not a stale run claim.

The worker-readiness workflow checks out `${{ github.event.pull_request.head.sha || github.sha }}` and asserts `git rev-parse HEAD` equals that exact value. The completion job runs only after worker-adapter, standalone-regressions and android-regression succeed.

On the final candidate, the completion job writes the actual exact HEAD and prerequisite job results into this file in the uploaded `ATM-WORKER-READY-R1` artifact, recomputes `MANIFEST.sha256`, and uploads the bundle. The independent AUD must use that run/artifact plus the final PR HEAD; an earlier green SHA is non-authoritative.
