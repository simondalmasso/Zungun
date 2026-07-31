# Zungun

Zungun currently contains the ZEP semantic protocol core and a stateless validation canary. It validates message envelopes; it does not yet provide end-user transport, persistence, routing, queueing, acknowledgement, or delivery.

## Active control plane

GAOS LEAN reads only:

- `/ops/POLICY.md`
- `/ops/CURRENT.json`
- the latest 20 events in `/ops/EVENTS.ndjson`
- the checkpoint referenced by `CURRENT.json`
- real remote HEAD, CI, and relevant platform state

Issues, chats, old Drive ledgers, and superseded control branches are historical only. See `docs/product-baseline.md` for the current bounded baseline.
