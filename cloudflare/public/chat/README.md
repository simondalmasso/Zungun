# Zungun Pocket — beta PWA

Static PWA at `/chat/`. It keeps drafts in the browser's local storage and does not send message content to Zungun's Worker or use a per-message Zungun backend.

## What works in this beta
- Responsive shell and service-worker cache for the static interface and local routing logic.
- Local destination-number format validation (E.164); no SMS OTP is sent, the number is not verified, and no account is created.
- A local draft queue with explicit, user-triggered handoff to the device's SMS composer or a WhatsApp chat.
- SMS and WhatsApp require the user to review and confirm the send in the native app. Zungun cannot observe or claim sent, delivered, or read states.
- The route advisor uses only the browser's online/offline hint to recommend a handoff. That hint does not prove Internet reachability, carrier coverage, or satellite availability.
- Contact Picker is optional and user-initiated; browser support varies.
- No third-party scripts, fonts, analytics, API calls, WebSockets, or per-message calls to the owner's Worker.

## Satellite and fallback boundary
This PWA cannot query Android's native satellite modem APIs, transmit RF, or create a satellite uplink. SMS over satellite is only available when the device, modem, mobile operator, region and service plan support it. Opening an SMS composer is not proof that a message can be transmitted, and it is not a satellite capability probe.

## Verification and release
The local browser E2E server maps `/chat` to `/chat/` and serves the web manifest with its correct MIME type. The existing guarded public-site release workflow runs contract tests, desktop/mobile browser E2E before deploy, deploys via ORDER-083, and runs read-only live E2E after deploy.
