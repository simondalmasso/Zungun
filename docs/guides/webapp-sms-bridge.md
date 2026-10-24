# Zungun webapp SMS bridge — integration contract

## Current implementation state

The SMS bridge is integrated into the PWA UI on the feature branch, but is **not enabled in production**. The implementation now includes:
- ZUNGUN-SMS/2 envelopes authenticated with HMAC-SHA256 and a 256-bit per-peer key.
- A passphrase-unlocked vault that encrypts per-peer phone numbers and keys at rest with AES-GCM; PBKDF2-SHA-256 (310,000 iterations) derives the encryption key. The passphrase and gateway credentials are kept in session memory, not persisted in plaintext.
- Manual peer pairing bundle import/export. Exchange the bundle only over a trusted, independent channel and verify pairing codes/phone numbers out of band. Never send the bundle or secret in SMS.
- UI controls for the gateway URL and credentials, a browser-side /inbox connectivity check, an explicit SMS enable checkbox, composer fallback when offline or in strict transport mode, incoming inbox polling, HMAC/sender/conversation validation, and duplicate suppression.
- Delivery status distinguishes gateway acceptance from confirmed recipient delivery. An ambiguous POST outcome is SMS_SEND_UNKNOWN; it must not be blindly retried.

## Gateway browser-access constraints

The PWA does not bypass browser security. From an HTTPS origin, browsers can block a plain-HTTP gateway on a LAN address due to mixed content and local-network access policy, and CORS can independently prevent requests. The UI permits HTTPS endpoints and loopback addresses for local testing, but it does not make a LAN HTTP endpoint reachable. If Chrome blocks the local endpoint, the remaining implementation requirement is a supported local companion/TLS bridge with an explicit origin allowlist; do not disable browser protections or expose the gateway to the public Internet. Gateway credentials are kept in memory for this session only.

## Pairing workflow

1. Open a Zungun conversation while the server-backed identity and conversation are available.
2. Unlock the SMS vault using a strong passphrase (12+ characters).
3. On the initiating device, enter its own E.164 phone number and the contact's E.164 number and Zungun pairing code, then create a key and export the bundle.
4. Exchange the bundle through a private, independent channel (prefer in-person QR or another end-to-end encrypted channel), not through SMS. The receiving side imports the bundle, then exports its own contact bundle using the same shared key and its own phone number/code. Exchange that bundle back and import it on the first device.
5. Compare the Zungun pairing code and phone number over an independent channel before enabling SMS.

The vault protects secrets at rest in browser storage, but it is not hardware-backed. Anyone who obtains the export bundle can use the shared secret until the pair is re-keyed. The current implementation uses a manually exchanged JSON bundle; it does not yet render a QR code.

## Delivery semantics and limitations

- ACCEPTED_BY_GATEWAY means only that the local gateway accepted the request. It does not prove carrier submission or recipient delivery.
- Network failure after a POST is SMS_SEND_UNKNOWN; the gateway may already have accepted it, so automatic retries are unsafe.
- The bridge polls the local /inbox endpoint and rejects unauthenticated/tampered envelopes, sender mismatches, conversation mismatches, and duplicate message IDs.
- The current receiver depends on the gateway exposing a complete concatenated SMS body in contentPreview. Multipart/segment behavior and carrier delivery reports have not been verified. Avoid assuming long messages are safe or free of extra charges.
- The PWA still needs an online session to restore identity and discover conversations after a reload. The SMS UI can operate while a conversation remains loaded, but it is not a complete independent offline identity/session system.

## Verification still required

1. Configure the separate SMS Gateway for Android app (https://github.com/capcom6/android-sms-gateway) on a SIM-equipped Android phone and grant SMS permissions.
2. Open Zungun on that phone, unlock the vault, configure the local gateway and run the connectivity check. Record whether CORS, mixed content or local-network permission blocks the request.
3. Pair two devices with a private channel; test authenticated send and receive, duplicate/reordered messages, invalid keys and wrong sender numbers.
4. Turn off Internet/Wi-Fi and send a real SMS to a controlled recipient, then verify the reverse direction and carrier/device delivery evidence.
5. Test ambiguous POST timeouts, multipart SMS limits, Android gateway API compatibility and actual carrier billing before considering production enablement.

No physical SIM/device test has been performed by CI. Unit/contract tests cannot prove radio, carrier or handset delivery. Keep this PR as draft until the browser-to-gateway path and two-device SIM test are verified.
