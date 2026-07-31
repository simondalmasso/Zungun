import { ZepError } from '../vendor/zep-core/src/errors.js';
import { validateMessage } from '../vendor/zep-core/src/message.js';
import type { LogicalMessage, LogicalMessageInput } from '../vendor/zep-core/src/types.js';
import { snapshotExactRecord } from '../vendor/zep-core/src/validation.js';

export const ZEP_TEST_WIRE_SCHEMA = 'zungun-zep-test-wire.v1' as const;
export const ZEP_TEST_MAX_PAYLOAD_BYTES = 48_000;
export const ZEP_TEST_MAX_ENVELOPE_BYTES = 65_536;
export const ZEP_TEST_DUPLICATE_SEMANTICS = 'PROCESS_EACH_ENQUEUED_DELIVERY' as const;

const WIRE_KEYS = Object.freeze([
  'schemaVersion',
  'zepVersion',
  'messageId',
  'conversationId',
  'senderId',
  'recipientIds',
  'createdAtMs',
  'expiresAtMs',
  'priority',
  'contentType',
  'payloadBase64',
  'receiptPolicy',
  'messageCommitment',
  'extensions',
] as const);

export type ZepTestTransportErrorCode =
  | 'INVALID_TRANSPORT_BYTES'
  | 'ENVELOPE_TOO_LARGE'
  | 'MALFORMED_ENVELOPE'
  | 'INVALID_BASE64'
  | 'PAYLOAD_TOO_LARGE'
  | 'IDENTITY_MISMATCH'
  | 'PROCESSOR_FAILED'
  | 'INVALID_PROCESSING_RECEIPT';

export class ZepTestTransportError extends Error {
  readonly name = 'ZepTestTransportError';
  constructor(readonly code: ZepTestTransportErrorCode) {
    super(code);
  }
}

function fail(code: ZepTestTransportErrorCode): never {
  throw new ZepTestTransportError(code);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    const chunk = bytes.subarray(offset, Math.min(offset + 8_192, bytes.length));
    for (const value of chunk) binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function strictBase64ToBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0) fail('INVALID_BASE64');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail('INVALID_BASE64');
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    fail('INVALID_BASE64');
  }
  if (binary.length > ZEP_TEST_MAX_PAYLOAD_BYTES) fail('PAYLOAD_TOO_LARGE');
  if (btoa(binary) !== value) fail('INVALID_BASE64');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function readWireRecord(bytes: Uint8Array): Record<string, unknown> {
  if (!(bytes instanceof Uint8Array)) fail('INVALID_TRANSPORT_BYTES');
  if (bytes.byteLength > ZEP_TEST_MAX_ENVELOPE_BYTES) fail('ENVELOPE_TOO_LARGE');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice());
  } catch {
    fail('MALFORMED_ENVELOPE');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    fail('MALFORMED_ENVELOPE');
  }
  try {
    return snapshotExactRecord(parsed, WIRE_KEYS, 'ZepTestWireEnvelope');
  } catch (error) {
    if (error instanceof ZepError) fail('MALFORMED_ENVELOPE');
    throw error;
  }
}

export class ZepTestCodec {
  serialize(input: LogicalMessageInput | LogicalMessage, nowMs: number): Uint8Array {
    const message = validateMessage(input, nowMs);
    const payload = message.payload;
    if (payload.byteLength > ZEP_TEST_MAX_PAYLOAD_BYTES) fail('PAYLOAD_TOO_LARGE');
    const wire: Record<string, unknown> = {
      schemaVersion: ZEP_TEST_WIRE_SCHEMA,
      zepVersion: message.zepVersion,
      messageId: message.messageId,
      conversationId: message.conversationId,
      senderId: message.senderId,
      recipientIds: [...message.recipientIds],
      createdAtMs: message.createdAtMs,
      expiresAtMs: message.expiresAtMs,
      priority: message.priority,
      contentType: message.contentType,
      payloadBase64: bytesToBase64(payload),
      receiptPolicy: message.receiptPolicy,
      messageCommitment: message.messageCommitment,
    };
    if (message.extensions !== undefined) wire.extensions = message.extensions;
    const bytes = new TextEncoder().encode(JSON.stringify(wire));
    if (bytes.byteLength > ZEP_TEST_MAX_ENVELOPE_BYTES) fail('ENVELOPE_TOO_LARGE');
    return bytes;
  }

  deserialize(bytes: Uint8Array, nowMs: number): LogicalMessage {
    const record = readWireRecord(bytes);
    if (record.schemaVersion !== ZEP_TEST_WIRE_SCHEMA) fail('MALFORMED_ENVELOPE');
    const payload = strictBase64ToBytes(record.payloadBase64);
    const input: LogicalMessageInput = {
      zepVersion: record.zepVersion as LogicalMessageInput['zepVersion'],
      messageId: record.messageId as string,
      conversationId: record.conversationId as string,
      senderId: record.senderId as string,
      recipientIds: record.recipientIds as readonly string[],
      createdAtMs: record.createdAtMs as number,
      expiresAtMs: record.expiresAtMs as number,
      priority: record.priority as LogicalMessageInput['priority'],
      contentType: record.contentType as string,
      payload,
      receiptPolicy: record.receiptPolicy as LogicalMessageInput['receiptPolicy'],
      messageCommitment: record.messageCommitment as string,
      ...(Object.prototype.hasOwnProperty.call(record, 'extensions') ? { extensions: record.extensions } : {}),
    };
    return validateMessage(input, nowMs);
  }
}

export interface LoopbackFrame {
  readonly sequence: number;
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly bytes: Uint8Array;
}

export class InMemoryLoopbackTransport {
  readonly transportId: string;
  private readonly queue: LoopbackFrame[] = [];
  private nextSequence = 1;

  constructor(transportId = 'loopback-test-v1') {
    if (transportId.length < 1 || /\s/.test(transportId)) fail('IDENTITY_MISMATCH');
    this.transportId = transportId;
  }

  send(messageId: string, messageCommitment: string, bytes: Uint8Array): number {
    if (messageId.length < 1 || messageCommitment.length < 1) fail('IDENTITY_MISMATCH');
    if (!(bytes instanceof Uint8Array)) fail('INVALID_TRANSPORT_BYTES');
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    this.queue.push(Object.freeze({
      sequence,
      messageId,
      messageCommitment,
      bytes: bytes.slice(),
    }));
    return sequence;
  }

  receive(sequence?: number): LoopbackFrame | null {
    let frame: LoopbackFrame | undefined;
    if (sequence === undefined) {
      frame = this.queue.shift();
    } else {
      if (!Number.isSafeInteger(sequence) || sequence < 1) fail('IDENTITY_MISMATCH');
      const index = this.queue.findIndex((candidate) => candidate.sequence === sequence);
      if (index < 0) return null;
      [frame] = this.queue.splice(index, 1);
    }
    if (frame === undefined) return null;
    return Object.freeze({
      sequence: frame.sequence,
      messageId: frame.messageId,
      messageCommitment: frame.messageCommitment,
      bytes: frame.bytes.slice(),
    });
  }

  pending(): number {
    return this.queue.length;
  }
}

export type TestMessageProcessorHandler = (message: LogicalMessage) => void | Promise<void>;

export class TestMessageProcessor {
  readonly processedMessageIds: string[] = [];

  constructor(
    readonly processorId = 'test-message-processor-v1',
    private readonly handler: TestMessageProcessorHandler = () => undefined,
  ) {
    if (processorId.length < 1 || /\s/.test(processorId)) fail('IDENTITY_MISMATCH');
  }

  async process(message: LogicalMessage): Promise<void> {
    await this.handler(message);
    this.processedMessageIds.push(message.messageId);
  }
}

const PROCESSING_RECEIPT_BRAND: unique symbol = Symbol('ZungunProcessingReceipt');

/** Opaque runtime-branded proof emitted only after successful test processing. */
export interface ProcessingReceipt {
  readonly [PROCESSING_RECEIPT_BRAND]: true;
  readonly receiptId: string;
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly transportId: string;
  readonly processorId: string;
  readonly outcome: 'PROCESSED';
  readonly processedAtMs: number;
  readonly deliverySequence: number;
}

export interface ProcessingReceiptExpectation {
  readonly messageId: string;
  readonly messageCommitment: string;
  readonly transportId: string;
  readonly processorId: string;
  readonly deliverySequence: number;
}

const issuedProcessingReceipts = new WeakSet<object>();

function encodeReceiptIdentityPart(value: string): string {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    bytes[index * 2] = codeUnit >>> 8;
    bytes[index * 2 + 1] = codeUnit & 0xff;
  }
  return bytesToBase64(bytes);
}

function createReceiptId(
  transportId: string,
  processorId: string,
  deliverySequence: number,
  messageId: string,
  messageCommitment: string,
  processedAtMs: number,
): string {
  return [
    'processing-v2',
    encodeReceiptIdentityPart(transportId),
    encodeReceiptIdentityPart(processorId),
    String(deliverySequence),
    encodeReceiptIdentityPart(messageId),
    encodeReceiptIdentityPart(messageCommitment),
    String(processedAtMs),
  ].join('.');
}

function issueProcessingReceipt(
  frame: LoopbackFrame,
  message: LogicalMessage,
  transportId: string,
  processorId: string,
  processedAtMs: number,
): ProcessingReceipt {
  const receipt = {
    receiptId: createReceiptId(
      transportId,
      processorId,
      frame.sequence,
      message.messageId,
      message.messageCommitment,
      processedAtMs,
    ),
    messageId: message.messageId,
    messageCommitment: message.messageCommitment,
    transportId,
    processorId,
    outcome: 'PROCESSED' as const,
    processedAtMs,
    deliverySequence: frame.sequence,
  } as ProcessingReceipt;
  Object.defineProperty(receipt, PROCESSING_RECEIPT_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.freeze(receipt);
  issuedProcessingReceipts.add(receipt);
  return receipt;
}

export function assertAuthenticProcessingReceipt(
  value: unknown,
  expected?: ProcessingReceiptExpectation,
): ProcessingReceipt {
  if (
    typeof value !== 'object'
    || value === null
    || !issuedProcessingReceipts.has(value)
    || (value as ProcessingReceipt)[PROCESSING_RECEIPT_BRAND] !== true
  ) {
    fail('INVALID_PROCESSING_RECEIPT');
  }
  const receipt = value as ProcessingReceipt;
  if (expected !== undefined && (
    receipt.messageId !== expected.messageId
    || receipt.messageCommitment !== expected.messageCommitment
    || receipt.transportId !== expected.transportId
    || receipt.processorId !== expected.processorId
    || receipt.deliverySequence !== expected.deliverySequence
  )) {
    fail('IDENTITY_MISMATCH');
  }
  return receipt;
}

export interface EndToEndTransportServiceOptions {
  readonly codec?: ZepTestCodec;
  readonly transport?: InMemoryLoopbackTransport;
  readonly processor?: TestMessageProcessor;
  readonly now?: () => number;
}

export class EndToEndTransportService {
  readonly codec: ZepTestCodec;
  readonly transport: InMemoryLoopbackTransport;
  readonly processor: TestMessageProcessor;
  readonly duplicateSemantics = ZEP_TEST_DUPLICATE_SEMANTICS;
  private readonly now: () => number;

  constructor(options: EndToEndTransportServiceOptions = {}) {
    this.codec = options.codec ?? new ZepTestCodec();
    this.transport = options.transport ?? new InMemoryLoopbackTransport();
    this.processor = options.processor ?? new TestMessageProcessor();
    this.now = options.now ?? Date.now;
  }

  enqueue(input: LogicalMessageInput | LogicalMessage): number {
    const nowMs = this.now();
    const validated = validateMessage(input, nowMs);
    const bytes = this.codec.serialize(validated, nowMs);
    return this.transport.send(validated.messageId, validated.messageCommitment, bytes);
  }

  private async processFrame(frame: LoopbackFrame): Promise<ProcessingReceipt> {
    const processedAtMs = this.now();
    const message = this.codec.deserialize(frame.bytes, processedAtMs);
    if (message.messageId !== frame.messageId || message.messageCommitment !== frame.messageCommitment) {
      fail('IDENTITY_MISMATCH');
    }
    try {
      await this.processor.process(message);
    } catch {
      fail('PROCESSOR_FAILED');
    }
    return issueProcessingReceipt(
      frame,
      message,
      this.transport.transportId,
      this.processor.processorId,
      processedAtMs,
    );
  }

  async processNext(): Promise<ProcessingReceipt | null> {
    const frame = this.transport.receive();
    if (frame === null) return null;
    return this.processFrame(frame);
  }

  async deliver(input: LogicalMessageInput | LogicalMessage): Promise<ProcessingReceipt> {
    const sequence = this.enqueue(input);
    const frame = this.transport.receive(sequence);
    if (frame === null) fail('IDENTITY_MISMATCH');
    return this.processFrame(frame);
  }
}
