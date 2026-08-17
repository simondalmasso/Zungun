# Order 076 verification runbook

The completion workflow must establish all of the following on the exact PR head:

1. immutable base ancestry, protected oracle and `candidate/order-072` boundaries;
2. focused regressions plus a detector run against audited head `ba0617d51376617df77dea3d88648c6a2dc87257`;
3. TypeScript format, lint, typecheck, unit/integration tests, cross-process Field Service flow and 26 exact fault-injection scenarios;
4. browser E2E for pagination, global totals, queues, completeness, review, manual resolution and key lifecycle;
5. Android compile, lint, unit tests, sample/external-consumer build, Room migrations, worker instrumentation and emulator restart/recovery flow;
6. independent npm package and AAR reproduction;
7. container read-only smoke and historical canary verification;
8. dependency locks, integrity verification, actual SBOM/licenses, npm/OSV audit and artifact provenance;
9. a completion gate that consumes every job output and artifact digest.

No skipped, neutral or continued-on-error result is accepted as completion evidence.
