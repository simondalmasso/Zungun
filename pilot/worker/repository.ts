import type { D1Database } from './d1-types.js';
import {
  cloneStored,
  sameImmutableMessage,
  type AcknowledgeResult,
  type CreateResult,
  type CursorRecord,
  type MailboxAcknowledgeResult,
  type MailboxDelivery,
  type MessageRepository,
  type StoredMessage,
  type StoredSyncRequest,
  type StoreSyncRequestResult,
} from './model.js';

interface MessageRow {
  readonly message_id: string;
  readonly message_commitment: string;
  readonly zep_version: string;
  readonly conversation_id: string;
  readonly sender_id: string;
  readonly recipients_json: string;
  readonly content_type: string;
  readonly payload_blob: readonly number[];
  readonly payload_sha256: string;
  readonly priority: number;
  readonly receipt_policy: string;
  readonly extensions_json: string | null;
  readonly created_at_ms: number;
  readonly expires_at_ms: number;
  readonly status: string;
  readonly stored_at_ms: number;
  readonly acknowledged_at_ms: number | null;
  readonly processing_receipt_id: string | null;
  readonly processing_receipt_json: string | null;
}

interface DeliveryRow extends MessageRow {
  readonly entry_sequence: number;
  readonly mailbox_id: string;
  readonly delivery_acknowledged_at_ms: number | null;
}

interface CursorRow {
  readonly mailbox_id: string;
  readonly entry_sequence: number;
}

interface SyncRequestRow {
  readonly mailbox_id: string;
  readonly request_id: string;
  readonly request_hash: string;
  readonly cursor_token: string;
  readonly cursor_sequence: number;
  readonly has_more: number;
  readonly outgoing_results_json: string;
  readonly ack_results_json: string;
  readonly delivery_sequences_json: string;
  readonly max_response_bytes: number;
  readonly created_at_ms: number;
}

const SELECT_COLUMNS = `
  message_id, message_commitment, zep_version, conversation_id, sender_id,
  recipients_json, content_type, payload_blob, payload_sha256, priority,
  receipt_policy, extensions_json, created_at_ms, expires_at_ms, status,
  stored_at_ms, acknowledged_at_ms, processing_receipt_id, processing_receipt_json
`;

const DELIVERY_SELECT_COLUMNS = `
  d.entry_sequence, d.mailbox_id, d.acknowledged_at_ms AS delivery_acknowledged_at_ms,
  m.message_id, m.message_commitment, m.zep_version, m.conversation_id, m.sender_id,
  m.recipients_json, m.content_type, m.payload_blob, m.payload_sha256, m.priority,
  m.receipt_policy, m.extensions_json, m.created_at_ms, m.expires_at_ms, m.status,
  m.stored_at_ms, m.acknowledged_at_ms, m.processing_receipt_id, m.processing_receipt_json
`;

function asStored(row: MessageRow): StoredMessage {
  const recipients = JSON.parse(row.recipients_json) as unknown;
  if (!Array.isArray(recipients) || !recipients.every((value) => typeof value === 'string')) {
    throw new Error('CORRUPT_STORED_MESSAGE');
  }
  if (!Array.isArray(row.payload_blob) || !row.payload_blob.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    throw new Error('CORRUPT_STORED_MESSAGE');
  }
  if (
    row.zep_version !== '0.1'
    || ![0, 1, 2, 3].includes(row.priority)
    || row.receipt_policy !== 'END_RECIPIENT_ACK'
    || (row.status !== 'STORED' && row.status !== 'ACKNOWLEDGED')
  ) throw new Error('CORRUPT_STORED_MESSAGE');
  return cloneStored({
    messageId: row.message_id,
    messageCommitment: row.message_commitment,
    zepVersion: '0.1',
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    recipientIds: recipients,
    contentType: row.content_type,
    payload: Uint8Array.from(row.payload_blob),
    payloadSha256: row.payload_sha256,
    priority: row.priority as 0 | 1 | 2 | 3,
    receiptPolicy: 'END_RECIPIENT_ACK',
    extensionsJson: row.extensions_json,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    status: row.status,
    storedAtMs: row.stored_at_ms,
    acknowledgedAtMs: row.acknowledged_at_ms,
    processingReceiptId: row.processing_receipt_id,
    processingReceiptJson: row.processing_receipt_json,
  });
}

function asDelivery(row: DeliveryRow): MailboxDelivery {
  if (!Number.isSafeInteger(row.entry_sequence) || row.entry_sequence < 1 || typeof row.mailbox_id !== 'string') {
    throw new Error('CORRUPT_MAILBOX_DELIVERY');
  }
  return Object.freeze({
    entrySequence: row.entry_sequence,
    mailboxId: row.mailbox_id,
    acknowledgedAtMs: row.delivery_acknowledged_at_ms,
    message: asStored(row),
  });
}

function asSyncRequest(row: SyncRequestRow): StoredSyncRequest {
  if (
    row.has_more !== 0 && row.has_more !== 1
    || !Number.isSafeInteger(row.cursor_sequence) || row.cursor_sequence < 0
    || !Number.isSafeInteger(row.max_response_bytes) || row.max_response_bytes < 1
  ) throw new Error('CORRUPT_SYNC_REQUEST');
  return Object.freeze({
    mailboxId: row.mailbox_id,
    requestId: row.request_id,
    requestHash: row.request_hash,
    cursorToken: row.cursor_token,
    cursorSequence: row.cursor_sequence,
    hasMore: row.has_more === 1,
    outgoingResultsJson: row.outgoing_results_json,
    ackResultsJson: row.ack_results_json,
    deliverySequencesJson: row.delivery_sequences_json,
    maxResponseBytes: row.max_response_bytes,
    createdAtMs: row.created_at_ms,
  });
}

function payloadBuffer(payload: Uint8Array): ArrayBuffer {
  return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
}

export class D1MessageRepository implements MessageRepository {
  constructor(private readonly db: D1Database) {}

  private async select(messageId: string): Promise<StoredMessage | null> {
    const row = await this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM messages WHERE message_id = ?1 LIMIT 1`)
      .bind(messageId)
      .first<MessageRow>();
    return row === null ? null : asStored(row);
  }

  private async ensureDeliveries(record: StoredMessage): Promise<void> {
    if (record.recipientIds.length === 0) return;
    const statements = record.recipientIds.map((mailboxId) => this.db.prepare(`
      INSERT INTO mailbox_deliveries (mailbox_id, message_id, enqueued_at_ms, acknowledged_at_ms)
      VALUES (?1, ?2, ?3, NULL)
      ON CONFLICT(mailbox_id, message_id) DO NOTHING
    `).bind(mailboxId, record.messageId, record.storedAtMs));
    const results = await this.db.batch(statements);
    if (results.some((result) => !result.success)) throw new Error('D1_DELIVERY_CREATE_FAILED');
  }

  async createOrGet(candidate: StoredMessage): Promise<CreateResult> {
    const result = await this.db.prepare(`
      INSERT INTO messages (
        message_id, message_commitment, zep_version, conversation_id, sender_id,
        recipients_json, content_type, payload_blob, payload_sha256, priority,
        receipt_policy, extensions_json, created_at_ms, expires_at_ms, status,
        stored_at_ms, acknowledged_at_ms, processing_receipt_id, processing_receipt_json
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
        ?11, ?12, ?13, ?14, 'STORED', ?15, NULL, NULL, NULL
      ) ON CONFLICT(message_id) DO NOTHING
    `).bind(
      candidate.messageId,
      candidate.messageCommitment,
      candidate.zepVersion,
      candidate.conversationId,
      candidate.senderId,
      JSON.stringify(candidate.recipientIds),
      candidate.contentType,
      payloadBuffer(candidate.payload),
      candidate.payloadSha256,
      candidate.priority,
      candidate.receiptPolicy,
      candidate.extensionsJson,
      candidate.createdAtMs,
      candidate.expiresAtMs,
      candidate.storedAtMs,
    ).run();
    if (!result.success) throw new Error('D1_CREATE_FAILED');
    const record = await this.select(candidate.messageId);
    if (record === null) throw new Error('D1_CREATE_NOT_OBSERVABLE');
    if (!sameImmutableMessage(record, candidate)) throw new Error('DUPLICATE_CONFLICT');
    await this.ensureDeliveries(record);
    return Object.freeze({ record, created: (result.meta.changes ?? 0) === 1 });
  }

  get(messageId: string): Promise<StoredMessage | null> {
    return this.select(messageId);
  }

  async getOrCreateReceiptSigningKey(createdAtMs: number): Promise<Uint8Array> {
    const candidate = crypto.getRandomValues(new Uint8Array(32));
    const inserted = await this.db.prepare(`
      INSERT INTO pilot_internal_keys (key_name, key_blob, created_at_ms)
      VALUES ('receipt_hmac_v0', ?1, ?2)
      ON CONFLICT(key_name) DO NOTHING
    `).bind(payloadBuffer(candidate), createdAtMs).run();
    if (!inserted.success) throw new Error('D1_KEY_CREATE_FAILED');
    const row = await this.db.prepare(`SELECT key_blob FROM pilot_internal_keys WHERE key_name = 'receipt_hmac_v0' LIMIT 1`)
      .first<{ readonly key_blob: readonly number[] }>();
    if (row === null || !Array.isArray(row.key_blob) || row.key_blob.length !== 32 || !row.key_blob.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      throw new Error('D1_KEY_CORRUPT');
    }
    return Uint8Array.from(row.key_blob);
  }

  async acknowledge(
    messageId: string,
    messageCommitment: string,
    acknowledgedAtMs: number,
    processingReceiptId: string,
    processingReceiptJson: string,
  ): Promise<AcknowledgeResult | null> {
    const updated = await this.db.prepare(`
      UPDATE messages
      SET status = 'ACKNOWLEDGED',
          acknowledged_at_ms = ?1,
          processing_receipt_id = ?2,
          processing_receipt_json = ?3
      WHERE message_id = ?4
        AND message_commitment = ?5
        AND status = 'STORED'
        AND expires_at_ms > ?1
      RETURNING ${SELECT_COLUMNS}
    `).bind(
      acknowledgedAtMs,
      processingReceiptId,
      processingReceiptJson,
      messageId,
      messageCommitment,
    ).first<MessageRow>();
    if (updated !== null) return Object.freeze({ record: asStored(updated), transitioned: true });
    const existing = await this.select(messageId);
    if (existing === null) return null;
    return Object.freeze({ record: existing, transitioned: false });
  }

  async resolveCursor(cursorToken: string): Promise<CursorRecord | null> {
    const row = await this.db.prepare(`SELECT mailbox_id, entry_sequence FROM sync_cursors WHERE cursor_token = ?1 LIMIT 1`)
      .bind(cursorToken)
      .first<CursorRow>();
    if (row === null) return null;
    if (!Number.isSafeInteger(row.entry_sequence) || row.entry_sequence < 0) throw new Error('CORRUPT_SYNC_CURSOR');
    return Object.freeze({ mailboxId: row.mailbox_id, entrySequence: row.entry_sequence });
  }

  async storeCursor(cursorToken: string, mailboxId: string, entrySequence: number, createdAtMs: number): Promise<void> {
    const result = await this.db.prepare(`
      INSERT INTO sync_cursors (cursor_token, mailbox_id, entry_sequence, created_at_ms)
      VALUES (?1, ?2, ?3, ?4)
    `).bind(cursorToken, mailboxId, entrySequence, createdAtMs).run();
    if (!result.success || (result.meta.changes ?? 0) !== 1) throw new Error('D1_CURSOR_CREATE_FAILED');
  }

  async pullPending(mailboxId: string, afterSequence: number, nowMs: number, limit: number): Promise<readonly MailboxDelivery[]> {
    const result = await this.db.prepare(`
      SELECT ${DELIVERY_SELECT_COLUMNS}
      FROM mailbox_deliveries d
      JOIN messages m ON m.message_id = d.message_id
      WHERE d.mailbox_id = ?1
        AND d.entry_sequence > ?2
        AND d.acknowledged_at_ms IS NULL
        AND m.expires_at_ms > ?3
      ORDER BY d.entry_sequence ASC
      LIMIT ?4
    `).bind(mailboxId, afterSequence, nowMs, limit).run<DeliveryRow>();
    if (!result.success) throw new Error('D1_PULL_FAILED');
    return Object.freeze(result.results.map(asDelivery));
  }

  async getDeliveriesBySequences(mailboxId: string, entrySequences: readonly number[]): Promise<readonly MailboxDelivery[]> {
    if (entrySequences.length === 0) return Object.freeze([]);
    const placeholders = entrySequences.map((_, index) => `?${index + 2}`).join(', ');
    const result = await this.db.prepare(`
      SELECT ${DELIVERY_SELECT_COLUMNS}
      FROM mailbox_deliveries d
      JOIN messages m ON m.message_id = d.message_id
      WHERE d.mailbox_id = ?1 AND d.entry_sequence IN (${placeholders})
      ORDER BY d.entry_sequence ASC
    `).bind(mailboxId, ...entrySequences).run<DeliveryRow>();
    if (!result.success) throw new Error('D1_REPLAY_PULL_FAILED');
    return Object.freeze(result.results.map(asDelivery));
  }

  async acknowledgeMailbox(
    mailboxId: string,
    messageId: string,
    messageCommitment: string,
    acknowledgedAtMs: number,
  ): Promise<MailboxAcknowledgeResult> {
    const current = await this.db.prepare(`
      SELECT d.acknowledged_at_ms AS delivery_acknowledged_at_ms,
             m.message_commitment,
             m.expires_at_ms
      FROM mailbox_deliveries d
      JOIN messages m ON m.message_id = d.message_id
      WHERE d.mailbox_id = ?1 AND d.message_id = ?2
      LIMIT 1
    `).bind(mailboxId, messageId).first<{
      readonly delivery_acknowledged_at_ms: number | null;
      readonly message_commitment: string;
      readonly expires_at_ms: number;
    }>();
    if (current === null) return Object.freeze({ found: false, idempotent: false, conflict: false, expired: false });
    if (current.message_commitment !== messageCommitment) return Object.freeze({ found: true, idempotent: false, conflict: true, expired: false });
    if (current.expires_at_ms <= acknowledgedAtMs) return Object.freeze({ found: true, idempotent: false, conflict: false, expired: true });
    if (current.delivery_acknowledged_at_ms !== null) return Object.freeze({ found: true, idempotent: true, conflict: false, expired: false });
    const updated = await this.db.prepare(`
      UPDATE mailbox_deliveries
      SET acknowledged_at_ms = ?1
      WHERE mailbox_id = ?2 AND message_id = ?3 AND acknowledged_at_ms IS NULL
    `).bind(acknowledgedAtMs, mailboxId, messageId).run();
    if (!updated.success) throw new Error('D1_MAILBOX_ACK_FAILED');
    return Object.freeze({ found: true, idempotent: (updated.meta.changes ?? 0) !== 1, conflict: false, expired: false });
  }

  async getSyncRequest(mailboxId: string, requestId: string): Promise<StoredSyncRequest | null> {
    const row = await this.db.prepare(`
      SELECT mailbox_id, request_id, request_hash, cursor_token, cursor_sequence, has_more,
             outgoing_results_json, ack_results_json, delivery_sequences_json, max_response_bytes, created_at_ms
      FROM sync_requests
      WHERE mailbox_id = ?1 AND request_id = ?2
      LIMIT 1
    `).bind(mailboxId, requestId).first<SyncRequestRow>();
    return row === null ? null : asSyncRequest(row);
  }

  async storeSyncRequest(candidate: StoredSyncRequest): Promise<StoreSyncRequestResult> {
    const inserted = await this.db.prepare(`
      INSERT INTO sync_requests (
        mailbox_id, request_id, request_hash, cursor_token, cursor_sequence, has_more,
        outgoing_results_json, ack_results_json, delivery_sequences_json, max_response_bytes, created_at_ms
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(mailbox_id, request_id) DO NOTHING
    `).bind(
      candidate.mailboxId,
      candidate.requestId,
      candidate.requestHash,
      candidate.cursorToken,
      candidate.cursorSequence,
      candidate.hasMore ? 1 : 0,
      candidate.outgoingResultsJson,
      candidate.ackResultsJson,
      candidate.deliverySequencesJson,
      candidate.maxResponseBytes,
      candidate.createdAtMs,
    ).run();
    if (!inserted.success) throw new Error('D1_SYNC_REQUEST_CREATE_FAILED');
    const record = await this.getSyncRequest(candidate.mailboxId, candidate.requestId);
    if (record === null) throw new Error('D1_SYNC_REQUEST_NOT_OBSERVABLE');
    if (record.requestHash !== candidate.requestHash) throw new Error('SYNC_REQUEST_CONFLICT');
    return Object.freeze({ record, created: (inserted.meta.changes ?? 0) === 1 });
  }
}
