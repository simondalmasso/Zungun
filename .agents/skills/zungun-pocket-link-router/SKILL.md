---
name: zungun-pocket-link-router
description: Design, implement, and verify Zungun Pocket's tiny, privacy-preserving transport router for constrained connectivity. Use when planning or changing offline queues, Android network capabilities, satellite/NTN adapters, route selection, delivery evidence, or geospatial context. Never imply that an agent or GPS creates satellite uplink.
---

# Zungun Pocket Link Router — Super Skill

## Mission

Build the smallest dependable routing layer for Zungun Pocket. It chooses among **verified, currently available transports** and preserves durable message state and honest delivery evidence. It must work without an LLM in the critical path, avoid unnecessary cloud calls, and never treat location data as a communication channel.

This skill is a design/implementation contract, not a satellite service, provider credential, hardware driver, or deployment authorization.

## Hard constraints

1. **No invented connectivity.** A tiny agent cannot create an RF link, SIM entitlement, satellite modem, NTN carrier support, or provider account. GPS/GNSS reception is not a transmit path.
2. **No false delivery claims.** Distinguish QUEUED_LOCAL, ROUTE_SELECTED, TRANSMISSION_ATTEMPTED, TRANSPORT_ACCEPTED, REMOTE_RECEIVED, and APP_ACKNOWLEDGED. Only report states proven by the adapter's evidence.
3. **PWA boundary.** Chrome Mobile web apps cannot assume access to native telephony, arbitrary radio hardware, Android SatelliteManager, SMS sending, or full contacts. The PWA may enqueue locally and explain limitations; privileged transport integration belongs in a native Android module or a supported provider SDK.
4. **Cloudflare boundary.** Static assets may be hosted on Cloudflare, but do not route every user's messages through the owner's personal Worker by default. Any shared relay must be a separately chosen, documented, metered, authenticated service with a threat model and explicit operator consent. Never quietly add Worker/API calls to the PWA.
5. **No implicit fallback.** If no transport is verified, keep the message queued and show NO_SUPPORTED_TRANSPORT; do not silently send over Wi-Fi/cellular when the user selected satellite-only.
6. **Deterministic core.** Route selection must be pure, testable code. An LLM may explain choices or help operators inspect logs, but must not be the authority for security policy, delivery claims, provider credentials, or retry decisions.
7. **Privacy by default.** Do not collect continuous GPS, contact lists, SSIDs, subscriber identifiers, or precise location for routing unless a specific feature requires it and the user consents. Do not use GeoINT/OSINT repositories to locate message recipients.
8. **Durability before work.** Persist message ID, payload hash, creation time, expiry, policy, attempt history, and current evidence before scheduling background work. Use stable idempotency keys and reconcile ambiguous sends before retrying side effects.
9. **Safe retries.** Exponential backoff with jitter only for adapter-declared retryable errors. Enforce TTL, byte budgets, retry ceilings, and user cancellation. Never retry an ambiguous non-idempotent send without authoritative reconciliation.
10. **Fail closed.** Unknown hardware/provider capability is UNKNOWN, not supported. Expired credentials, invalid signatures, unsupported region, revoked entitlement, and unbounded receiver responses must not be interpreted as success.

## Routing contract

Implement a pure function conceptually equivalent to:

    plan(message, policy, capabilities, linkSnapshot, history, now) -> Plan

Inputs:
- Message metadata: stable ID, byte size, priority, expiry, content type, encryption state.
- Explicit user policy: AUTO, IP_ALLOWED, SATELLITE_ONLY, or STORE_ONLY.
- Capability records supplied by real adapters: transport ID/type, supported payload size, bidirectional or uplink-only, provider/region/entitlement status, availability timestamp, estimated cost, and supported acknowledgements.
- Link observations: validated/unvalidated, metered, bandwidth/latency if available, roaming, power state, and last observation age.
- Prior attempts and any ambiguous outcome.

Output must include:
- selected adapter or NONE;
- stable reason codes;
- estimated payload/cost class only when backed by evidence;
- next retry/reconciliation time, if any;
- expiry decision;
- evidence requirements for the next state;
- plan version and deterministic hash.

Never make an actual network call inside the planner. Adapters execute plans separately and return structured results.

## Route policy

1. Validate message schema, TTL, payload size, policy and encryption requirements.
2. Reject expired messages; never extend TTL silently.
3. Filter out adapters not explicitly installed, enabled, entitled, region-supported, and currently capable.
4. Enforce the user policy before scoring candidates. SATELLITE_ONLY excludes terrestrial IP; STORE_ONLY performs no transmission.
5. Prefer a deterministic policy table over a model. Candidate factors can include urgency, max payload, expected delay, cost cap, battery, link validity, privacy, and acknowledgement support.
6. If a transport only supports store-and-forward or uplink-only messages, mark that limitation in the plan. Do not imply a bidirectional chat session.
7. Select one adapter by default. Hedging/multi-send is forbidden unless the message is explicitly safe-idempotent and the user/policy authorizes duplicate transmission.
8. Persist the plan and its reason codes before execution.
9. On success, store adapter receipt/evidence. A modem/provider acceptance is not proof that the recipient received or read the message.
10. On timeout after possible send, set outcome to UNKNOWN; reconcile with the provider/receiver if supported. Do not blindly resend.
11. When no supported transport exists, preserve the queue and show the exact limitation.

## Satellite/NTN adapter gate

Do not implement a pretend SatelliteAdapter. Before writing one, collect and verify all of:
- actual device/modem model and interface;
- OS API and permission requirements;
- provider and service plan;
- region/country availability and regulatory conditions;
- supported direction (uplink/downlink), payload, throughput and delivery guarantees;
- public, authorized SDK/API documentation;
- authentication and credential-storage method;
- sandbox/test equipment or a provider test environment;
- error codes, rate limits, billing and cancellation behavior.

For Android, inspect the official Android SDK/API documentation for the device's OS level and check real runtime capabilities. A platform API's existence does not prove the phone has a compatible modem, carrier entitlement, or regional service. A PWA must not claim to call this native API directly. If any required gate is missing, provide a capability probe and a clearly labelled mock adapter for tests only; do not ship the mock as a real transport.

## Minimal architecture

- PWA shell: static HTML/CSS/JS; local queue only; no per-message call to the owner's Worker.
- MessageStore: durable native database for the Android runtime; IndexedDB only for web-local drafts/queue where supported.
- CapabilityRegistry: adapter-reported capabilities with expiry and provenance.
- Planner: pure deterministic function, no I/O, no LLM dependency.
- Adapter interface: probe(), send(envelope), query(messageId) when supported, parseReceipt(); each result must include source, timestamp and evidence.
- Scheduler: WorkManager on Android; service worker only for supported web background work, without assuming continuous execution.
- EvidenceLedger: append-only state transitions with message ID, plan hash, adapter ID, attempt number, receipt digest and timestamps; redact secrets and sensitive location.
- Optional relay: independent operator-owned service only when explicitly selected. Use end-to-end encryption, authentication, quotas, abuse protection, data retention limits and cost controls.

## Security rules

- Never execute arbitrary shell commands, downloaded scripts, or MCP tools in the message-routing path.
- Treat MCP remote access, terminals, tunnels, reverse proxies, website-to-API reverse engineering, and agent browser automation as development/operations tooling, not radio or satellite adapters.
- Do not reverse-engineer provider/private APIs to bypass authentication, entitlement, rate limits, or terms. Use documented, authorized interfaces.
- No credentials in PWA assets, repository, logs, telemetry, prompts or test fixtures. Do not read or print secret values.
- Enforce payload size, request deadlines, TLS, origin/route allowlists, redirect policy, replay protection and signature validation where applicable.
- Keep geospatial features optional and separate. Location can inform user-selected regional eligibility only when necessary; it must not become a recipient-tracking feature.
- Use synthetic locations and mock receipts in CI. Never test delivery by sending unsolicited messages.

## Repository workflow

Before changing code:
1. Read docs/link-architecture.md, docs/architecture/protocol.md, docs/architecture/reconciliation.md, docs/architecture/security.md, docs/architecture/threat-model.md, docs/guides/android-runtime.md, and docs/guides/public-site.md.
2. Inspect the existing Link planner, delivery profile, durable outbox, Witness evidence chain, Android runtime, and route table. Extend these; do not create a competing queue or evidence ledger.
3. Read the active branch, PR state, deployment workflow and guarded ORDER-083 release script. Do not bypass release gates or deploy from a feature branch.
4. Make the smallest additive change on a feature branch. No destructive database migrations, no production secrets, no route remapping without route tests.
5. Add tests first for route policy, unknown capability, expiry, payload bounds, duplicate suppression, ambiguous timeout, reconciliation, satellite-only no-terrestrial fallback, and no-transport queue preservation.
6. Run repository-prescribed checks. Record exact commands and outcomes. If a command could not run, report it as not run; never infer pass.
7. Test the PWA at desktop and mobile sizes. Confirm no unexpected network calls and that the static shell works offline after first successful load.
8. For production, use only the existing guarded ORDER-083 deployment path, with its manifest/source identity checks and post-deploy browser checks. Never upload a direct Worker replacement as a shortcut.

## Acceptance tests

The implementation is not complete unless all relevant tests prove:
- Same inputs produce the same plan and plan hash.
- No adapter enabled/entitled means no transmission.
- SATELLITE_ONLY never selects Wi-Fi, cellular IP, or a cloud relay.
- Unknown/stale capability is rejected or re-probed.
- Unsupported payload size cannot be sent.
- Expired messages never send.
- Adapter acceptance is not labelled remote delivery.
- Timeout after possible send produces UNKNOWN and reconciliation before a risky retry.
- Duplicate attempts reuse the stable message/idempotency ID.
- No transport leaves a durable queued message and visible explanation.
- PWA emits no telemetry/API/Worker requests beyond explicitly documented static asset loading.
- Logs contain no phone numbers, message plaintext, tokens, contact lists or precise coordinates.
- All mocks are visibly marked test-only and cannot be selected in production.

## Assessment of the supplied repositories

Use repositories only for the job they actually perform; popularity is not proof of suitability.

| Repository | Suitable use | Not suitable for |
| --- | --- | --- |
| obra/smallest-agent | Inspiration for a tiny shell-driven agent and constrained tool loop. Audit all shell permissions before reuse. | Satellite radio access, a mobile transport SDK, or safe routing by itself. |
| google/artemis | Android UI automation and repeatable device workflow testing. Useful for QA of the Android app if the environment supports it. | A runtime satellite API or production messaging transport. |
| ading2210/linuxpdf | Interesting RISC-V/Linux-in-a-PDF emulator experiment. | Running a persistent Android/PWA background agent or accessing phone radio hardware. |
| AmirAliManzar/remote-access-mcp | Optional authorized development/admin access to a Linux machine after security review. | A user-facing message relay or satellite transport. High-impact remote shell access must remain outside the router. |
| eneskirca/nodeterm | Developer terminal/agent orchestration. | Mobile end-user transport or satellite link. |
| wangwanjie/gately | Gateway/reverse-proxy concepts for operator infrastructure. | Satellite access; adding it does not avoid cloud cost or create a direct device link. |
| goodnight000/api-anything, kalil0321/reverse-api-engineer | Research-only exploration of website APIs where explicitly authorized. | Production provider integration via undocumented/private APIs or bypassing entitlements. Prefer official SDKs. |
| ggml-org/llama.cpp, microsoft/BitNet | Optional local inference for later human-facing summaries/classification on suitable hardware. | Required routing logic; they add complexity and do not enable connectivity. |
| oldcircle/geo-sleuth, radioactivetobi/geo-recon, jimaek/geolocation-tool, ni5arga/sightline, cipher387/osintmap, marouane53/GeoINT, opengeos/geoai-skills, opengeos/leafmap, opengeos/segment-geospatial | Separate, opt-in geospatial analysis, mapping, or authorized OSINT workflows. | Satellite communications, recipient routing, modem control, or proof of coverage. Geo-sleuth estimates photo origin; IP geolocation is approximate and not device radio state. |
| vllm-project/vllm, NVIDIA/TensorRT-LLM, sgl-project/sglang, deepspeedai/DeepSpeed | Server inference infrastructure at scales/hardware that justify it. | A tiny client agent; these are far too heavyweight for the proposed phone/PWA routing core. |

The list above is an initial suitability review based on repository descriptions and metadata, not a full code-security audit. Review licenses, dependencies, current code, release history and threat model before importing any code.

## What to investigate for real satellite messaging

Search for a documented, authorized adapter for the exact provider/hardware actually available to the target user. Useful research categories:
- Android's official satellite APIs and their device/provider gates;
- documented satellite IoT/modem SDKs (for example, the specific vendor's SBD/NTN modem API when such hardware is deliberately part of the product);
- 3GPP NTN device, operator and service requirements;
- provider sandbox, regional availability, payload, cost and delivery receipts.

Do not pick a provider based on a GitHub demo alone. The correct provider cannot be selected until device/hardware, service, budget and geography are known. This skill intentionally does not claim that a compatible direct-to-satellite service is available on the current target phone.

## Required output when this skill is invoked

Return:
1. verified facts vs unknowns;
2. a short suitability decision for each candidate repository;
3. current architecture and exact integration point;
4. proposed additive file changes;
5. test matrix with commands and evidence;
6. residual risks and cost/privacy impact;
7. explicit statement whether this is a mock, local queue, IP delivery, or verified satellite delivery.

Never use “satellite connected”, “sent”, “delivered”, “encrypted”, or “offline-ready” as a product claim unless the relevant runtime evidence proves it.
