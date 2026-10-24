# ZPP/1 security gates — implementation is blocked until these are resolved

Status: design constraints, not a claim of implemented security. This document is intentionally separate from the Wi-Fi Direct UDP transport.

## 1. Durable message-ID allocation

A “pick the valid slot with the highest generation” fallback is unsafe. If the newest committed slot later becomes unreadable, selecting the older slot can reissue a nonce/message ID.

Required state:
- Two journal slots, each containing a version, generation, epoch, next message ID, and integrity check.
- A separately persisted commit head identifying the only committed slot and its generation. The head must be authenticated/integrity-protected using a key not stored alongside the mutable journal data.
- An allocator operation must serialize concurrent callers and return an ID only after the new slot is written and forced to durable storage, then the head is atomically replaced and the replacement is forced to durable storage.
- Any failure, malformed head, head/slot generation mismatch, or invalid slot referenced by the head transitions to `REQUIRE_HANDSHAKE`. Never fall back to an older slot when the head is invalid.
- A crash before the head commit leaves the previous committed state authoritative; the candidate ID must not have been returned. A crash after head commit may consume an ID without sending it; gaps are safe.
- Retransmission reuses the exact persisted ciphertext bytes. It must not invoke encryption again for the same message ID.

Implementation note: do not treat `SharedPreferences.apply()` or an ordinary preference readback as a durable commit protocol. The current branch now contains a standalone `DurableMessageIdAllocator` primitive using alternating `AtomicFile` slots, an Android Keystore HMAC-authenticated head, file sync, and parent-directory sync. JVM tests cover crash/failure ordering and corruption. This primitive is not yet integrated with encryption or send flow, and it still requires current-head CI and device verification. If the platform cannot provide the expected durability guarantees, fail closed.

Threat boundary: restoring an older, internally valid app-data snapshot together with all local integrity material is a rollback attack that local storage alone may not detect. If protection against privileged full-snapshot rollback is required, add a trustworthy monotonic anchor or require authenticated re-pairing; do not claim absolute rollback resistance.

## 2. Epoch lifecycle and downgrade rejection

The 16-bit epoch cannot wrap. Before advancing beyond `0xFFFF`, the session must stop allocating IDs and require a fresh authenticated pairing/session root. There is no modulo arithmetic and no silent reset to epoch zero.

For every received message:
- Reject an epoch below the highest authenticated epoch accepted for that peer/session.
- Accept a higher epoch only after the authenticated key-establishment protocol completes and key confirmation succeeds.
- Persist the accepted epoch before accepting application payloads in that epoch.
- A deduplication window or time-based replay cache is supplementary; it is not the primary proof that nonce reuse is impossible.
- If the durable epoch state is absent, corrupt, contradictory, or appears rolled back, enter `REQUIRE_HANDSHAKE`; do not infer a safe epoch from packet traffic.

The protocol owner must decide whether a wider epoch encoding is preferable before freezing the wire format. Any encoding change requires versioning and test vectors.

## 3. Authenticated root-key establishment (KEYX)

The existing `SecureSessionStore` stores the app's Cloudflare/API session token using Android Keystore-backed AES-GCM. It is not a P2P root-key channel and must not be reused as `era_secret`.

Before implementing `ZppCodec`, specify and implement a P2P-specific authenticated key-establishment path that works under the intended offline threat model. It must define:
- how peers authenticate each other's identity without relying on an online server during the transfer;
- how fresh entropy and the 32-byte era/session secret are derived or exchanged;
- explicit transcript binding to both peer identities, protocol version, role/direction, and negotiated epoch;
- key confirmation in both directions before application data is accepted;
- pairing-code/SAS verification, retry limits, expiration, cancellation, and re-pair/reset behavior;
- storage and erasure rules for long-term keys and ephemeral secrets.

A pairing code that merely identifies a user or routes a request through the cloud is not, by itself, cryptographic proof of peer identity. Do not ship an unauthenticated secret exchange.

## 4. Wire-format blocker: nonce length mismatch

The proposed expression `EPOCH(2 bytes) || MSGID(2 bytes) || DIR(1 byte) || 17 zero bytes` totals **22 bytes**, not 24. XChaCha20-Poly1305 requires a 24-byte nonce. Before implementing the codec, resolve this in the normative spec: either use 19 trailing zero bytes, or define the missing 2-byte field with an explicit purpose and canonical byte order. Do not silently pad/truncate at runtime. Freeze exact 24-byte vectors for both directions, epoch boundaries, and message-ID boundaries. If any implementation has already emitted packets, changing the nonce layout requires a versioned protocol change.

## 5. Codec implementation gates

Only after sections 1–4 are reviewed and testable:
- implement the exact selected AEAD using a maintained libsodium binding (XChaCha20-Poly1305; no substitution with JCA ChaCha20-Poly1305);
- derive directional keys with the final, versioned KDF context and epoch encoding;
- define nonce bytes, message-ID exhaustion, ciphertext persistence, framing, and maximum plaintext/ciphertext sizes in one normative specification;
- add deterministic interoperability vectors plus tampering, wrong-peer, wrong-epoch, replay, corruption, crash-injection, concurrent-allocation, and retransmission-byte-identity tests;
- test on real Android devices before claiming the end-to-end transport works.

## Current verified boundary

The Wi-Fi Direct PR provides a network-bound UDP transport and policy tests. A standalone durable ID allocator has been added but is not integrated with cryptographic message creation. There is still no ZPP/1 codec, authenticated key exchange, authenticated framing, replay protection, ACK/SACK, or user-facing offline send flow. CI success does not replace a two-device test.
