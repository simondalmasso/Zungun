import { ZepTestCodec } from '../dist/src/test-transport.js';

const NOW = 1_800_000_000_000;
const codec = new ZepTestCodec();
const input = {
  zepVersion: '0.1',
  messageId: 'msg-fuzz-001',
  conversationId: 'conv-fuzz-001',
  senderId: 'sender-fuzz-001',
  recipientIds: ['recipient-fuzz-001'],
  createdAtMs: NOW - 1_000,
  expiresAtMs: NOW + 60_000,
  priority: 2,
  contentType: 'application/octet-stream',
  payload: Uint8Array.from({ length: 64 }, (_, index) => index),
  receiptPolicy: 'END_RECIPIENT_ACK',
  messageCommitment: 'commitment-fuzz-001',
};
const baseline = codec.serialize(input, NOW);
let accepted = 0;
let rejected = 0;
let rawNativeErrors = 0;
const cases = 2_048;
for (let index = 0; index < cases; index += 1) {
  let mutated;
  if (index % 4 === 0) {
    mutated = baseline.slice(0, index % baseline.length);
  } else if (index % 4 === 1) {
    mutated = baseline.slice();
    mutated[index % mutated.length] ^= (index * 17) & 0xff;
  } else if (index % 4 === 2) {
    mutated = new Uint8Array(baseline.length + 1);
    mutated.set(baseline);
    mutated[mutated.length - 1] = index & 0xff;
  } else {
    mutated = Uint8Array.of(0xff, index & 0xff, 0xfe);
  }
  try {
    codec.deserialize(mutated, NOW);
    accepted += 1;
  } catch (error) {
    if (error?.name === 'ZepError' || error?.name === 'ZepTestTransportError') rejected += 1;
    else rawNativeErrors += 1;
  }
}
if (rawNativeErrors !== 0) throw new Error(`raw native errors: ${rawNativeErrors}`);
if (({}).polluted !== undefined) throw new Error('prototype pollution detected');
console.log(`ZEP_TEST_CODEC_FUZZ_CASES=${cases} ACCEPTED_MUTATIONS=${accepted} REJECTED=${rejected} RAW_NATIVE_ERRORS=${rawNativeErrors} PROTOTYPE_POLLUTION=0`);
