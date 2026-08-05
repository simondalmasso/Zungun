# Security operations

Production must supply a high-entropy bearer-token or external identity provider, TLS, a persistent database volume, encrypted backups and a KMS/HSM-backed receipt-key provider. Grant signing permission only to the receiver workload. Rotate by publishing a new active key ID while retaining non-revoked verification keys for the receipt validity period. Revoke compromised keys immediately and re-run reconciliation for affected receipts.
