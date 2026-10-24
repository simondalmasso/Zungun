# Zungun Chat

The installable chat lives at `/chat/`.

- Internet chat uses Zungun's identity, conversations, persistent messages and live updates.
- **Radio** opens the official Meshtastic Web client for a compatible LoRa node connected by Bluetooth, USB serial or HTTP where supported. Radio messages are not yet bridged into Zungun internet conversations.
- **Señales** opens the public SatNOGS observation network, where distributed ground stations publish satellite reception attempts and results. It is a public signal/telemetry view, not a free satellite messaging channel and not a connection from Zungun chat to a spacecraft.
- Actual RF reception requires suitable local SDR/radio and antenna hardware. Transmitting requires compatible hardware and compliance with applicable radio regulations.
- Create a profile with a display name. Share your pairing code, or enter another person's code to start a Zungun conversation.
- The service worker caches only the static chat shell. It never caches authenticated API responses or message history.

The supplied `agharsallah/esp-labs-web` repository is an ESP32-S3 learning/bench-guide React app, not a Meshtastic radio transport or chat SDK, so it is not bundled into the runtime.
