# Zungun webapp SMS bridge — integration contract

## Current implementation state

The SMS bridge is integrated into the PWA UI on the feature branch, but is **not enabled in production**. The implementation now includes:
- ZUNGUN-SMS/2 envelopes authenticated with HMAC-SHA256 and a 256-bit per-peer key.
- A passphrase-unlocked vault that encrypts per-peer phone numbers and keys at rest with AES-GCM; PBKDF2-SHA-256 (310,000 iterations) derives the encryption key. The passphrase and gateway credentials are kept in session memory, not persisted in plaintext.
- Manual peer pairing bundle import/export. Exchange the bundle only over a trusted, independent channel and verify pairing codes/phone numbers out of band. Never send the bundle or secret in SMS.
- UI controls for the gateway URL and credentials, a browser-side /inbox connectivity check, an explicit SMS enable checkbox, composer fallback when offline or in strict transport mode, incoming inbox polling, HMAC/sender/conversation validation, and duplicate suppression.
- Delivery status distinguishes gateway acceptance from confirmed recipient delivery. An ambiguous POST outcome is SMS_SEND_UNKNOWN; it must not be blindly retried.

## Gateway browser-access constraints

The Android app now includes a local companion listener bound only to 127.0.0.1:8787. It accepts only the production Zungun origin, supports CORS preflight (including the local-network preflight header), requires a random per-run bearer token, and proxies only GET /inbox and POST /messages to http://localhost:8080 with the gateway credentials entered in the Android app. It does not listen on the LAN and does not expose the gateway password to the PWA. The companion is session-scoped and stops when the app activity is destroyed. The PWA must use http://127.0.0.1:8787 and the token shown in the Android app. This design is intended to avoid direct browser-to-gateway CORS failures without disabling browser protections; Chrome's local-network permission behavior still requires verification on the target device.

## Pairing workflow

1. Open a Zungun conversation while the server-backed identity and conversation are available.
2. Unlock the SMS vault using a strong passphrase (12+ characters).
3. On the initiating device, enter its own E.164 phone number and the contact's E.164 number and Zungun pairing code, then create a key and export the bundle.
4. Exchange the bundle through a private, independent channel (prefer in-person QR or another end-to-end encrypted channel), not through SMS. The receiving side imports the bundle, then exports its own contact bundle using the same shared key and its own phone number/code. Exchange that bundle back and import it on the first device.
5. Compare the Zungun pairing code and phone number over an independent channel before enabling SMS.

The vault protects secrets at rest in browser storage, but it is not hardware-backed. Anyone who obtains the export bundle can use the shared secret until the pair is re-keyed. The current implementation uses a manually exchanged JSON bundle; it does not yet render a QR code. The local companion server is covered by JVM contract tests for origin allowlisting, preflight and bearer-token enforcement, but still needs on-device Chrome validation.

## Delivery semantics and limitations

- ACCEPTED_BY_GATEWAY means only that the local gateway accepted the request. It does not prove carrier submission or recipient delivery.
- Network failure after a POST is SMS_SEND_UNKNOWN; the gateway may already have accepted it, so automatic retries are unsafe.
- The bridge polls the local /inbox endpoint and rejects unauthenticated/tampered envelopes, sender mismatches, conversation mismatches, and duplicate message IDs.
- The current receiver depends on the gateway exposing a complete concatenated SMS body in contentPreview. Multipart/segment behavior and carrier delivery reports have not been verified. Avoid assuming long messages are safe or free of extra charges.
- The PWA now stores a local snapshot of identity metadata and known conversations (no session token) so a previously loaded conversation can be selected after reload while offline. Initial identity/conversation discovery and creation of new conversations still require Internet; the local snapshot is not a server-authenticated session and does not restore online sync.

## Verification still required

1. Configure the separate SMS Gateway for Android app (https://github.com/capcom6/android-sms-gateway) on a SIM-equipped Android phone, enable Local Server, and grant SMS permissions.
2. Install the Zungun Android debug/release APK built by CI on the same phone. Open its SMS Bridge screen, enter the gateway's local-server username/password, start the companion, and keep the screen open.
3. Open Zungun in Chrome on that phone, unlock the vault, set the companion URL to http://127.0.0.1:8787, paste the temporary token shown by the Android app, and run the connectivity check. Record whether Chrome's local-network permission or the OS blocks the request.
3. Pair two devices with a private channel; test authenticated send and receive, duplicate/reordered messages, invalid keys and wrong sender numbers.
4. Turn off Internet/Wi-Fi and send a real SMS to a controlled recipient, then verify the reverse direction and carrier/device delivery evidence.
5. Test ambiguous POST timeouts, multipart SMS limits, Android gateway API compatibility and actual carrier billing before considering production enablement.

No physical SIM/device test has been performed by CI. Unit/contract tests cannot prove radio, carrier or handset delivery. Keep this PR as draft until the browser-to-gateway path and two-device SIM test are verified.
