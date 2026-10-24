# Wi-Fi Direct transport boundary

WifiDirectTransport is an opt-in native transport for an Android Wi-Fi Direct session. It requests a network carrying NET_CAPABILITY_WIFI_P2P, binds the UDP socket to that exact Network, and never falls back to the process default route. On Android 15/API 35 it also registers a local-network request and verifies WIFI_P2P before accepting that network. The transport exposes datagrams only; it does not claim encryption, peer authentication, delivery, or acknowledgements. The host app must obtain runtime permissions required by Android and call discoverPeers()/connect() explicitly.

The conservative UDP payload limit is 1232 bytes (IPv6 MTU 1280 minus IPv6 and UDP headers). The application protocol still needs its own framing, authenticated encryption, replay protection, ACK/SACK and deduplication. The device-level discovery/connection, runtime permission flow, and physical transfer remain to be tested on target hardware.
