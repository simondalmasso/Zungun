CREATE TABLE IF NOT EXISTS identities (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  pairing_code TEXT NOT NULL UNIQUE CHECK(length(pairing_code) BETWEEN 6 AND 12),
  created_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES identities(user_id),
  created_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, revoked_at_ms);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id TEXT PRIMARY KEY,
  creator_user_id TEXT NOT NULL REFERENCES identities(user_id),
  assignee_user_id TEXT NOT NULL REFERENCES identities(user_id),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK(length(description) <= 1000),
  location_text TEXT CHECK(location_text IS NULL OR length(location_text) <= 240),
  expires_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','COMPLETED','COULD_NOT_COMPLETE','EXPIRED')),
  revision INTEGER NOT NULL DEFAULT 1,
  terminal_note TEXT,
  effect_operation_id TEXT UNIQUE,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS work_orders_assignee_idx ON work_orders(assignee_user_id, status, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS work_orders_creator_idx ON work_orders(creator_user_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS field_operations (
  operation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  work_order_id TEXT NOT NULL REFERENCES work_orders(work_order_id),
  user_id TEXT NOT NULL REFERENCES identities(user_id),
  envelope_hash TEXT NOT NULL,
  message_commitment TEXT NOT NULL,
  replay_nonce TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK(action IN ('COMPLETE','COULD_NOT_COMPLETE')),
  note TEXT,
  expected_revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('RECEIVER_ACCEPTED','COMPLETED','REJECTED')),
  application_outcome TEXT NOT NULL CHECK(application_outcome IN ('EFFECT_APPLIED','NO_EFFECT','REJECTED')),
  receipt_json TEXT,
  accepted_at_ms INTEGER NOT NULL,
  applied_at_ms INTEGER
);
CREATE INDEX IF NOT EXISTS field_operations_work_idx ON field_operations(work_order_id, accepted_at_ms);

CREATE TRIGGER IF NOT EXISTS field_operation_semantic_guard
BEFORE INSERT ON field_operations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.work_order_id = NEW.work_order_id
      AND w.assignee_user_id = NEW.user_id
      AND w.status = 'OPEN'
      AND w.revision = NEW.expected_revision
      AND w.expires_at_ms > NEW.accepted_at_ms
      AND w.effect_operation_id IS NULL
  ) THEN RAISE(ABORT, 'SEMANTIC_REVALIDATION_FAILED') END;
END;

CREATE TRIGGER IF NOT EXISTS field_operation_apply_effect
AFTER INSERT ON field_operations
BEGIN
  UPDATE work_orders SET
    status = CASE NEW.action WHEN 'COMPLETE' THEN 'COMPLETED' ELSE 'COULD_NOT_COMPLETE' END,
    terminal_note = NULLIF(NEW.note, ''),
    effect_operation_id = NEW.operation_id,
    revision = revision + 1,
    updated_at_ms = NEW.applied_at_ms
  WHERE work_order_id = NEW.work_order_id;
END;

CREATE TABLE IF NOT EXISTS proof_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK(subject_type IN ('FIELD','MESSAGE')),
  kind TEXT NOT NULL,
  evidence_class TEXT NOT NULL CHECK(evidence_class IN ('OBSERVED','VERIFIED','INFERRED','MISSING')),
  occurred_at_ms INTEGER NOT NULL,
  reference TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS proof_events_operation_idx ON proof_events(operation_id, id);

CREATE TABLE IF NOT EXISTS receipt_keys (
  key_id TEXT PRIMARY KEY,
  public_key_pem TEXT NOT NULL,
  valid_from_ms INTEGER NOT NULL,
  valid_until_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER
);

CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  member_a TEXT NOT NULL REFERENCES identities(user_id),
  member_b TEXT NOT NULL REFERENCES identities(user_id),
  created_at_ms INTEGER NOT NULL,
  CHECK(member_a < member_b),
  UNIQUE(member_a, member_b)
);
CREATE INDEX IF NOT EXISTS conversations_a_idx ON conversations(member_a, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS conversations_b_idx ON conversations(member_b, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS order083_faults (
  subject_id TEXT PRIMARY KEY,
  fault_type TEXT NOT NULL CHECK(fault_type IN ('DROP_AFTER_DURABLE_ACCEPT')),
  expires_at_ms INTEGER NOT NULL
);
