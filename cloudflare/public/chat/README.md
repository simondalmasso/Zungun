# Zungun Chat

The installable chat lives at `/chat/`.

- Internet chat uses Zungun's identity, conversations, persistent messages and live updates.
- The **Radio** link opens the official Meshtastic Web client, where a supported LoRa node can be connected over Bluetooth, USB serial or HTTP where supported.
- Radio messages are handled by Meshtastic, not by Zungun's internet conversation API. This release does not bridge the same conversation across internet and LoRa.
- Create a profile with a display name. Share your pairing code, or enter another person's code to start a Zungun conversation.
- The service worker caches only the static chat shell. It never caches authenticated API responses or message history.

The supplied `agharsallah/esp-labs-web` repository is an ESP32-S3 learning/bench-guide React app, not a Meshtastic radio transport or chat SDK, so it is not bundled into the runtime.
