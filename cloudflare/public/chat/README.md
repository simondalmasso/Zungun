# Zungun Chat

The installable chat lives at `/chat/`.

- Create a profile with a display name. The server sets a same-origin session cookie.
- Share your pairing code, or enter another person's code to start a conversation.
- Messages are persisted by the existing Zungun conversation API and appear through WebSocket updates with periodic history polling as fallback.
- Incoming messages are acknowledged by the recipient client. The sender sees “Entregado” only after that acknowledgement.
- The service worker caches only the static chat shell. It never caches authenticated API responses or message history.
- The interface contains no AI claims, product explainer, routing diagnostics or SMS/WhatsApp detours.

Use the public chat URL: https://zungun.simondalmasso44.workers.dev/chat/
