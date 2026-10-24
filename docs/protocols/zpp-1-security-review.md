# ZPP/1 — security and transport review

Status: design review, not an implementation specification.

## Decision

Do not implement ZPP/1 wire encoding or enable any satellite transport from the pasted draft yet. The draft contains a promising compact framing proposal, but critical cryptographic, persistence, and provider assumptions remain underspecified. This document reviews the draft supplied in the project discussion; it does not independently verify the decompiled Bullitt source tree or prove any operator capability.

## Evidence classes

- **Observed in the supplied analysis, not independently reproduced here:** the analysis reports an 8-byte Bullitt SMP header, BLE GATT communication with a Defy Satellite Link accessory, and separate satellite/SMS/Internet receipt media.
- **ZPP/1 design proposals:** 8-byte header, XChaCha20-Poly1305, directional keys, compact RCPT, a 100-byte preferred PDU, and explicit manual retransmission.
- **Unknown until tested against an actual service:** whether a target provider accepts arbitrary app-originated SMS payloads or IP datagrams, the real payload/segment limits, access policy, billing, receipts, and service availability in the intended country.

A commercial app's internal protocol is not a public transport API. Reusing framing ideas does not grant access to its accessory, backend, carrier, or satellite network.

## Blocking issues before implementation

### 1. Authenticate the complete header

The 8-byte header must be supplied as AEAD associated data on both encryption and decryption. The receiver must reject an invalid version, reserved bits, unsupported flags, impossible type/flag combinations, and a length mismatch before dispatch. The length field is plaintext length; for the selected AEAD, ciphertext length should equal plaintext length, but the parser must still enforce the exact total length: 8 + LEN + tag length.

No header field may be trusted merely because it was parsed before decryption.

### 2. Define identity and key lifecycle

KEYX carrying only an X25519 public key is not a complete authenticated key-rotation protocol. Specify:
- the long-term identity credential and how peer identity is authenticated;
- transcript binding, downgrade protection, and key confirmation;
- canonical initiator/responder roles and the exact HKDF input, salt, info labels, and output lengths;
- simultaneous rotation, interrupted rotation, lost confirmations, rollback prevention, and revocation/re-pairing;
- what happens when a device has lost its persisted counters or epoch state.

A session key update must not accept an unauthenticated replacement identity. Do not design custom cryptography where a reviewed, established handshake can be used.

### 3. Make nonce uniqueness an enforced invariant

The draft's deterministic nonce is safe only if every (key, nonce) pair is unique for all possible executions, including crashes, restores, retries, key rotation, and manual retransmission. Directional keys help separate each sender's nonce space, but the specification must define durable counter reservation and behavior before exhaustion. A counter must never reset under the same key. Retransmitting the exact original ciphertext is distinct from encrypting again with a reused nonce.

Use the complete header as AEAD associated data. Treat epoch and message counters as protocol state, not as proof of peer identity.

### 4. Define receive transaction and receipt semantics

Required receive order:
1. Parse bounds and fixed framing without dispatching content.
2. Authenticate/decrypt with the correct peer, epoch, and directional key.
3. Atomically persist the authenticated message and its deduplication key.
4. Only after durable commit, make it visible to the conversation.
5. Emit DELIVERED only after that commit; emit READ only after the user-visible read event if read receipts are enabled.

A duplicate authenticated message must not be displayed twice. If it requested a receipt, the receiver may re-emit the appropriate receipt only after consulting durable deduplication state. An unauthenticated packet must never create a receipt or a trusted dedup entry.

Define how BASE and WIN behave across epoch changes, counter wrap, missing gaps, delayed packets, and messages older than the 64-entry/6-hour window. The receiver must not claim that all IDs below BASE arrived unless the contiguous-delivery invariant actually holds.

### 5. Fix the wire schema before coding

The draft needs a single normative bit/byte table and parser rules for:
- whether LEN counts the encrypted plaintext payload only, and whether piggybacked receipt bytes are included;
- the exact binary layout of PGB and the conditions under which it is allowed;
- MFB fragmentation identifiers, maximum fragment count, assembly limits, expiry, duplicate fragments, and memory quotas;
- legal flag/type combinations, unknown types, reserved values, and malformed packet handling;
- the precise mapping of receipt status, reason, and medium values;
- byte order and maximum PDU for each separately negotiated transport profile.

The sample PDU and the schema must be checked by a reference encoder/decoder test vector before implementation.

### 6. Treat the 100-byte profile as a target, not a network guarantee

For a 100-byte binary PDU, base64 encoding produces 136 characters (without padding suppression). This can fit within the 160-character GSM-7 single-SMS limit when all characters are representable in the GSM-7 alphabet and the carrier preserves them. It does not establish that a satellite service accepts arbitrary SMS payloads, routes them to the intended recipient, or supports application-level replies.

Likewise, UDP is usable only if the subscribed satellite service exposes application IP connectivity and routes the relevant traffic. An emergency-only service, a satellite SOS API, a BLE accessory, and a public satellite telemetry feed are not interchangeable transports.

Do not label zpp/1/sms-gsm7-b64 or zpp/1/udp as available until the exact service, device, plan, region, permissions, and documented API have been verified.

### 7. Correct status names and product behavior

Keep these states distinct:
- NOT_SENT_NO_SATELLITE_LINK: no transmission attempt was accepted by the transport.
- LINK_ACCEPTED: the provider/modem accepted the attempt; this is not remote delivery.
- DELIVERED: a valid authenticated receipt from the paired recipient proves durable receipt.
- READ: a valid receipt reports the agreed read event.
- UNDELIVERED / NO_RECEIPT: negative receipt or an explicitly timed-out observation, never inferred delivery.

A six-hour timeout is a local observation, not a wire-level delivery fact. A manual resend policy must explain that it may cause another network transmission. Reusing the same message identifier and ciphertext supports deduplication, but cannot guarantee the underlying provider will not bill or process a duplicate.

## Required acceptance gates

No wire implementation is ready until all are true:

- [ ] A reviewed protocol document specifies the handshake, key schedule, authenticated header, nonce lifecycle, replay/dedup rules, and key rotation.
- [ ] A reference encoder/decoder passes fixed test vectors, malformed-input tests, and fuzzing without crashes or unbounded allocation.
- [ ] Tests cover crashes between persistence and receipt emission, duplicate/reordered/delayed packets, counter exhaustion, epoch rollover, and simultaneous key rotation.
- [ ] Two independent devices exchange encrypted messages and authenticated receipts over a documented, authorized provider interface.
- [ ] The real test succeeds with Wi-Fi and terrestrial mobile data disabled, and the test records the actual transport and provider receipt.
- [ ] UI labels distinguish local queueing, provider acceptance, remote durable delivery, and read receipts.
- [ ] The implementation fails closed when the provider adapter or entitlement is absent; no HTTPS fallback occurs in satellite-only mode.

## Current Zungun status

The existing Android pocket module is a routing-policy foundation, not a provider adapter. The PWA's satellite-only mode is a guard that prevents outgoing messages from falling back to its HTTPS message endpoint; the PWA still needs Internet for authentication and conversation synchronization. Neither component currently transmits ZPP/1 over satellite.

## Next safe implementation step

Implement only a transport-independent ZPP/1 parser/encoder after the schema and key-management questions above are resolved. Keep it behind tests and an unavailable-by-default feature flag. Do not add an SMS sender, UDP relay, or claim real satellite delivery without a verified provider integration.
