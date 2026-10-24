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

The current allocator implementation also rejects epoch jumps: same-peer rekey must advance by exactly one; 16-bit exhaustion requires a new peer identity namespace rather than wrap/reset.

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

## 4. Canonical nonce layout (corrected before codec implementation)

No ZPP/1 codec or packets have been emitted by this branch, so the 22-byte arithmetic defect is corrected before wire-format use. The canonical layout is:

`nonce24 = U16BE(epoch) || U16BE(message_id) || direction || 19 * 0x00`

This totals exactly 24 bytes, as required by XChaCha20-Poly1305. The five-byte prefix is epoch (unsigned 16-bit big-endian), message ID (unsigned 16-bit big-endian), and one direction byte; the remaining 19 bytes are zero.

Direction values are fixed: `0x00 = A_TO_B`, `0x01 = B_TO_A`. A/B are stable peer roles assigned at authenticated initial pairing; they must not change during a rekey. Epoch is in `0x0000..0xFFFF`; IDs `0x0000..0xFFFD` are allocatable, while `0xFFFE` is the exhausted sentinel and `0xFFFF` is reserved. The codec must reject other values and must not silently truncate or pad a nonce at call sites.

A pure Kotlin formatter and fixed-vector tests now express this layout. They do not prove the key schedule, peer authentication, nonce uniqueness across storage rollback, or the whole wire protocol. If any external build has already emitted packets using the 17-zero variant, it must use a separately versioned protocol; this repository branch contains no sender for that variant.

## 5. Codec and framing status

The current branch adds a libsodium-backed codec with:
- an 8-byte header `"ZP" || version(1) || direction(1) || U16BE(epoch) || U16BE(message_id)`;
- the 24-byte nonce above and directional `crypto_kdf_derive_from_key` contexts `ZPP1K_A_` and `ZPP1K_B_`, both exactly 8 bytes;
- XChaCha20-Poly1305-IETF, with the complete header authenticated as additional data;
- a maximum plaintext of 1208 bytes, so header + ciphertext + 16-byte tag fits the 1232-byte UDP budget;
- a per-peer ciphertext journal that persists an identity reservation before encryption and returns retransmissions from the exact stored frame bytes.

The codec accepts an era secret only as an input; it does not establish or authenticate that secret. The application must provide the verified session's expected epoch and incoming direction to the decoder. The allocator, codec, and ciphertext journal still require current-head CI and two-device validation before relying on them for user messages.

## Current verified boundary

The Wi-Fi Direct PR provides a network-bound UDP transport, policy tests, a standalone durable message-ID allocator, nonce encoding, and the initial ZPP/1 AEAD codec. The offline authenticated key exchange, persistent receiver-side replay/dedup ledger, ACK/SACK reliability protocol, and user-facing offline send flow remain open. Protection against full-snapshot rollback by an attacker able to restore valid app files and retain the Android Keystore key also remains outside the local journal's guarantee. CI success does not replace a two-device test.
