# Zungun Link — semantic connectivity runtime

Zungun Link is an additive DeliveryProfile v2 path above the existing durable operation outbox. It does not replace TCP/QUIC, Android connectivity, the receiver, signed receipts, reconciliation, or Witness. It decides **when and how an already durable operation may advance** while preserving the distinction between planned, sent, durably accepted, application effect, and final evidence.

## Guarantees and non-guarantees

Link guarantees deterministic planning for a fixed planner version and fixed inputs, fail-closed expiry/policy handling, explicit retry contracts, exact-base deltas only, content-addressed deferred objects, resumable checkpoints, and reconciliation before a second side-effect when the previous result is ambiguous. Link does not claim that a network is reliable, that a send implies receipt, or that a durable receipt implies business effect unless the signed application outcome proves it.

`NO_AUTOMATIC_RETRY` blocks automatic side-effect resends across process death/reboot. `RECONCILE_BEFORE_RETRY` converts `UNKNOWN`/interrupted delivery into a receiver query before any later send. A bare receiver 404 is `NOT_FOUND_UNBOUNDED` and never authorizes a retry. Only an authoritative bounded-negative result may reopen the send path.

## Android data path

`Zungun.enqueue(request, deliveryProfile, deferredObjects)` computes the same stable operation identity used by v1. Operation, initial Witness chain, Link profile/hash, dependencies and deferred descriptors are committed in one Room transaction before WorkManager is scheduled. Legacy `enqueue(request)` continues through the existing worker; DeliveryProfile v2 uses `LinkDeliveryWorker` over the same `operations` table.

Room v4 is owned by Witness. Link advances the schema to v5 with additive tables for operation Link state, link observations, transmission plans, deferred objects, dependencies and transfer checkpoints. No destructive migration is used.

Connectivity observation uses `registerDefaultNetworkCallback`; no battery polling and no SSID/subscriber/telephony identifiers are stored. `VALIDATED`, captive-portal, metered, temporarily-unmetered, congested, roaming, VPN, suspended, bandwidth estimates and process-local network key are inputs. Unvalidated connectivity is not success by default.

## Planner and scheduler

The pure TypeScript and Kotlin planners consume DeliveryProfile v2, LinkSnapshot, payload shape, transport capabilities and prior ambiguity. The shared corpus `testdata/link-planner-v1.vectors` fixes expected decision, reasons, bytes, profile hash, snapshot hash and plan ID for both implementations.

CRITICAL always outranks BULK. Dependencies must complete before dependent work. On a good link, old BULK may be promoted ahead of HIGH/NORMAL after a finite non-bulk dispatch budget; it still cannot displace CRITICAL. Large deferred objects are transferred independently so one object cannot monopolize the side-effect queue.

## Payload, delta, resume and prefetch

Critical core and deferred objects have separate commitments. Deferred objects are SHA-256 content-addressed, streamed with bounded memory, chunk-hashed and atomically committed. Checkpoints are monotonic and chunk-aligned until final completion; each persisted checkpoint includes the SHA-256 of the confirmed prefix. Corruption or offset regression fails closed.

Delta application is allowed only when the declared base hash exactly matches the available base. There is no fuzzy merge. Otherwise Link uses a safe full fallback or defers.

Prefetch is declarative and allowlisted. It is not an authority to execute a side effect.

## Assurance tiers

- `L0_LINK_ONLY`: planning/scheduling only. No receiver durability claim.
- `L1_RECEIVER_PROXY`: allowlisted route IDs, durable idempotency record before invocation, caller-host choice prohibited, credential/header isolation, request/response bounds, redirect refusal and reconciliation hook.
- `L2_NATIVE_RECEIVER_EFFECT`: native receiver durable acceptance plus receiver query and signed application outcome.

A transport cannot advertise L1 without durable receipt support or L2 without receiver-query support. Hedging is disabled unless the operation is explicitly `SAFE_IDEMPOTENT`, idempotency is required, and the adapter explicitly supports hedging.

## L1 proxy security boundary

The client supplies a route ID and relative path, never an origin. Route origins are HTTPS, fixed by operator configuration, and literal loopback/private/link-local IPv4/IPv6 targets are rejected. Path traversal (including double encoding), header injection, caller Authorization/Cookie/Host, redirects, oversized bodies/responses and excessive headers fail closed. Upstream response bodies are not persisted by default; only bounded metadata and hashes are retained.

DNS names in route configuration remain an operator trust boundary: production deployments should pin approved DNS/egress policy at infrastructure level to prevent DNS rebinding. This implementation does not claim network-layer SSRF isolation by itself.

## Witness and proof

Link appends evidence such as `LINK_SNAPSHOT_OBSERVED`, `TRANSMISSION_PLAN_CREATED`, `CRITICAL_CORE_SENT`, `HEAVY_OBJECT_DEFERRED`, `RECONCILIATION_STARTED`, `RECONCILIATION_RESULT`, and deferred-transfer checkpoints/completion. Witness remains the single evidence chain. Link records never turn planned/sent/accepted/effect/final-evidence into synonyms.
