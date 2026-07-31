import type { D1Database, D1PreparedStatement, D1Result, D1Value } from './d1-types.js';
import {
  cloneStored,
  sameImmutableMessage,
  type AcknowledgeResult,
  type CreateResult,
  type MessageRepository,
  type StoredMessage,
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

const SELECT_COLUMNS = `
  message_id, message_commitment, zep_version, conversation_id, sender_id,
  recipients_json, content_type, payload_blob, payload_sha256, priority,
  receipt_policy, extensions_json, created_at_ms, expires_at_ms, status,
  stored_at_ms, acknowledged_at_ms, processing_receipt_id, processing_receipt_json
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
    return Object.freeze({ record, created: result.meta.changes === 1 });
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
}
