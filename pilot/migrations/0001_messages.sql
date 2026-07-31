PRAGMA foreign_keys = ON;

CREATE TABLE messages (
  message_id TEXT PRIMARY KEY NOT NULL,
  message_commitment TEXT NOT NULL,
  zep_version TEXT NOT NULL CHECK (zep_version = '0.1'),
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  recipients_json TEXT NOT NULL CHECK (json_valid(recipients_json)),
  content_type TEXT NOT NULL,
  payload_blob BLOB NOT NULL CHECK (length(payload_blob) <= 48000),
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 3),
  receipt_policy TEXT NOT NULL CHECK (receipt_policy = 'END_RECIPIENT_ACK'),
  extensions_json TEXT NULL CHECK (extensions_json IS NULL OR json_valid(extensions_json)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > created_at_ms),
  status TEXT NOT NULL CHECK (status IN ('STORED', 'ACKNOWLEDGED')),
  stored_at_ms INTEGER NOT NULL CHECK (stored_at_ms >= created_at_ms AND stored_at_ms < expires_at_ms),
  acknowledged_at_ms INTEGER NULL,
  processing_receipt_id TEXT NULL UNIQUE,
  processing_receipt_json TEXT NULL CHECK (processing_receipt_json IS NULL OR json_valid(processing_receipt_json)),
  CHECK (
    (status = 'STORED' AND acknowledged_at_ms IS NULL AND processing_receipt_id IS NULL AND processing_receipt_json IS NULL)
    OR
    (status = 'ACKNOWLEDGED' AND acknowledged_at_ms IS NOT NULL AND acknowledged_at_ms < expires_at_ms AND processing_receipt_id IS NOT NULL AND processing_receipt_json IS NOT NULL)
  )
) STRICT;

CREATE INDEX messages_status_expires_idx ON messages(status, expires_at_ms);
CREATE INDEX messages_commitment_idx ON messages(message_commitment);


CREATE TABLE pilot_internal_keys (
  key_name TEXT PRIMARY KEY NOT NULL CHECK (key_name = 'receipt_hmac_v0'),
  key_blob BLOB NOT NULL CHECK (length(key_blob) = 32),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
) STRICT;
