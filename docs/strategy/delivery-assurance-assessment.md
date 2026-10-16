# Zungun Delivery Assurance — strategic assessment

**Review date:** 2026-10-16  
**Status:** Conditional product thesis; commercial validation is not established by this repository.  
**Decision scope:** Whether to pursue an Android SDK and receiver protocol for durable delivery of critical app operations under intermittent, constrained, or satellite-enabled connectivity.

## Executive verdict

**CONDITIONAL GO for a narrow, evidence-led pilot; NO-GO for claiming that Zungun is already a necessary infrastructure standard.**

The technical problem is real: Android can persist and retry background work, but the application still has to define idempotency, distinguish an uncertain timeout from a failed side effect, reconcile with the receiver, and prove what happened. That gap can matter for high-cost field operations. It is not universal: Firebase, PowerSync, Ditto, Couchbase Lite, and customer-built outbox patterns already solve overlapping parts of offline persistence, synchronization, or retry.

The product wedge should therefore be **backend-agnostic assurance for critical mutations**, not generic offline sync and not “satellite connectivity.” The repository's Link and Witness architecture points toward that wedge. No public source reviewed here proves buyer willingness to pay for Zungun specifically, and no paid pilot, independent comparative benchmark, production SLA, or procurement relationship is recorded here.

## Required decision fields

```text
PROBLEM_REAL=YES_FOR_SPECIFIC_HIGH-COST_OPERATIONS; NOT EVERY MOBILE APP
WILLINGNESS_TO_PAY=UNPROVEN; MUST BE MEASURED WITH BUYERS
GLOBAL_MONETIZATION=POSSIBLE_IF_FAILURE_COST_AND_INTEGRATION_SAVINGS_ARE_MEASURED
JAPAN_MARKET_FIT=PLAUSIBLE_FOR_FIELD_OPERATIONS; NOT_VALIDATED
DOCOMO_ECOSYSTEM_RELEVANCE=ADJACENT_SIGNAL; NO_PARTNERSHIP_OR_BUYER_EVIDENCE
FEATURE_OR_PRODUCT=PRODUCT-SHAPED_TECHNICALLY; COMMERCIAL_PRODUCT_NOT_YET_PROVEN
CURRENT_CHAIN_POSITION=ANDROID_APP_SDK_AND_RECEIVER_SEMANTICS_ABOVE_TRANSPORT
POTENTIAL_CHAIN_POSITION=INTEROPERABLE_ASSURANCE_LAYER_FOR_CRITICAL_MUTATIONS
NECESSARY_ACTOR_TODAY=NO
PATH_TO_NECESSARY_ACTOR=OPEN_PROTOCOL + MULTI-BACKEND_RECEIVERS + REPRODUCIBLE_BENCHMARK + PRODUCTION_REFERENCES + AUDITABLE_RECEIPTS
DEFENSIBILITY=LOW_TO_MODERATE_UNTIL_ADOPTION_AND_INDEPENDENT_EVIDENCE_ACCUMULATE
ORGANIC_SEARCH_POTENTIAL=MODERATE_FOR_SPECIFIC_FAILURE_MODES; CROWDED_FOR_GENERIC_OFFLINE_SYNC
BEST_GLOBAL_ICP=ANDROID_FIELD-OPERATIONS_APPS_WITH_CRITICAL_WRITES_AND_EXISTING_BACKENDS
BEST_JAPAN_ICP=LOGISTICS_OR_MAINTENANCE_TEAMS_OPERATING_IN_LOW-COVERAGE_AREAS_WITH_COSTLY_REVISITS
BUYER=ENGINEERING_PLATFORM_OWNER_OR_FIELD-OPERATIONS_SYSTEMS_OWNER_WITH_A_MEASURED_FAILURE_COST
BILLING_UNIT=ANNUAL_PLATFORM_MINIMUM + ACTIVE-DEVICE / OPERATION-VOLUME BANDS; VALIDATE
BIGGEST_COMPETITOR=DIY_WORKMANAGER_PLUS_BACKEND_OUTBOX_AND_IDEMPOTENCY
BIGGEST_EXISTENTIAL_RISK=BUYERS_SEE_THIS_AS_A_SMALL_FEATURE_AND_PREFER_EXISTING_PRIMITIVES
UNFAIR_ADVANTAGE_REQUIRED=MEASURABLY_FEWER_LOST_OR_DUPLICATED_EFFECTS_WITH_LOW_INTEGRATION_COST_AND_NO_BACKEND_LOCK-IN
GO_OR_NO_GO=CONDITIONAL_GO_FOR_NARROW_PILOTS; NO-GO_FOR_STANDARD/NECESSARY-INFRASTRUCTURE_CLAIMS
CONFIDENCE=MEDIUM_ON_TECHNICAL_GAP; LOW_ON_WILLINGNESS_TO_PAY
```

## What the evidence supports — and what it does not

### Problem and substitute baseline

- Android's [WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent) persists scheduled work across app/process/device restarts, supports network constraints, and provides configurable retries and exponential backoff. It is a strong free primitive, not a product Zungun can claim to replace.
- [Cloud Firestore offline persistence](https://firebase.google.com/docs/firestore/manage-data/enable-offline) and [Firebase Realtime Database offline capabilities](https://firebase.google.com/docs/database/android/offline-capabilities) already cache data and queue writes. Firestore documents last-write-wins for multiple changes to the same document. This is credible competition when a buyer already uses Firebase.
- [PowerSync](https://powersync.com/) provides local SQLite, queued writes, retry, and synchronization across several backend database families. [Ditto](https://www.ditto.com/solutions/offline-first-architecture) and [Couchbase Lite](https://docs.couchbase.com/couchbase-lite/current/) offer broader offline-first storage/sync and conflict-resolution capabilities. They are especially relevant when the buyer's problem is replicated application state, not just a critical command or mutation.
- [AWS Durable Execution](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/) and [Restate](https://restate.dev/blog/why-we-built-restate) address durable execution, idempotency, and retry semantics primarily around server-side workflows. They are adjacent architecture references, not drop-in replacements for an Android SDK that must survive offline periods.
- Therefore, “durable queue + retry” is not a defensible differentiator by itself. The more specific potential wedge is a portable operation identity and receiver contract, reconciliation after ambiguous delivery, explicit assurance levels, and inspectable evidence separating transport, receiver acceptance, business effect, and final outcome.

### Buyer economics

A buyer is most likely to pay when a lost or duplicated operation causes a measurable cost: a repeat truck roll, failed delivery proof, missed inspection, duplicate charge, compliance gap, manual reconciliation, or a service-level penalty. These are candidate cost categories, not measured Zungun customer outcomes.

The economic test is:

`annual_avoidable_loss + manual_reconciliation_cost > Zungun_total_cost + integration_and_operations_cost`

Do not infer willingness to pay from the existence of unreliable connectivity. The buyer must provide a baseline incident rate, cost per incident, current workaround, and authority to fund a pilot. No reviewed public source establishes that a buyer would pay Zungun's proposed price.

### Japan and NTT DOCOMO / satellite relevance

- NTT DOCOMO and NTT DOCOMO BUSINESS announced **docomo Starlink Direct** for launch on 2026-04-27. The initial service includes messaging, location sharing, selected file transfer and data use by supported apps; the April announcement says the service would initially be available without an extra charge for eligible customers. [Official announcement](https://www.ntt.com/about-us/press-releases/news/article/2026/0402.html).
- On 2026-08-14, DOCOMO announced an agreement for Starlink Mobile V2, with voice, high-speed internet and IoT direct-to-device capabilities planned for fiscal 2028. This is a roadmap, not a current capability or a Zungun partnership. [Official announcement](https://www.ntt.com/about-us/press-releases/news/article/2026/0814.html).
- Japan's Ministry of Land, Infrastructure, Transport and Tourism continues to identify labor and last-mile logistics constraints. Its 2025 report describes persistent transport-capacity pressure, including a projected FY2030 shortfall if no further measures are taken. This supports the importance of logistics productivity; it does **not** prove demand for a third-party delivery-assurance SDK. [MLIT 2025 report](https://www.mlit.go.jp/hakusyo/mlit/r06/hakusho/r07/data/R7_English%20Summary.pdf) and [last-mile policy summary](https://www.mlit.go.jp/report/press/tokatsu01_hh_000952.html).
- Japan is a plausible discovery market for mobile field operations and constrained-connectivity cases. A DOCOMO partnership, procurement path, regulatory qualification, or willingness to pay has not been verified. Treat satellite as a useful stress case and distribution hypothesis, not as the sole ICP.

## Product boundary and chain position

```text
Field / enterprise Android app
        |
        v
Zungun SDK: durable operation identity + local queue + Link planning
        |
        v
Android scheduling and transport adapters (e.g. WorkManager / HTTPS)
        |
        v
Wi-Fi / cellular / NTN or satellite service
        |
        v
Customer backend receiver: durable idempotency + query/reconciliation
        |
        v
Business effect
        |
        v
Receipt / Witness evidence returned to the app and operations tooling
```

Operators and satellite providers control network access and coverage; Zungun does not control the radio layer or make a network reliable. Zungun sits at the application/receiver boundary. It can make the operation's delivery contract more explicit when both the SDK and receiver participate, but it cannot promise universal exactly-once business execution for arbitrary endpoints.

The existing repository separates several assurance levels:

- **L0 — Link only:** scheduling and delivery planning; no receiver-durability claim.
- **L1 — Receiver Proxy:** configured routes, durable idempotency before invocation, and a reconciliation hook.
- **L2 — Native receiver/effect:** receiver query plus a signed application outcome where the receiving system can actually prove it.

Keep these boundaries explicit in product copy, APIs, metrics and sales material. Transport success, HTTP 2xx, durable receiver acceptance and business-effect completion are not synonyms.

## Competitive position

| Alternative | Strong at | Zungun must prove beyond it |
|---|---|---|
| WorkManager + app outbox | Durable scheduling, network constraints, retry/backoff; low cost | Stable operation contract, safe ambiguity handling, receiver reconciliation and evidence across existing backends |
| Firebase offline features | Local persistence and queued writes inside Firebase's model | Value for non-Firebase backends and side-effecting REST mutations |
| PowerSync | Local SQLite, upload queue, multi-backend data sync | Why command/effect assurance is needed in addition to database synchronization |
| Ditto / Couchbase Lite | Offline-first data, synchronization, conflict handling | Better fit for critical API operations without forcing a new replicated data layer |
| AWS Durable Execution / Restate | Durable server-side workflow execution and retry semantics | A small, mobile-first SDK/receiver contract that tolerates long offline periods and leaves the backend choice to the customer |
| Customer-built idempotency/outbox | Exact fit for a known app and backend; no new dependency | Lower lifecycle cost, fewer incidents, portable evidence, and simpler integration than maintaining the custom system |

The strongest substitute is often not a named vendor. It is a competent engineering team implementing a durable queue, an idempotency key, and a receiver-side ledger. Zungun loses if its integration cost, operational burden, or proof quality is not clearly better.

## Commercial design

**Best initial ICP:** an enterprise with an existing Android field app and REST backend, frequent poor-connectivity windows, side-effecting critical operations, and a quantified cost for failed or duplicated actions. Start with one workflow, one receiver, and one buyer who owns both the failure metric and the budget.

**Likely buyer:** engineering/platform leadership, enterprise architecture, or the owner of the field-operations system. Operations leadership can sponsor the problem, but engineering and security will control integration and approval.

**Pricing hypothesis:** an annual platform minimum plus active-device and operation-volume bands. A pure “per ACK” fee is premature: ACK semantics differ by assurance tier, and the customer must understand what is being metered. Test pricing with buyers rather than treating this as established willingness to pay.

**Distribution hypothesis:** publish a backend-neutral protocol, Android/Maven quickstart, reference receiver, reproducible chaos benchmark, and searchable incident-focused docs. Organic discovery may work for high-intent searches such as “Android offline POST retry duplicate request” or “idempotent mobile outbox”; generic “offline-first sync” is crowded.

## Three scenarios

1. **Failure:** the buyer's existing WorkManager/outbox is sufficient; the receiver must be changed anyway; integrations become bespoke; no independent benchmark shows better outcomes; no paid pilot converts. Stop expanding the managed service and retain the protocol/runtime as an open technical project.
2. **Profitable niche product:** two or more design partners show material reduction in manual reconciliation or failed field operations; integration is repeatable; receiver adapters cover common backends; buyers pay an annual minimum for evidence, monitoring and support. Grow by vertical and integration, not by claiming universal necessity.
3. **Infrastructure standard:** multiple unrelated SDKs/backends implement the same open operation/receipt contract; independent conformance tests become a procurement requirement; third-party tools consume Witness/Proof Bundles; replacing the protocol creates measurable migration and audit costs. This is a long-term possibility, not the current status.

## Five minimum evidence gates before scaling

1. **Reproducible benchmark:** compare direct HTTP, a fair Room + WorkManager + backend-outbox baseline, and Zungun under the same receiver semantics. Include request loss, response loss after commit, process death, reboot, long offline periods, metered/weak links and constrained throughput. Publish code, environment, raw results and hashes.
2. **Correctness gate:** for idempotent test endpoints, report lost operations, duplicate business effects, unknown outcomes and reconciliation results across at least 1,000 operations per defined fault profile. Target zero duplicate effects and zero unaccounted committed operations; any failure must be reported, not filtered out.
3. **Economic baseline:** at least two design partners quantify incident frequency, cost per incident, manual reconciliation hours and current workaround before deployment. Record the before/after method and uncertainty.
4. **Adoption gate:** demonstrate a repeatable integration path with bounded engineering effort, documented backend requirements, security review, migration/rollback steps and an explicit compatibility matrix. Set and publish the target integration time before measuring it.
5. **Payment and retention gate:** obtain at least one paid pilot or signed budget-backed evaluation, then test renewal/expansion intent against observed value. Interviews, likes, stars, satellite headlines and free trials alone do not count as monetization evidence.

## Decision

Continue with a narrow validation path: open SDK/protocol, reference receiver, benchmark, one critical operation, and design partners in logistics or field service. Keep Link and Witness as technical components. Position **Delivery Assurance** as the product hypothesis, not as an established standard. Do not build an expensive managed cloud, pursue operator partnership as the primary plan, or claim “necessary infrastructure” until the five gates produce evidence.

## Sources reviewed (public documentation)

- Android WorkManager — https://developer.android.com/develop/background-work/background-tasks/persistent
- Firebase Firestore offline persistence — https://firebase.google.com/docs/firestore/manage-data/enable-offline
- Firebase Realtime Database offline capabilities — https://firebase.google.com/docs/database/android/offline-capabilities
- PowerSync — https://powersync.com/
- Ditto offline-first architecture — https://www.ditto.com/solutions/offline-first-architecture
- Couchbase Lite — https://docs.couchbase.com/couchbase-lite/current/
- AWS Durable Execution idempotency — https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/
- Restate durable execution — https://restate.dev/blog/why-we-built-restate
- NTT DOCOMO / DOCOMO BUSINESS, docomo Starlink Direct (2026-04-02) — https://www.ntt.com/about-us/press-releases/news/article/2026/0402.html
- NTT DOCOMO / DOCOMO BUSINESS, Starlink Mobile V2 roadmap (2026-08-14) — https://www.ntt.com/about-us/press-releases/news/article/2026/0814.html
- Japan MLIT, 2025 logistics/transport-capacity outlook — https://www.mlit.go.jp/hakusyo/mlit/r06/hakusho/r07/data/R7_English%20Summary.pdf
- Japan MLIT, last-mile logistics recommendations (2025-11-07) — https://www.mlit.go.jp/report/press/tokatsu01_hh_000952.html

Public documentation establishes substitute capabilities and relevant operating conditions; it does not establish Zungun-specific demand, customer economics, partnership, certification, or production performance.