import { ZepError } from '../../canary/zep-core-canary/vendor/zep-core/src/errors.js';
import { validateMessage } from '../../canary/zep-core-canary/vendor/zep-core/src/message.js';
import {
  SYNC_MAX_ACK_ITEMS,
  SYNC_MAX_OUTGOING_ITEMS,
  storedFromMessage,
  type MailboxDelivery,
  type MessageRepository,
  type StoredSyncRequest,
} from './model.js';
import { authorizeBearer } from './receipt.js';
import {
  HttpProblem,
  ItemProblem,
  accepted,
  buildBody,
  contentTypeIsJson,
  createCursor,
  encodedBytes,
  mapAckItem,
  mapMessageItem,
  parseJson,
  parseResultArray,
  parseSequenceArray,
  readBoundedBody,
  rejected,
  response,
  sha256Hex,
  validateEnvelope,
  type ItemResult,
  type SyncEnvelope,
} from './sync-wire.js';

export interface SyncBurstServiceOptions {
  readonly now?: () => number;
}

export class SyncBurstService {
  private readonly now: () => number;

  constructor(
    private readonly repository: MessageRepository,
    private readonly token: string,
    options: SyncBurstServiceOptions = {},
  ) {
    if (typeof token !== 'string' || token.length < 32) throw new Error('PILOT_TOKEN_CONFIGURATION_INVALID');
    this.now = options.now ?? Date.now;
  }

  private async processOutgoing(items: readonly unknown[], nowMs: number): Promise<readonly ItemResult[]> {
    const results: ItemResult[] = [];
    for (let index = 0; index < items.length; index += 1) {
      if (index >= SYNC_MAX_OUTGOING_ITEMS) {
        results.push(rejected(index, 'QUOTA_EXCEEDED'));
        continue;
      }
      try {
        const validated = validateMessage(mapMessageItem(items[index]), nowMs);
        if (validated.createdAtMs > nowMs) throw new ItemProblem('MALFORMED_ITEM');
        const candidate = storedFromMessage(validated, await sha256Hex(validated.payload), nowMs);
        const result = await this.repository.createOrGet(candidate);
        results.push(accepted(index, 'ACCEPTED', !result.created));
      } catch (error) {
        if (error instanceof ItemProblem) {
          results.push(rejected(index, error.code));
          continue;
        }
        if (error instanceof ZepError) {
          if (error.code === 'EXPIRED') results.push(rejected(index, 'EXPIRED'));
          else if (error.code === 'PAYLOAD_TOO_LARGE') results.push(rejected(index, 'PAYLOAD_TOO_LARGE'));
          else results.push(rejected(index, 'MALFORMED_ITEM'));
          continue;
        }
        if (error instanceof Error && error.message === 'DUPLICATE_CONFLICT') {
          results.push(rejected(index, 'DUPLICATE_CONFLICT'));
          continue;
        }
        throw error;
      }
    }
    return Object.freeze(results);
  }

  private async processAcks(mailboxId: string, items: readonly unknown[], nowMs: number): Promise<readonly ItemResult[]> {
    const results: ItemResult[] = [];
    for (let index = 0; index < items.length; index += 1) {
      if (index >= SYNC_MAX_ACK_ITEMS) {
        results.push(rejected(index, 'QUOTA_EXCEEDED'));
        continue;
      }
      try {
        const item = mapAckItem(items[index]);
        const result = await this.repository.acknowledgeMailbox(mailboxId, item.messageId, item.messageCommitment, nowMs);
        if (!result.found) results.push(rejected(index, 'MALFORMED_ITEM'));
        else if (result.conflict) results.push(rejected(index, 'DUPLICATE_CONFLICT'));
        else if (result.expired) results.push(rejected(index, 'EXPIRED'));
        else results.push(accepted(index, 'ACKNOWLEDGED', result.idempotent));
      } catch (error) {
        if (error instanceof ItemProblem) {
          results.push(rejected(index, error.code));
          continue;
        }
        throw error;
      }
    }
    return Object.freeze(results);
  }

  private async replay(record: StoredSyncRequest, idempotent: boolean): Promise<Response> {
    const outgoingResults = parseResultArray(record.outgoingResultsJson);
    const ackResults = parseResultArray(record.ackResultsJson);
    const sequences = parseSequenceArray(record.deliverySequencesJson);
    const deliveries = await this.repository.getDeliveriesBySequences(record.mailboxId, sequences);
    if (deliveries.length !== sequences.length || deliveries.some((delivery, index) => delivery.entrySequence !== sequences[index])) {
      throw new Error('CORRUPT_SYNC_REQUEST');
    }
    const body = buildBody(
      record.requestId,
      record.mailboxId,
      outgoingResults,
      ackResults,
      deliveries,
      record.cursorToken,
      record.hasMore,
      idempotent,
    );
    if (encodedBytes(body) > record.maxResponseBytes) throw new Error('CORRUPT_SYNC_REQUEST');
    return response(body);
  }

  private async execute(envelope: SyncEnvelope, requestHash: string): Promise<Response> {
    const prior = await this.repository.getSyncRequest(envelope.mailboxId, envelope.requestId);
    if (prior !== null) {
      if (prior.requestHash !== requestHash) throw new HttpProblem(422, 'INVALID_SYNC_ENVELOPE');
      return this.replay(prior, true);
    }

    let startingSequence = 0;
    if (envelope.cursor !== null) {
      const cursor = await this.repository.resolveCursor(envelope.cursor);
      if (cursor === null || cursor.mailboxId !== envelope.mailboxId) throw new HttpProblem(422, 'INVALID_SYNC_ENVELOPE');
      startingSequence = cursor.entrySequence;
    }

    const nowMs = this.now();
    const outgoingResults = await this.processOutgoing(envelope.outgoingMessages, nowMs);
    const ackResults = await this.processAcks(envelope.mailboxId, envelope.ackMessages, nowMs);
    const candidates = envelope.pullLimit === 0
      ? Object.freeze([] as MailboxDelivery[])
      : await this.repository.pullPending(envelope.mailboxId, startingSequence, nowMs, envelope.pullLimit + 1);
    const eligible = candidates.slice(0, envelope.pullLimit);
    const selected: MailboxDelivery[] = [];
    const placeholderCursor = `sb0_${'A'.repeat(32)}`;
    let stoppedForBytes = false;
    for (const delivery of eligible) {
      const trial = [...selected, delivery];
      const trialBody = buildBody(
        envelope.requestId,
        envelope.mailboxId,
        outgoingResults,
        ackResults,
        trial,
        placeholderCursor,
        false,
        false,
      );
      if (encodedBytes(trialBody) > envelope.maxResponseBytes) {
        stoppedForBytes = true;
        break;
      }
      selected.push(delivery);
    }
    const hasMore = stoppedForBytes || selected.length < eligible.length || candidates.length > envelope.pullLimit;
    const cursorSequence = selected.length === 0 ? startingSequence : selected[selected.length - 1]!.entrySequence;
    const cursorToken = await createCursor(this.repository, envelope.mailboxId, cursorSequence, nowMs);
    const candidateRecord: StoredSyncRequest = Object.freeze({
      mailboxId: envelope.mailboxId,
      requestId: envelope.requestId,
      requestHash,
      cursorToken,
      cursorSequence,
      hasMore,
      outgoingResultsJson: JSON.stringify(outgoingResults),
      ackResultsJson: JSON.stringify(ackResults),
      deliverySequencesJson: JSON.stringify(selected.map((delivery) => delivery.entrySequence)),
      maxResponseBytes: envelope.maxResponseBytes,
      createdAtMs: nowMs,
    });
    const stored = await this.repository.storeSyncRequest(candidateRecord);
    return this.replay(stored.record, !stored.created);
  }

  async handle(request: Request): Promise<Response> {
    try {
      if (!(await authorizeBearer(request.headers.get('authorization'), this.token))) {
        throw new HttpProblem(401, 'UNAUTHORIZED');
      }
      if (!contentTypeIsJson(request)) throw new HttpProblem(415, 'UNSUPPORTED_MEDIA_TYPE');
      const parsed = parseJson(await readBoundedBody(request));
      const envelope = validateEnvelope(parsed);
      return await this.execute(envelope, await sha256Hex(envelope.canonicalRequest));
    } catch (error) {
      if (error instanceof HttpProblem) {
        return response({ ok: false, error: { code: error.code, retryable: false } }, error.status);
      }
      return response({ ok: false, error: { code: 'INTERNAL_ERROR', retryable: false } }, 500);
    }
  }
}
