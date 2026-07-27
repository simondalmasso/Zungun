import { fail, ZepError } from './errors.js';
import { validateFragment } from './fragments.js';
import { validateReceiptShape } from './receipts.js';
import {
  requireBoolean,
  requireEnum,
  requireEpochMs,
  requireNonNegativeSafeInteger,
  requireOpaqueId,
  requireOptionalOpaqueId,
  requirePlainRecord,
  requirePositiveSafeInteger,
  requireReasonCode,
  snapshotExactRecord,
} from './validation.js';
import type {
  AdapterContext,
  AttemptContext,
  CancelResult,
  Eligibility,
  Fragment,
  ReceiveBatch,
  ReceiveContext,
  ReceivedItem,
  SendResult,
  TransportAdapter,
  TransportAvailability,
  TransportCapabilities,
  TransportStatus,
} from './types.js';

const ELIGIBILITY: readonly Eligibility[] = ['ALLOWED', 'DENIED', 'UNKNOWN'];
const AVAILABILITY: readonly TransportAvailability[] = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN'];
const ADAPTER_METHODS = ['capabilities', 'status', 'send', 'receive', 'cancel'] as const;

function requireTransportAdapter(value: unknown): TransportAdapter {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    fail('CORRUPT_RECORD', 'TransportAdapter must be an object');
  }
  for (const method of ADAPTER_METHODS) {
    let candidate: unknown;
    try {
      candidate = (value as Record<string, unknown>)[method];
    } catch {
      fail('CORRUPT_RECORD', `TransportAdapter.${method} cannot be inspected safely`);
    }
    if (typeof candidate !== 'function') fail('CORRUPT_RECORD', `TransportAdapter.${method} must be a function`);
  }
  return value as TransportAdapter;
}

async function invokeAdapter<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ZepError) throw error;
    fail('TEMPORARY_UNAVAILABLE', `TransportAdapter ${operation} failed`, true);
  }
}

export function validateTransportCapabilities(input: TransportCapabilities): TransportCapabilities {
  const record = snapshotExactRecord(input, ['adapterId','adapterVersion','maximumPayloadBytes','supportsBinary','supportsFragmentation','supportsTransportReceipt','supportsEndRecipientReceipt','supportsCancel','supportsBackground','supportsStoreAndForward','requiresUserPresence','requiresExternalHardware','requiresOperatorEntitlement','availabilityClass','expectedLatencyClass','estimatedCompletionDurationMs','monetaryCostClass','energyCostClass','privacyMetadataClass','currentEligibility','duplicateSafe'], 'TransportCapabilities');
  const adapterId = requireOpaqueId(record.adapterId, 'adapterId');
  const adapterVersion = requireOpaqueId(record.adapterVersion, 'adapterVersion');
  const maximumPayloadBytes = requirePositiveSafeInteger(record.maximumPayloadBytes, 'maximumPayloadBytes');
  const supportsBinary = requireBoolean(record.supportsBinary, 'supportsBinary');
  const supportsFragmentation = requireBoolean(record.supportsFragmentation, 'supportsFragmentation');
  const supportsTransportReceipt = requireBoolean(record.supportsTransportReceipt, 'supportsTransportReceipt');
  const supportsEndRecipientReceipt = requireBoolean(record.supportsEndRecipientReceipt, 'supportsEndRecipientReceipt');
  const supportsCancel = requireBoolean(record.supportsCancel, 'supportsCancel');
  const supportsBackground = requireBoolean(record.supportsBackground, 'supportsBackground');
  const supportsStoreAndForward = requireBoolean(record.supportsStoreAndForward, 'supportsStoreAndForward');
  const requiresUserPresence = requireBoolean(record.requiresUserPresence, 'requiresUserPresence');
  const requiresExternalHardware = requireBoolean(record.requiresExternalHardware, 'requiresExternalHardware');
  const requiresOperatorEntitlement = requireBoolean(record.requiresOperatorEntitlement, 'requiresOperatorEntitlement');
  const availabilityClass = requireNonNegativeSafeInteger(record.availabilityClass, 'availabilityClass');
  const expectedLatencyClass = requireNonNegativeSafeInteger(record.expectedLatencyClass, 'expectedLatencyClass');
  const estimatedCompletionDurationMs = requireNonNegativeSafeInteger(record.estimatedCompletionDurationMs, 'estimatedCompletionDurationMs');
  const monetaryCostClass = requireNonNegativeSafeInteger(record.monetaryCostClass, 'monetaryCostClass');
  const energyCostClass = requireNonNegativeSafeInteger(record.energyCostClass, 'energyCostClass');
  const privacyMetadataClass = requireNonNegativeSafeInteger(record.privacyMetadataClass, 'privacyMetadataClass');
  const currentEligibility = requireEnum(record.currentEligibility, 'currentEligibility', ELIGIBILITY);
  const duplicateSafe = requireBoolean(record.duplicateSafe, 'duplicateSafe');
  return Object.freeze({ adapterId, adapterVersion, maximumPayloadBytes, supportsBinary, supportsFragmentation, supportsTransportReceipt, supportsEndRecipientReceipt, supportsCancel, supportsBackground, supportsStoreAndForward, requiresUserPresence, requiresExternalHardware, requiresOperatorEntitlement, availabilityClass, expectedLatencyClass, estimatedCompletionDurationMs, monetaryCostClass, energyCostClass, privacyMetadataClass, currentEligibility, duplicateSafe });
}

export function validateTransportStatus(input: TransportStatus): TransportStatus {
  const record = snapshotExactRecord(input, ['adapterId','observedAtMs','availability','currentEligibility','reasonCode','estimatedReadyAtMs'], 'TransportStatus');
  const adapterId = requireOpaqueId(record.adapterId, 'adapterId');
  const observedAtMs = requireEpochMs(record.observedAtMs, 'observedAtMs');
  const availability = requireEnum(record.availability, 'availability', AVAILABILITY);
  const currentEligibility = requireEnum(record.currentEligibility, 'currentEligibility', ELIGIBILITY);
  const reasonCode = record.reasonCode === undefined ? undefined : requireReasonCode(record.reasonCode);
  const estimatedReadyAtMs = record.estimatedReadyAtMs === undefined ? undefined : requireEpochMs(record.estimatedReadyAtMs, 'estimatedReadyAtMs');
  return Object.freeze({ adapterId, observedAtMs, availability, currentEligibility, ...(reasonCode === undefined ? {} : { reasonCode }), ...(estimatedReadyAtMs === undefined ? {} : { estimatedReadyAtMs }) });
}

export function validateSendResult(input: SendResult): SendResult {
  const base = requirePlainRecord(input, 'SendResult');
  let kind: unknown;
  try { kind = base.kind; } catch { fail('CORRUPT_RECORD', 'SendResult.kind cannot be inspected safely'); }
  switch (kind) {
    case 'accepted': {
      const record = snapshotExactRecord(input, ['kind','acceptedAtMs','externalReference','receiptExpectation'], 'SendResult.accepted');
      const acceptedAtMs = requireEpochMs(record.acceptedAtMs, 'acceptedAtMs');
      const externalReference = requireOptionalOpaqueId(record.externalReference, 'externalReference');
      const receiptExpectation = requireOptionalOpaqueId(record.receiptExpectation, 'receiptExpectation');
      return Object.freeze({ kind: 'accepted', acceptedAtMs, ...(externalReference === undefined ? {} : { externalReference }), ...(receiptExpectation === undefined ? {} : { receiptExpectation }) });
    }
    case 'temporarilyUnavailable': {
      const record = snapshotExactRecord(input, ['kind','reasonCode','retryAfterMs'], 'SendResult.temporarilyUnavailable');
      const reasonCode = requireReasonCode(record.reasonCode);
      const retryAfterMs = record.retryAfterMs === undefined ? undefined : requireNonNegativeSafeInteger(record.retryAfterMs, 'retryAfterMs');
      return Object.freeze({ kind: 'temporarilyUnavailable', reasonCode, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
    }
    case 'permanentlyRejected': {
      const record = snapshotExactRecord(input, ['kind','reasonCode'], 'SendResult.permanentlyRejected');
      return Object.freeze({ kind: 'permanentlyRejected', reasonCode: requireReasonCode(record.reasonCode) });
    }
    case 'acknowledged': {
      const record = snapshotExactRecord(input, ['kind','receipt'], 'SendResult.acknowledged');
      return Object.freeze({ kind: 'acknowledged', receipt: validateReceiptShape(record.receipt as never) });
    }
    case 'unknown': {
      const record = snapshotExactRecord(input, ['kind','reasonCode','externalReference'], 'SendResult.unknown');
      const reasonCode = requireReasonCode(record.reasonCode);
      const externalReference = requireOptionalOpaqueId(record.externalReference, 'externalReference');
      return Object.freeze({ kind: 'unknown', reasonCode, ...(externalReference === undefined ? {} : { externalReference }) });
    }
    default:
      fail('CORRUPT_RECORD', 'Unknown SendResult kind');
  }
}


function snapshotItemsArray(value: unknown): readonly unknown[] {
  let isArray = false;
  try { isArray = Array.isArray(value); } catch { fail('CORRUPT_RECORD', 'items cannot be inspected safely'); }
  if (!isArray) fail('CORRUPT_RECORD', 'items must be an array');
  try { return Object.freeze(Array.from(value as readonly unknown[])); }
  catch { fail('CORRUPT_RECORD', 'items cannot be inspected safely'); }
}

function validateReceivedItem(item: ReceivedItem): ReceivedItem {
  const base = requirePlainRecord(item, 'ReceivedItem');
  let kind: unknown;
  try { kind = base.kind; } catch { fail('CORRUPT_RECORD', 'ReceivedItem.kind cannot be inspected safely'); }
  if (kind === 'fragment') {
    const record = snapshotExactRecord(item, ['kind','fragment'], 'ReceivedItem.fragment');
    return Object.freeze({ kind: 'fragment', fragment: validateFragment(record.fragment as never) });
  }
  if (kind === 'receipt') {
    const record = snapshotExactRecord(item, ['kind','receipt'], 'ReceivedItem.receipt');
    return Object.freeze({ kind: 'receipt', receipt: validateReceiptShape(record.receipt as never) });
  }
  fail('CORRUPT_RECORD', 'Unknown ReceivedItem kind');
}

export function validateReceiveBatch(input: ReceiveBatch): ReceiveBatch {
  const record = snapshotExactRecord(input, ['cursor','items','observedAtMs','hasMore'], 'ReceiveBatch');
  const cursor = record.cursor === null ? null : requireOpaqueId(record.cursor, 'cursor');
  const itemValues = snapshotItemsArray(record.items);
  const observedAtMs = requireEpochMs(record.observedAtMs, 'observedAtMs');
  const hasMore = requireBoolean(record.hasMore, 'hasMore');
  if (hasMore && cursor === null) fail('CORRUPT_RECORD', 'ReceiveBatch with hasMore=true requires a continuation cursor');
  return Object.freeze({ cursor, items: Object.freeze(itemValues.map((item) => validateReceivedItem(item as never))), observedAtMs, hasMore });
}

export function validateCancelResult(input: CancelResult): CancelResult {
  const base = requirePlainRecord(input, 'CancelResult');
  let kind: unknown;
  try { kind = base.kind; } catch { fail('CORRUPT_RECORD', 'CancelResult.kind cannot be inspected safely'); }
  switch (kind) {
    case 'cancelled': {
      const record = snapshotExactRecord(input, ['kind','cancelledAtMs'], 'CancelResult.cancelled');
      return Object.freeze({ kind: 'cancelled', cancelledAtMs: requireEpochMs(record.cancelledAtMs, 'cancelledAtMs') });
    }
    case 'unsupported':
    case 'unknown': {
      const record = snapshotExactRecord(input, ['kind','reasonCode'], `CancelResult.${kind}`);
      return Object.freeze({ kind, reasonCode: requireReasonCode(record.reasonCode) });
    }
    default:
      fail('CORRUPT_RECORD', 'Unknown CancelResult kind');
  }
}

export function validateAdapterContext(context: AdapterContext): AdapterContext {
  const record = snapshotExactRecord(context, ['nowMs'], 'AdapterContext');
  return Object.freeze({ nowMs: requireEpochMs(record.nowMs, 'context.nowMs') });
}

export function validateAttemptContext(context: AttemptContext): AttemptContext {
  const record = snapshotExactRecord(context, ['nowMs','attemptId','idempotencyKey','deadlineMs'], 'AttemptContext');
  const nowMs = requireEpochMs(record.nowMs, 'context.nowMs');
  const attemptId = requireOpaqueId(record.attemptId, 'attemptId');
  const idempotencyKey = requireOpaqueId(record.idempotencyKey, 'idempotencyKey');
  const deadlineMs = requireEpochMs(record.deadlineMs, 'deadlineMs');
  if (deadlineMs <= nowMs) fail('DEADLINE_NOT_FEASIBLE', 'Attempt deadline must be after nowMs');
  return Object.freeze({ nowMs, attemptId, idempotencyKey, deadlineMs });
}

export function validateReceiveContext(context: ReceiveContext): ReceiveContext {
  const record = snapshotExactRecord(context, ['nowMs','limit'], 'ReceiveContext');
  return Object.freeze({ nowMs: requireEpochMs(record.nowMs, 'context.nowMs'), limit: requirePositiveSafeInteger(record.limit, 'limit') });
}

export async function adapterCapabilities(adapterInput: TransportAdapter, context: AdapterContext): Promise<TransportCapabilities> {
  const adapter = requireTransportAdapter(adapterInput);
  const validatedContext = validateAdapterContext(context);
  return validateTransportCapabilities(await invokeAdapter('capabilities', () => adapter.capabilities(validatedContext)));
}

export async function adapterStatus(adapterInput: TransportAdapter, context: AdapterContext): Promise<TransportStatus> {
  const adapter = requireTransportAdapter(adapterInput);
  const validatedContext = validateAdapterContext(context);
  const status = validateTransportStatus(await invokeAdapter('status', () => adapter.status(validatedContext)));
  if (status.observedAtMs > validatedContext.nowMs) fail('INVALID_TIMESTAMP', 'TransportStatus cannot be observed in the future');
  return status;
}

export async function adapterSend(adapterInput: TransportAdapter, fragment: Fragment, context: AttemptContext): Promise<SendResult> {
  const adapter = requireTransportAdapter(adapterInput);
  const validatedContext = validateAttemptContext(context);
  const validatedFragment = validateFragment(fragment);
  if (validatedFragment.expiresAtMs !== validatedContext.deadlineMs) fail('CORRUPT_RECORD', 'Fragment expiry and attempt deadline must match');
  if (validatedContext.nowMs >= validatedContext.deadlineMs) fail('DEADLINE_NOT_FEASIBLE', 'Attempt cannot start at or after deadline');
  const result = validateSendResult(await invokeAdapter('send', () => adapter.send(validatedFragment, validatedContext)));
  if (result.kind === 'accepted' && result.acceptedAtMs > validatedContext.nowMs) fail('INVALID_TIMESTAMP', 'SendResult acceptedAtMs cannot be in the future');
  return result;
}

export async function adapterReceive(adapterInput: TransportAdapter, cursorInput: string | null, context: ReceiveContext): Promise<ReceiveBatch> {
  const adapter = requireTransportAdapter(adapterInput);
  const cursor = cursorInput === null ? null : requireOpaqueId(cursorInput, 'cursor');
  const validatedContext = validateReceiveContext(context);
  const batch = validateReceiveBatch(await invokeAdapter('receive', () => adapter.receive(cursor, validatedContext)));
  if (batch.observedAtMs > validatedContext.nowMs) fail('INVALID_TIMESTAMP', 'ReceiveBatch cannot be observed in the future');
  if (batch.items.length > validatedContext.limit) fail('CORRUPT_RECORD', 'ReceiveBatch exceeds requested limit');
  if (batch.hasMore && batch.cursor === null) fail('CORRUPT_RECORD', 'ReceiveBatch with hasMore=true requires a continuation cursor');
  return batch;
}

export async function adapterCancel(
  adapterInput: TransportAdapter,
  messageIdInput: string,
  attemptIdInput: string,
  context: AdapterContext,
): Promise<CancelResult> {
  const adapter = requireTransportAdapter(adapterInput);
  const messageId = requireOpaqueId(messageIdInput, 'messageId');
  const attemptId = requireOpaqueId(attemptIdInput, 'attemptId');
  const validatedContext = validateAdapterContext(context);
  const result = validateCancelResult(await invokeAdapter('cancel', () => adapter.cancel(messageId, attemptId, validatedContext)));
  if (result.kind === 'cancelled' && result.cancelledAtMs > validatedContext.nowMs) fail('INVALID_TIMESTAMP', 'CancelResult cannot be observed in the future');
  return result;
}
