# Zungun Pocket — beta PWA

Static, dependency-free prototype served under `/chat/`. It is intentionally local-only: no backend calls, no SMS sending, no server-side account, no satellite transport, and no automatic network fallback. Messages remain in the current page session; they are not transmitted to another person.

## Browser behavior
- Responsive mobile UI; designed for Chrome Android.
- Manifest and service worker for install/offline shell where supported.
- Phone number is demo identity only; no OTP is sent or verified.
- Contact Picker is optional and user-initiated; browser support varies.
- No third-party scripts, fonts, analytics, or API calls.

## Deploy note
This adds static assets to the existing guarded public-site source. It does not change a Worker route, secrets, deployment settings, or production branch. Review and merge the PR before using the existing guarded deployment process. Real messaging requires a separate, explicit transport/backend design and real satellite-capability validation.
