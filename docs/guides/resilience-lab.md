# Resilience Lab and Blackout Drill

The deterministic resilience suite covers offline/intermittent transport, delay, timeout, duplication, reordering, truncation, process death, reboot, upgrade, clock skew, TTL expiry, storage failure, receiver crash, lease loss, acknowledgement loss, delayed effect, database/ERP mismatch, receipt alteration, stale/revoked keys, reconciliation contradictions, silent declared devices, unauthorized roles, key-store corruption and path traversal.

The integrated Witness Blackout Drill uses temporary real SQLite receivers. Its fixed matrix covers synthetic detection, primary-network loss, alternate store-and-forward custody, sender/receiver restart, duplicate delivery, delayed delivery, out-of-order evidence, ownership without action, action without recheck, conflicting history, expiry without resolution, eventual post-failure reconciliation and unrecoverable `UNKNOWN`.

`npm run test:resilience` writes `.artifacts/resilience/report.json` and a SHA-256 sidecar and fails if either the historical matrix or Blackout Drill has a mismatch. Proof-bundle verification is separately exercised by `npm run verify:witness-bundle`.
