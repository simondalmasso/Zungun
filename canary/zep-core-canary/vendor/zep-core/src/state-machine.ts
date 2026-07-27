import { fail } from './errors.js';
import { assertVerifiedEndRecipientReceipt } from './receipts.js';
import { isExpired, validateEpochMs } from './time.js';
import { assertValidatedMessage } from './message.js';
import { requireEnum, requireEpochMs, requireNullableOpaqueId, snapshotExactRecord } from './validation.js';
import type {
  DeliveryState,
  RecipientAcknowledgementRecord,
  TransitionRecord,
  VerifiedEndRecipientReceipt,
  LogicalMessage,
} from './types.js';

export const DELIVERY_STATES: readonly DeliveryState[] = Object.freeze([
  'QUEUED', 'ELIGIBLE', 'SENDING', 'ACCEPTED', 'TEMPORARILY_UNAVAILABLE',
  'UNKNOWN', 'ACKNOWLEDGED', 'PERMANENTLY_REJECTED', 'EXPIRED', 'FAILED',
]);

export const TERMINAL_STATES: readonly DeliveryState[] = Object.freeze([
  'ACKNOWLEDGED', 'PERMANENTLY_REJECTED', 'EXPIRED', 'FAILED',
]);
const terminalStateSet = new Set<DeliveryState>(TERMINAL_STATES);

const transitions = (...states: DeliveryState[]): readonly DeliveryState[] => Object.freeze(states);

export const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED: transitions('ELIGIBLE', 'EXPIRED', 'FAILED'),
  ELIGIBLE: transitions('SENDING', 'TEMPORARILY_UNAVAILABLE', 'PERMANENTLY_REJECTED', 'EXPIRED', 'FAILED'),
  SENDING: transitions('ELIGIBLE', 'ACCEPTED', 'TEMPORARILY_UNAVAILABLE', 'UNKNOWN', 'ACKNOWLEDGED', 'PERMANENTLY_REJECTED', 'EXPIRED', 'FAILED'),
  ACCEPTED: transitions('ACKNOWLEDGED', 'UNKNOWN', 'EXPIRED', 'FAILED'),
  TEMPORARILY_UNAVAILABLE: transitions('ELIGIBLE', 'EXPIRED', 'FAILED'),
  UNKNOWN: transitions('ACKNOWLEDGED', 'ELIGIBLE', 'EXPIRED', 'FAILED'),
  ACKNOWLEDGED: transitions(),
  PERMANENTLY_REJECTED: transitions(),
  EXPIRED: transitions(),
  FAILED: transitions(),
} satisfies Readonly<Record<DeliveryState, readonly DeliveryState[]>>);

export interface TransitionContext {
  readonly atMs: number;
  readonly attemptId?: string | null;
  readonly adapterId?: string | null;
  readonly reasonCode?: string | null;
  readonly evidenceReference?: string | null;
}


function validateTransitionContext(context: TransitionContext): Readonly<Required<TransitionContext>> {
  const record = snapshotExactRecord(
    context,
    ['atMs', 'attemptId', 'adapterId', 'reasonCode', 'evidenceReference'],
    'TransitionContext',
  );
  return Object.freeze({
    atMs: requireEpochMs(record.atMs, 'atMs'),
    attemptId: record.attemptId === undefined ? null : requireNullableOpaqueId(record.attemptId, 'attemptId'),
    adapterId: record.adapterId === undefined ? null : requireNullableOpaqueId(record.adapterId, 'adapterId'),
    reasonCode: record.reasonCode === undefined ? null : requireNullableOpaqueId(record.reasonCode, 'reasonCode'),
    evidenceReference: record.evidenceReference === undefined ? null : requireNullableOpaqueId(record.evidenceReference, 'evidenceReference'),
  });
}

export class DeliveryStateMachine {
  private state: DeliveryState = 'QUEUED';
  private sequence = 0;
  private acknowledgementSequence = 0;
  private effectiveNowMs = 0;
  private readonly records: TransitionRecord[] = [];
  private readonly recipients: readonly string[];
  private readonly acknowledged = new Set<string>();
  private readonly acknowledgementRecords: RecipientAcknowledgementRecord[] = [];
  private readonly boundMessage: LogicalMessage;

  constructor(message: LogicalMessage) {
    assertValidatedMessage(message);
    this.boundMessage = message;
    this.recipients = message.recipientIds;
  }

  get messageId(): string { return this.boundMessage.messageId; }
  get expiresAtMs(): number { return this.boundMessage.expiresAtMs; }

  assertBoundMessage(message: LogicalMessage): void {
    assertValidatedMessage(message);
    if (message !== this.boundMessage) fail('CORRUPT_RECORD', 'DeliveryStateMachine is bound to another LogicalMessage instance');
  }

  current(observedWallClockMs?: number): DeliveryState {
    if (observedWallClockMs !== undefined) this.expire(observedWallClockMs);
    return this.state;
  }

  history(): readonly TransitionRecord[] { return Object.freeze([...this.records]); }
  acknowledgementHistory(): readonly RecipientAcknowledgementRecord[] { return Object.freeze([...this.acknowledgementRecords]); }
  acknowledgedRecipientIds(): readonly string[] { return Object.freeze(this.recipients.filter((id) => this.acknowledged.has(id))); }
  pendingRecipientIds(): readonly string[] { return Object.freeze(this.recipients.filter((id) => !this.acknowledged.has(id))); }
  allRecipientsAcknowledged(): boolean { return this.acknowledged.size === this.recipients.length; }

  recordVerifiedRecipientAcknowledgement(verified: VerifiedEndRecipientReceipt): { newlyAcknowledged: boolean; allAcknowledged: boolean } {
    const receipt = assertVerifiedEndRecipientReceipt(verified, this.boundMessage);
    if (receipt.messageId !== this.messageId) fail('RECEIPT_INVALID', 'Verified receipt targets another message');
    this.effectiveNowMs = Math.max(this.effectiveNowMs, receipt.observedAtMs);
    if (isExpired(this.expiresAtMs, this.effectiveNowMs)) fail('EXPIRED', 'Cannot acknowledge after expiration');
    if (!this.recipients.includes(receipt.recipientId)) fail('RECEIPT_INVALID', 'Receipt recipient is not part of this delivery');
    if (this.acknowledged.has(receipt.recipientId)) return { newlyAcknowledged: false, allAcknowledged: this.allRecipientsAcknowledged() };
    this.acknowledged.add(receipt.recipientId);
    this.acknowledgementRecords.push(Object.freeze({
      sequence: ++this.acknowledgementSequence,
      messageId: this.messageId,
      recipientId: receipt.recipientId,
      atMs: receipt.observedAtMs,
      adapterId: receipt.adapterId,
      receiptId: receipt.receiptId,
    }));
    return { newlyAcknowledged: true, allAcknowledged: this.allRecipientsAcknowledged() };
  }

  transition(toState: DeliveryState, context: TransitionContext): TransitionRecord {
    const normalizedState = requireEnum(toState, 'toState', DELIVERY_STATES);
    const normalizedContext = validateTransitionContext(context);
    this.effectiveNowMs = Math.max(this.effectiveNowMs, normalizedContext.atMs);
    if (normalizedState === 'ACKNOWLEDGED' && !this.allRecipientsAcknowledged()) {
      fail('INVALID_STATE_TRANSITION', 'ACKNOWLEDGED requires every intended recipient acknowledgement');
    }
    if (isExpired(this.expiresAtMs, this.effectiveNowMs) && this.state !== 'EXPIRED' && !terminalStateSet.has(this.state)) {
      if (normalizedState !== 'EXPIRED') fail('EXPIRED', 'Expired messages may only transition to EXPIRED');
    }
    if (!ALLOWED_TRANSITIONS[this.state].includes(normalizedState)) {
      fail('INVALID_STATE_TRANSITION', `${this.state} -> ${normalizedState} is forbidden`);
    }
    const record: TransitionRecord = Object.freeze({
      sequence: ++this.sequence,
      messageId: this.messageId,
      fromState: this.state,
      toState: normalizedState,
      atMs: this.effectiveNowMs,
      attemptId: normalizedContext.attemptId,
      adapterId: normalizedContext.adapterId,
      reasonCode: normalizedContext.reasonCode,
      evidenceReference: normalizedContext.evidenceReference,
    });
    this.records.push(record);
    this.state = toState;
    return record;
  }

  expire(observedWallClockMs: number): boolean {
    validateEpochMs(observedWallClockMs, 'observedWallClockMs');
    this.effectiveNowMs = Math.max(this.effectiveNowMs, observedWallClockMs);
    if (isExpired(this.expiresAtMs, this.effectiveNowMs) && !terminalStateSet.has(this.state)) {
      this.transition('EXPIRED', { atMs: this.effectiveNowMs, reasonCode: 'EXPIRED' });
      return true;
    }
    return this.state === 'EXPIRED';
  }
}
