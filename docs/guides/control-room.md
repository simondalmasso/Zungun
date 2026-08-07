# Control Room

Control Room is a backend-connected operational surface. It shows server-paginated operations, ambiguity/reconciliation queues, exact transport/receiver/business-effect state, evidence, attempts, receipts, declared-scope completeness, key lifecycle, and evidence-bound review history.

Operation detail also fetches the persisted Witness chain. Every item displays its state and trust boundary. `UNKNOWN`, `CONFLICT`, and `EXPIRED_WITHOUT_RESOLUTION` are shown as not proved, never as successful resolution. A legacy operation with no Witness evidence is labeled as such.

Evidence export returns a deterministic Incident Proof Bundle when a Witness chain exists. Legacy exports explicitly state that they are not Incident Proof Bundles.
