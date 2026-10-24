# Zungun Pocket — satellite-only routing gate

## Current scope

The additive :pocket Android library defines a native satellite-network observer, a deterministic routing policy, and the contract required of a provider-specific adapter. It does **not** yet provide an end-to-end chat service or claim real satellite delivery. No default/mock adapter is shipped as a real transport.

The current production PWA and Android messenger still use the existing HTTPS Worker. They are not satellite transports and must not be represented as such.

## Routing rules

- Only Android NetworkCapabilities.TRANSPORT_SATELLITE (API 35+) counts as evidence of a satellite network.
- A generic TRANSPORT_CELLULAR, an unvalidated network, GPS/GNSS, satellite maps, and public telemetry feeds are not evidence of an app-usable satellite uplink.
- Observations older than five seconds, future timestamps, unsupported platform levels, and unknown provider data entitlement fail closed into the caller's pending state.
- Explicitly denied provider entitlement, missing relay configuration, or missing authorized adapter blocks the attempt. A verified satellite link without a configured relay is **not** queued as if waiting for the radio link.
- NET_CAPABILITY_VALIDATED is not required as proof of satellite identity. Restricted satellite networks may not pass the system's general Internet validation check. The satellite transport, freshness, provider entitlement, and a route-specific adapter must all be established independently.
- PERMIT_SATELLITE_ATTEMPT is authorization to attempt one transmission, not proof it happened. Adapter acceptance, relay acceptance, device delivery, and read state remain distinct.

The policy class returns a queue decision but deliberately does not itself persist messages or schedule background work. A caller must implement the selected product queue semantics and must never wake the terrestrial HTTPS sender from a satellite-only decision.

## Blocking requirements before a real adapter

Before any adapter can be enabled, verify the exact phone/modem, Android/OEM API behavior, operator and plan, country/region availability, permission and app-allowlisting requirements, IP-data entitlement (not SMS-only service), authorized SDK/API, relay endpoint and authentication, message encryption protocol, payload limits, delivery receipts, rate limits, and billing. The provider-specific adapter must bind requests to the supplied Network; a default-network HTTP client is forbidden.

For constrained NTN access, the consuming application may need the platform satellite-optimized manifest metadata described in the official Android documentation. A library must not declare that metadata on behalf of all consuming apps.

## Verification

The unit tests cover the deterministic fail-closed policy only. They do not prove that an emulator, phone, operator, relay, or satellite link can transmit messages. Real transmission requires a supported device/service and an authorized endpoint, followed by two-device delivery tests with Wi-Fi and terrestrial mobile data unavailable.
