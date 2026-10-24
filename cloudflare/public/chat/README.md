# Zungun Chat

The installable chat lives at `/chat/`.

- Internet chat uses Zungun's identity, conversations, persistent messages and live updates.
- Create a profile with a display name. Share your pairing code, or enter another person's code to start a Zungun conversation.
- The service worker caches the static chat shell. The local outbox can retain messages while an already-authenticated page is offline, then retry them after connectivity returns.
- Offline operation is limited: identity creation, session restoration after a reload, conversation discovery, and delivery require the server. The service worker does not cache authenticated API responses or message history.
- There is no verified radio or satellite transport. A queued message is not a delivered message, and the satellite-only mode is not a satellite connection.

