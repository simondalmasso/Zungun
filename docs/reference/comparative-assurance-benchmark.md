# Comparative Delivery Assurance Benchmark

## Purpose

This harness isolates one high-value failure mode: the upstream commits a business effect, but the response is lost and the caller temporarily sees an unknown outcome. It compares retry behavior and evidence boundaries without claiming to emulate a real mobile network.

## Lanes

1. **Direct HTTP without receiver idempotency.** A caller retries after the response is lost. This deliberately weak baseline shows the duplicate-effect hazard when the endpoint has no idempotency contract.
2. **Direct HTTP with receiver idempotency.** The same key is replayed and the receiver returns its stored response. This is a stronger baseline and should not duplicate the business effect.
3. **SQLite durable outbox plus receiver idempotency.** The sender persists each operation and retries the same key after the lost response. Both sender outbox and receiver idempotency ledger use real SQLite in this reference harness. The WorkManager scheduling policy itself is not executed here.
4. **Zungun Link receiver proxy plus reconciliation.** The actual LinkReceiverProxy and SQLite proxy ledger are exercised. A fault injector commits the upstream effect and drops the response; Link records UNKNOWN, queries the receiver, and blocks duplicate replay. A separate integrated Link Blackout Drill verifies one end-to-end Link proof bundle.

## Run

Run **npm run benchmark:assurance** to execute 1,000 operations per lane. An optional smaller trial count is supported with **npm run benchmark:assurance -- 10**.

The runner writes the machine-readable report to **.artifacts/resilience/comparative-assurance-benchmark.json** and a SHA-256 sidecar to **.artifacts/resilience/comparative-assurance-benchmark.sha256**. The GitHub qualification workflow uploads these files as an artifact.

## Interpreting the results

The non-idempotent direct-HTTP model is expected to produce one duplicate business effect per operation under this fault profile. A competent receiver idempotency contract prevents duplicates for both direct retry and the durable outbox. The benchmark therefore does not claim that Zungun is more correct than a correctly implemented outbox.

For this profile, the durable outbox uses two side-effect requests per operation. Zungun uses one side-effect request and one reconciliation query. The total number of calls is equal; Zungun changes the second call from a possible side-effect replay into a read-only query and retains a durable proxy record. The additional integrated Link proof is one verified exemplar, not 1,000 signed proof bundles.

## Explicit limitations

This is a deterministic contract/correctness harness. It does not run Android Room or WorkManager, test process death on a physical device, measure OEM background restrictions, exercise a real cellular or satellite network, or measure latency, throughput, cost savings, production SLA, buyer willingness to pay, or market demand. Those require separate device tests, independently reproducible network experiments, and buyer evidence.
