# Zungun webapp SMS bridge — integration contract

## Current scope

This module defines a versioned SMS envelope and an outbound client for the **local** API of [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway). It is a transport foundation, not a claim that Zungun SMS chat is already operational.

The primary UI remains the Zungun webapp. A separate Android SMS-gateway component with a SIM and the Android SMS permissions is required. The gateway's local HTTP API must be reachable from the browser, and the browser must permit that local request. A browser can block this because of CORS, mixed-content, or local-network access restrictions; configuring a URL does not bypass those controls.

## Wire format

Each outbound SMS body is:

`ZUNGUN-SMS/1|<conversationId>|<messageId>|<clientCreatedAtMs>|<base64url-utf8-body>`

The message ID is preserved to support receiver-side deduplication. The receiver must validate the envelope, authenticate the sender, reject replay/duplicate message IDs, and map the conversation to a verified peer before inserting the body into the chat. Do not treat the conversation ID alone as authorization.

## Delivery semantics

- `ACCEPTED_BY_GATEWAY` means only that the local gateway returned a successful HTTP response. It does not prove that the carrier sent the SMS or that the recipient received it.
- A network failure after a POST is `SMS_SEND_UNKNOWN`: the gateway may already have accepted the message. Do not automatically retry an ambiguous SMS request, because that can create duplicates.
- SMS billing, carrier delivery reports, multipart segmentation, sender-number verification, inbound message handling, and reconciliation must be wired and tested before calling this a complete transport.
- Credentials are stored in the browser's local storage by this client. Use a dedicated local gateway account and do not expose its API to the public Internet. Browser storage is not a hardware-backed secret store.

## Manual device verification still required

1. Install and configure SMS Gateway for Android on a SIM-equipped Android device; start its **Local Server** and grant SMS permissions.
2. Open Zungun in Chrome on that same device and verify that the local gateway API is reachable from the secure web origin. If the browser blocks the request, do not disable browser security; a purpose-built local bridge endpoint with explicit origin policy is needed.
3. Test a real SMS to a controlled recipient, then test the receiving-side bridge and deduplication with Internet/Wi-Fi disabled.
4. Verify send/delivery receipts separately and test ambiguous timeouts before enabling automatic fallback in the production chat.

The current Zungun PWA still relies on the server for session restoration, conversation discovery, and incoming chat synchronization. This module alone does not make those features work offline and is not yet wired into the composer or the inbound receiver.
