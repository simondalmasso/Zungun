PRAGMA foreign_keys = ON;

CREATE TABLE mailbox_deliveries (
  entry_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox_id TEXT NOT NULL,
  message_id TEXT NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  enqueued_at_ms INTEGER NOT NULL CHECK (enqueued_at_ms >= 0),
  acknowledged_at_ms INTEGER NULL CHECK (acknowledged_at_ms IS NULL OR acknowledged_at_ms >= enqueued_at_ms),
  UNIQUE (mailbox_id, message_id)
) STRICT;

CREATE INDEX mailbox_deliveries_pull_idx
  ON mailbox_deliveries(mailbox_id, acknowledged_at_ms, entry_sequence);

INSERT OR IGNORE INTO mailbox_deliveries (mailbox_id, message_id, enqueued_at_ms, acknowledged_at_ms)
SELECT CAST(json_each.value AS TEXT), messages.message_id, messages.stored_at_ms, NULL
FROM messages, json_each(messages.recipients_json);

CREATE TABLE sync_cursors (
  cursor_token TEXT PRIMARY KEY NOT NULL,
  mailbox_id TEXT NOT NULL,
  entry_sequence INTEGER NOT NULL CHECK (entry_sequence >= 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
) STRICT;

CREATE INDEX sync_cursors_mailbox_idx
  ON sync_cursors(mailbox_id, created_at_ms);

CREATE TABLE sync_requests (
  mailbox_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  cursor_token TEXT NOT NULL REFERENCES sync_cursors(cursor_token),
  cursor_sequence INTEGER NOT NULL CHECK (cursor_sequence >= 0),
  has_more INTEGER NOT NULL CHECK (has_more IN (0, 1)),
  outgoing_results_json TEXT NOT NULL CHECK (json_valid(outgoing_results_json)),
  ack_results_json TEXT NOT NULL CHECK (json_valid(ack_results_json)),
  delivery_sequences_json TEXT NOT NULL CHECK (json_valid(delivery_sequences_json)),
  max_response_bytes INTEGER NOT NULL CHECK (max_response_bytes BETWEEN 512 AND 65536),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (mailbox_id, request_id)
) STRICT;

CREATE INDEX sync_requests_created_idx
  ON sync_requests(created_at_ms);
