export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    name: 'initial durable receiver schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operations (
        operation_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        message_commitment TEXT NOT NULL,
        envelope_commitment TEXT NOT NULL,
        work_order_id TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        replay_nonce TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        application_outcome TEXT NOT NULL,
        application_reference TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        cancellation_requested INTEGER NOT NULL DEFAULT 0,
        fencing_token INTEGER NOT NULL DEFAULT 0,
        CHECK (state IN ('QUEUED','RECEIVER_ACCEPTED','CLAIMED','EFFECT_RECORDED','UNKNOWN','COMPLETED','REJECTED','EXPIRED','CANCELLED')),
        CHECK (application_outcome IN ('UNKNOWN','EFFECT_APPLIED','NO_EFFECT','REJECTED'))
      );
      CREATE INDEX IF NOT EXISTS idx_operations_scope ON operations(scope_type, scope_id, created_at_ms);
      CREATE INDEX IF NOT EXISTS idx_operations_state ON operations(state, updated_at_ms);
      CREATE TABLE IF NOT EXISTS attempts (
        attempt_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        status TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        completed_at_ms INTEGER,
        detail TEXT NOT NULL,
        CHECK (status IN ('CLAIMED','SUCCEEDED','FAILED','LEASE_LOST','UNKNOWN'))
      );
      CREATE INDEX IF NOT EXISTS idx_attempts_operation ON attempts(operation_id, started_at_ms);
      CREATE TABLE IF NOT EXISTS leases (
        operation_id TEXT PRIMARY KEY REFERENCES operations(operation_id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        fencing_token INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        reference TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        evidence_sha256 TEXT NOT NULL,
        UNIQUE(operation_id, source, kind, evidence_sha256)
      );
      CREATE INDEX IF NOT EXISTS idx_evidence_operation ON evidence(operation_id, occurred_at_ms, evidence_id);
      CREATE TABLE IF NOT EXISTS receipts (
        receipt_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id) ON DELETE CASCADE,
        key_id TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        signature_base64 TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        issued_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_orders (
        work_order_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        result_json TEXT NOT NULL,
        effect_operation_id TEXT NOT NULL UNIQUE REFERENCES operations(operation_id),
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reconciliation_reviews (
        review_id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        anomalies_json TEXT NOT NULL,
        evidence_fact_ids_json TEXT NOT NULL,
        proof_hash TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(operation_id, revision)
      );
    `,
  },
  {
    version: 2,
    name: 'security audit and replay ledger',
    sql: `
      CREATE TABLE IF NOT EXISTS replay_ledger (
        replay_nonce TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        envelope_commitment TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_audit (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        allowed INTEGER NOT NULL,
        observed_at_ms INTEGER NOT NULL,
        detail TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: 'bounded completeness reporting',
    sql: `
      CREATE TABLE IF NOT EXISTS reporting_devices (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        first_seen_at_ms INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL,
        PRIMARY KEY(scope_type, scope_id, device_id)
      );
    `,
  },
  {
    version: 4,
    name: 'declared scope manifests and immutable manual resolutions',
    sql: `
      CREATE TABLE IF NOT EXISTS scope_manifests (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        declaration_version INTEGER NOT NULL,
        expected_devices_json TEXT NOT NULL,
        expected_operations_json TEXT NOT NULL,
        expected_operation_count INTEGER,
        declared_at_ms INTEGER NOT NULL,
        provenance TEXT NOT NULL,
        previous_manifest_hash TEXT,
        manifest_hash TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL,
        PRIMARY KEY(scope_type, scope_id, declaration_version)
      );
      CREATE INDEX IF NOT EXISTS idx_scope_manifests_latest
        ON scope_manifests(scope_type, scope_id, declaration_version DESC);
      CREATE TABLE IF NOT EXISTS manual_resolutions (
        resolution_id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_id TEXT NOT NULL REFERENCES operations(operation_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        target_verdict TEXT NOT NULL,
        rationale TEXT NOT NULL,
        referenced_fact_ids_json TEXT NOT NULL,
        previous_proof_hash TEXT NOT NULL,
        new_proof_hash TEXT NOT NULL UNIQUE,
        actor_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(operation_id, revision)
      );
      CREATE INDEX IF NOT EXISTS idx_manual_resolution_operation
        ON manual_resolutions(operation_id, revision);
      CREATE INDEX IF NOT EXISTS idx_auth_audit_time ON auth_audit(observed_at_ms, audit_id);
    `,
  },
]);
