# Zungun Link quickstart

This quickstart is local, deterministic and requires no paid account.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run demo:link
```

The executable fixture demonstrates one existing-style mutation through the Link contract:

1. enqueue while offline;
2. `WAIT_FOR_VALIDATED_LINK` while there is no valid Internet path;
3. constrained link sends a 312-byte critical core while an 8.4 MB required evidence object remains deferred;
4. the response is lost after receiver durable acceptance, so device state becomes `UNKNOWN` rather than success;
5. `RECONCILE_BEFORE_RETRY` queries receiver evidence before any later side-effect send;
6. durable acceptance is recovered and business side-effect count remains one;
7. a later good-link window resumes the heavy object from its checkpoint;
8. the final trace distinguishes business effect completion from required evidence completion.

The output is fixture evidence, not a production-scale or OEM background-policy claim. No external network, customer data, API key, card or paid service is used.

For a real Android app, start by wrapping one critical mutation with the explicit `Zungun.enqueue(context, request, deliveryProfile, deferredObjects, prefetchHints)` facade. Existing legacy enqueue remains supported. Add L1 Receiver Proxy or L2 native receiver semantics only when the application needs stronger durability/reconciliation evidence.
