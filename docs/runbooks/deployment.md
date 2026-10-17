# Deployment, rollback and recovery

Build and scan the receiver image, run migrations against a disposable database, back up production, deploy one instance in read-only readiness mode, then permit claims only after health checks pass. Roll back application binaries without rolling database migrations backward; restore from encrypted backup when a forward-compatible migration cannot be completed. No production cutover is authorized by Order 075.
