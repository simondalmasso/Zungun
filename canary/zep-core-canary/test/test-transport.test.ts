import test from 'node:test';
import assert from 'node:assert/strict';
import { ZepError } from '../vendor/zep-core/src/errors.js';
import type { LogicalMessage, LogicalMessageInput } from '../vendor/zep-core/src/types.js';
import {
  EndToEndTransportService,
  InMemoryLoopbackTransport,
  TestMessageProcessor,
  ZEP_TEST_DUPLICATE_SEMANTICS,
  ZEP_TEST_MAX_PAYLOAD_BYTES,
  ZepTestCodec,
  ZepTestTransportError,
  type ProcessingReceipt,
} from '../src/test-transport.js';

const NOW = 1_800_000_000_000;

function message(overrides: Partial<LogicalMessageInput> = {}): LogicalMessageInput {
  return {
    zepVersion: '0.1',
    messageId: 'msg-loopback-001',
    conversationId: 'conv-loopback-001',
    senderId: 'sender-loopback-001',
    recipientIds: ['recipient-loopback-001'],
    createdAtMs: NOW - 1_000,
    expiresAtMs: NOW + 60_000,
    priority: 2,
    contentType: 'application/octet-stream',
    payload: Uint8Array.of(0, 1, 2, 253, 254, 255),
    receiptPolicy: 'END_RECIPIENT_ACK',
    messageCommitment: 'commitment-loopback-001',
    ...overrides,
  };
}

async function captureError(fn: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('EXPECTED_FAILURE');
}

function assertTransportCode(error: unknown, code: string): void {
  assert.ok(error instanceof ZepTestTransportError);
  assert.equal(error.code, code);
}

function assertZepCode(error: unknown, code: string): void {
  assert.ok(error instanceof ZepError);
  assert.equal(error.code, code);
}

async function deliver(input: LogicalMessageInput = message()): Promise<{ receipt: ProcessingReceipt; processor: TestMessageProcessor }> {
  const processor = new TestMessageProcessor();
  const service = new EndToEndTransportService({ processor, now: () => NOW });
  return { receipt: await service.deliver(input), processor };
}

test('ZEP-060-001 valid message crosses the full transport and processing boundary', async () => {
  const { receipt, processor } = await deliver();
  assert.deepEqual(processor.processedMessageIds, ['msg-loopback-001']);
  assert.equal(receipt.outcome, 'PROCESSED');
  assert.equal(receipt.transportId, 'loopback-test-v1');
  assert.equal(receipt.processorId, 'test-message-processor-v1');
});

test('ZEP-060-002 codec round-trips every logical field', () => {
  const codec = new ZepTestCodec();
  const input = message({
    recipientIds: ['r1', 'r2'],
    priority: 3,
    contentType: 'application/vnd.zungun.test',
    extensions: { alpha: 1, nested: { beta: true }, list: [null, 'x'] },
  });
  const decoded = codec.deserialize(codec.serialize(input, NOW), NOW);
  assert.equal(decoded.zepVersion, input.zepVersion);
  assert.equal(decoded.messageId, input.messageId);
  assert.equal(decoded.conversationId, input.conversationId);
  assert.equal(decoded.senderId, input.senderId);
  assert.deepEqual(decoded.recipientIds, input.recipientIds);
  assert.equal(decoded.createdAtMs, input.createdAtMs);
  assert.equal(decoded.expiresAtMs, input.expiresAtMs);
  assert.equal(decoded.priority, input.priority);
  assert.equal(decoded.contentType, input.contentType);
  assert.equal(decoded.receiptPolicy, input.receiptPolicy);
  assert.equal(decoded.messageCommitment, input.messageCommitment);
  const extensions = decoded.extensions as Readonly<Record<string, unknown>>;
  assert.equal(extensions.alpha, 1);
  assert.deepEqual(extensions.list, [null, 'x']);
  assert.equal((extensions.nested as Readonly<Record<string, unknown>>).beta, true);
});

test('ZEP-060-003 payload round-trip is byte-exact', () => {
  const payload = Uint8Array.from({ length: 257 }, (_, index) => index % 256);
  const codec = new ZepTestCodec();
  const decoded = codec.deserialize(codec.serialize(message({ payload }), NOW), NOW);
  assert.deepEqual(decoded.payload, payload);
});

test('ZEP-060-004 malformed bytes and JSON are rejected', async () => {
  const codec = new ZepTestCodec();
  assertTransportCode(await captureError(() => codec.deserialize(Uint8Array.of(0xff, 0xfe), NOW)), 'MALFORMED_ENVELOPE');
  assertTransportCode(await captureError(() => codec.deserialize(new TextEncoder().encode('{'), NOW)), 'MALFORMED_ENVELOPE');
});

test('ZEP-060-005 semantically invalid ZEP message is rejected after deserialization', async () => {
  const codec = new ZepTestCodec();
  const text = new TextDecoder().decode(codec.serialize(message(), NOW)).replace('"zepVersion":"0.1"', '"zepVersion":"0.2"');
  assertZepCode(await captureError(() => codec.deserialize(new TextEncoder().encode(text), NOW)), 'INVALID_VERSION');
});

test('ZEP-060-006 expired message is rejected before processor invocation', async () => {
  const processor = new TestMessageProcessor();
  const service = new EndToEndTransportService({ processor, now: () => NOW });
  assertZepCode(await captureError(() => service.deliver(message({ expiresAtMs: NOW }))), 'EXPIRED');
  assert.equal(processor.processedMessageIds.length, 0);
});

test('ZEP-060-007 exact payload limit is accepted', () => {
  const codec = new ZepTestCodec();
  const payload = new Uint8Array(ZEP_TEST_MAX_PAYLOAD_BYTES);
  const decoded = codec.deserialize(codec.serialize(message({ payload }), NOW), NOW);
  assert.equal(decoded.payload.byteLength, ZEP_TEST_MAX_PAYLOAD_BYTES);
});

test('ZEP-060-008 payload one byte over limit is rejected', async () => {
  const codec = new ZepTestCodec();
  const payload = new Uint8Array(ZEP_TEST_MAX_PAYLOAD_BYTES + 1);
  assertTransportCode(await captureError(() => codec.serialize(message({ payload }), NOW)), 'PAYLOAD_TOO_LARGE');
});

test('ZEP-060-009 processor failure creates no success receipt', async () => {
  const processor = new TestMessageProcessor('failing-processor', () => { throw new Error('private-payload-must-not-leak'); });
  const service = new EndToEndTransportService({ processor, now: () => NOW });
  const error = await captureError(() => service.deliver(message()));
  assertTransportCode(error, 'PROCESSOR_FAILED');
  assert.equal(processor.processedMessageIds.length, 0);
});

test('ZEP-060-010 receipt binds messageId and commitment', async () => {
  const { receipt } = await deliver();
  assert.equal(receipt.messageId, 'msg-loopback-001');
  assert.equal(receipt.messageCommitment, 'commitment-loopback-001');
  assert.match(receipt.receiptId, /msg-loopback-001/);
  assert.match(receipt.receiptId, /commitment-loopback-001/);
});

test('ZEP-060-011 receipt is deterministic with fixed clock and fresh service', async () => {
  const first = (await deliver()).receipt;
  const second = (await deliver()).receipt;
  assert.deepEqual(first, second);
});

test('ZEP-060-012 sender object mutation after enqueue cannot cross the boundary', async () => {
  const payload = Uint8Array.of(1, 2, 3);
  const recipients = ['recipient-original'];
  const input = message({ payload, recipientIds: recipients });
  let observed: LogicalMessage | undefined;
  const processor = new TestMessageProcessor('observer', (value) => { observed = value; });
  const service = new EndToEndTransportService({ processor, now: () => NOW });
  service.enqueue(input);
  payload[0] = 99;
  recipients[0] = 'recipient-mutated';
  await service.processNext();
  assert.ok(observed !== undefined);
  assert.deepEqual(observed.payload, Uint8Array.of(1, 2, 3));
  assert.deepEqual(observed.recipientIds, ['recipient-original']);
});

test('ZEP-060-013 sender byte buffer mutation after transport send is isolated', () => {
  const transport = new InMemoryLoopbackTransport();
  const bytes = Uint8Array.of(10, 20, 30);
  transport.send('m', 'c', bytes);
  bytes[0] = 99;
  const received = transport.receive();
  assert.ok(received !== null);
  assert.deepEqual(received.bytes, Uint8Array.of(10, 20, 30));
  received.bytes[1] = 88;
  assert.deepEqual(received.bytes, Uint8Array.of(10, 88, 30));
});

test('ZEP-060-014 unknown fields and __proto__ are rejected without pollution', async () => {
  const codec = new ZepTestCodec();
  const base = new TextDecoder().decode(codec.serialize(message(), NOW));
  const unknown = base.replace(/}$/, ',"unknown":"secret"}');
  const proto = base.replace(/}$/, ',"__proto__":{"polluted":true}}');
  assertTransportCode(await captureError(() => codec.deserialize(new TextEncoder().encode(unknown), NOW)), 'MALFORMED_ENVELOPE');
  assertTransportCode(await captureError(() => codec.deserialize(new TextEncoder().encode(proto), NOW)), 'MALFORMED_ENVELOPE');
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('ZEP-060-015 transport identity mismatch blocks processing and receipt', async () => {
  const codec = new ZepTestCodec();
  const transport = new InMemoryLoopbackTransport();
  const processor = new TestMessageProcessor();
  transport.send('different-message', 'commitment-loopback-001', codec.serialize(message(), NOW));
  const service = new EndToEndTransportService({ codec, transport, processor, now: () => NOW });
  assertTransportCode(await captureError(() => service.processNext()), 'IDENTITY_MISMATCH');
  assert.equal(processor.processedMessageIds.length, 0);
});

test('ZEP-060-016 duplicate sends process each enqueued delivery explicitly', async () => {
  const processor = new TestMessageProcessor();
  const service = new EndToEndTransportService({ processor, now: () => NOW });
  assert.equal(service.duplicateSemantics, ZEP_TEST_DUPLICATE_SEMANTICS);
  service.enqueue(message());
  service.enqueue(message());
  const first = await service.processNext();
  const second = await service.processNext();
  assert.ok(first !== null && second !== null);
  assert.equal(first.deliverySequence, 1);
  assert.equal(second.deliverySequence, 2);
  assert.equal(first.receiptId === second.receiptId, false);
  assert.deepEqual(processor.processedMessageIds, ['msg-loopback-001', 'msg-loopback-001']);
});

test('ZEP-060-017 enqueue proves there is no direct processor bypass', async () => {
  const processor = new TestMessageProcessor();
  const service = new EndToEndTransportService({ processor, now: () => NOW });
  service.enqueue(message());
  assert.equal(processor.processedMessageIds.length, 0);
  assert.equal(service.transport.pending(), 1);
  await service.processNext();
  assert.deepEqual(processor.processedMessageIds, ['msg-loopback-001']);
});

test('ZEP-060-018 errors and logs contain neither payload nor base64', async () => {
  const secretPayload = new TextEncoder().encode('payload-secret-value');
  const base64 = btoa('payload-secret-value');
  const logs: string[] = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...values: unknown[]) => { logs.push(values.join(' ')); };
  console.log = (...values: unknown[]) => { logs.push(values.join(' ')); };
  try {
    const processor = new TestMessageProcessor('failing', () => { throw new Error(`bad ${base64}`); });
    const service = new EndToEndTransportService({ processor, now: () => NOW });
    const error = await captureError(() => service.deliver(message({ payload: secretPayload })));
    assertTransportCode(error, 'PROCESSOR_FAILED');
    assert.equal(String(error).includes('payload-secret-value'), false);
    assert.equal(String(error).includes(base64), false);
    assert.equal(logs.join('\n').includes('payload-secret-value'), false);
    assert.equal(logs.join('\n').includes(base64), false);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test('ZEP-060-019 receive returns null without fabricating processing', async () => {
  const processor = new TestMessageProcessor();
  const service = new EndToEndTransportService({ processor, now: () => NOW });
  assert.equal(await service.processNext(), null);
  assert.equal(processor.processedMessageIds.length, 0);
});

test('ZEP-060-020 receive-time expiration revalidation blocks queued messages', async () => {
  let now = NOW;
  const processor = new TestMessageProcessor();
  const service = new EndToEndTransportService({ processor, now: () => now });
  service.enqueue(message({ expiresAtMs: NOW + 1 }));
  now = NOW + 1;
  assertZepCode(await captureError(() => service.processNext()), 'EXPIRED');
  assert.equal(processor.processedMessageIds.length, 0);
});
