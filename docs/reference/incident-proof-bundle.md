# Incident Proof Bundle

`zungun-proof-bundle/1` is a deterministic portable evidence container for one Witness incident. It contains an evidence chain, a human-readable report, verification instructions, and a canonical manifest. Every object has a SHA-256 value and the manifest itself is bound by `manifestSha256`.

Offline verification recomputes the manifest hash, every object hash, incident identity, and the full Witness transition/hash chain. Build the repository and run:

```text
node dist/tools/resilience-lab/src/verify-proof-bundle.js incident-proof-bundle.json
```

An intact bundle exits zero. Modified content, a changed manifest, an invalid chain, invalid redaction metadata, or unsupported schema exits non-zero.

## Redaction and retention

A non-critical object may be replaced by a `zungun-redaction/1` marker carrying its original SHA-256 and a machine-readable reason. The redacted object and new manifest are hashed again. `manifest.json` and `evidence-chain.json` cannot be redacted because independent verification depends on them.

The repository defines integrity behavior, not a universal retention period. Deployments must define retention and deletion according to operational, contractual, privacy, and legal requirements. Deletion of source evidence destroys future proof availability and must not be represented as if the original evidence remained independently verifiable.
