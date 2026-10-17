# Limitations and non-goals

Zungun is not a network standard, universal exactly-once layer, operator-required profile, production SLA, compliance certification, legal opinion, patentability/freedom-to-operate conclusion, trademark conclusion, or substitute for business-domain authorization.

Witness integrity does not convert attributed claims into physical truth. Zungun cannot prove that a sensor was correct, that radio or satellite coverage existed, that a human performed a physical action, or that a compromised authority was honest. `DELIVERED_DURABLY` proves only the modeled receiver database boundary. `RESOLVED` requires responder evidence after a condition recheck, but remains an attributed evidence claim.

The reference SQLite receiver is suitable for deterministic integration evidence and local operation. Higher-volume production deployments must preserve the same transaction/fencing semantics on appropriately operated infrastructure. Commercial demand and production scale are not established by this repository.
