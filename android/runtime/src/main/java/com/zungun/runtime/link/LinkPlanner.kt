package com.zungun.runtime.link

import java.security.MessageDigest
import java.util.TreeMap

enum class LinkUrgency { CRITICAL, HIGH, NORMAL, BULK }
enum class LinkRetryContract { SAFE_IDEMPOTENT, RECONCILE_BEFORE_RETRY, NO_AUTOMATIC_RETRY }
enum class LinkPayloadStrategy { FULL_ONLY, CORE_PLUS_DEFERRED, DELTA_ALLOWED }
enum class LinkDecision { SEND_FULL_NOW, SEND_CRITICAL_CORE_NOW, SEND_DELTA_NOW, DEFER_HEAVY, WAIT_FOR_VALIDATED_LINK, PREFETCH_WHEN_GOOD, RECONCILE_BEFORE_RETRY, REJECT_BY_POLICY, EXPIRED_NO_SEND }

data class DeliveryProfileV2(
    val profileVersion: Int = 2,
    val urgency: LinkUrgency,
    val deadlineAtMs: Long?,
    val expiresAtMs: Long?,
    val maxDelayMs: Long?,
    val retryContract: LinkRetryContract,
    val idempotencyRequired: Boolean,
    val semanticRevalidationRequired: Boolean,
    val orderingKey: String?,
    val dependencies: List<String>,
    val payloadStrategy: LinkPayloadStrategy,
    val maxImmediateBytes: Int,
    val allowMetered: Boolean,
    val allowRoaming: Boolean,
    val allowCongested: Boolean,
    val allowUnvalidated: Boolean = false,
    val heavyDataPolicy: String,
    val activeProbeBudgetBytes: Int,
    val transportAllowlist: List<String>,
    val receiptRequirement: String,
    val evidenceRequirement: String,
)

data class LinkSnapshot(
    val snapshotId: String,
    val observedAtMs: Long,
    val maxAgeMs: Long,
    val hasNetwork: Boolean,
    val internetCapable: Boolean,
    val validated: Boolean,
    val captivePortal: Boolean,
    val metered: Boolean,
    val temporarilyUnmetered: Boolean,
    val congested: Boolean,
    val roaming: Boolean,
    val vpn: Boolean,
    val suspended: Boolean,
    val downstreamKbps: Int?,
    val upstreamKbps: Int?,
    val transports: List<String>,
    val networkKey: String?,
    val recentRttMsEwma: Int?,
    val recentFailureRateEwma: Int?,
    val recentThroughputKbpsEwma: Int?,
)

data class LinkPayloadShape(
    val fullBytes: Int,
    val criticalCoreBytes: Int?,
    val deferredBytes: Int,
    val deltaBytes: Int?,
    val deltaBaseRequired: String?,
    val deltaBaseAvailable: String?,
    val hasRequiredDeferredEvidence: Boolean,
)

data class LinkTransportCapability(
    val adapterId: String,
    val available: Boolean,
    val maxPayloadBytes: Int?,
    val supportsReceiverQuery: Boolean,
)

data class LinkPlannerInput(
    val plannerVersion: String = "link-planner-v1",
    val nowMs: Long,
    val opId: String,
    val profile: DeliveryProfileV2,
    val snapshot: LinkSnapshot,
    val payload: LinkPayloadShape,
    val transports: List<LinkTransportCapability>,
    val priorAmbiguousOutcome: Boolean,
    val automaticRetryAttempt: Boolean,
    val activeProbeBytesUsed: Int,
    val hasOutstandingDeferredObjects: Boolean,
    val prefetchEligible: Boolean,
)

data class TransmissionPlan(
    val planId: String,
    val plannerVersion: String,
    val opId: String,
    val profileHash: String,
    val snapshotId: String,
    val snapshotHash: String,
    val decision: LinkDecision,
    val reasonCodes: List<String>,
    val adapterId: String?,
    val networkKey: String?,
    val plannedBytes: Int,
    val reconcileFirst: Boolean,
    val nextEligibilityAtMs: Long?,
    val activeProbeAuthorized: Boolean,
    val activeProbeBudgetRemainingBytes: Int,
)

object LinkCanonical {
    private fun quote(value: String): String = buildString {
        append('"')
        for (c in value) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\b' -> append("\\b")
            '\u000c' -> append("\\f")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (c.code < 0x20) append("\\u%04x".format(c.code)) else append(c)
        }
        append('"')
    }

    fun json(value: Any?): String = when (value) {
        null -> "null"
        is String -> quote(value)
        is Boolean -> value.toString()
        is Number -> value.toString()
        is List<*> -> value.joinToString(prefix = "[", postfix = "]", separator = ",") { json(it) }
        is Map<*, *> -> {
            val sorted = TreeMap<String, Any?>()
            value.forEach { (key, item) -> sorted[key as String] = item }
            sorted.entries.joinToString(prefix = "{", postfix = "}", separator = ",") { quote(it.key) + ":" + json(it.value) }
        }
        else -> error("UNSUPPORTED_CANONICAL_TYPE:${value::class.java.name}")
    }

    fun sha256(value: Any?): String = MessageDigest.getInstance("SHA-256")
        .digest(json(value).toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}

object LinkPlanner {
    private fun profileMap(p: DeliveryProfileV2): Map<String, Any?> = mapOf(
        "profileVersion" to p.profileVersion, "urgency" to p.urgency.name, "deadlineAtMs" to p.deadlineAtMs,
        "expiresAtMs" to p.expiresAtMs, "maxDelayMs" to p.maxDelayMs, "retryContract" to p.retryContract.name,
        "idempotencyRequired" to p.idempotencyRequired, "semanticRevalidationRequired" to p.semanticRevalidationRequired,
        "orderingKey" to p.orderingKey, "dependencies" to p.dependencies, "payloadStrategy" to p.payloadStrategy.name,
        "maxImmediateBytes" to p.maxImmediateBytes, "allowMetered" to p.allowMetered, "allowRoaming" to p.allowRoaming,
        "allowCongested" to p.allowCongested, "allowUnvalidated" to p.allowUnvalidated, "heavyDataPolicy" to p.heavyDataPolicy,
        "activeProbeBudgetBytes" to p.activeProbeBudgetBytes, "transportAllowlist" to p.transportAllowlist,
        "receiptRequirement" to p.receiptRequirement, "evidenceRequirement" to p.evidenceRequirement,
    )
    private fun snapshotMap(s: LinkSnapshot): Map<String, Any?> = mapOf(
        "snapshotId" to s.snapshotId, "observedAtMs" to s.observedAtMs, "maxAgeMs" to s.maxAgeMs,
        "hasNetwork" to s.hasNetwork, "internetCapable" to s.internetCapable, "validated" to s.validated,
        "captivePortal" to s.captivePortal, "metered" to s.metered, "temporarilyUnmetered" to s.temporarilyUnmetered,
        "congested" to s.congested, "roaming" to s.roaming, "vpn" to s.vpn, "suspended" to s.suspended,
        "downstreamKbps" to s.downstreamKbps, "upstreamKbps" to s.upstreamKbps, "transports" to s.transports,
        "networkKey" to s.networkKey, "recentRttMsEwma" to s.recentRttMsEwma,
        "recentFailureRateEwma" to s.recentFailureRateEwma, "recentThroughputKbpsEwma" to s.recentThroughputKbpsEwma,
    )

    private fun validate(p: DeliveryProfileV2) {
        require(p.profileVersion == 2) { "LINK_PROFILE_VERSION_UNSUPPORTED" }
        require(p.maxImmediateBytes > 0) { "LINK_PROFILE_MAX_IMMEDIATE_BYTES_INVALID" }
        require(p.activeProbeBudgetBytes >= 0) { "LINK_PROFILE_PROBE_BUDGET_INVALID" }
        require(p.expiresAtMs == null || p.deadlineAtMs == null || p.expiresAtMs >= p.deadlineAtMs) { "LINK_PROFILE_EXPIRY_BEFORE_DEADLINE" }
        require(p.maxDelayMs == null || p.maxDelayMs >= 0) { "LINK_PROFILE_MAX_DELAY_INVALID" }
        require(p.retryContract != LinkRetryContract.SAFE_IDEMPOTENT || p.idempotencyRequired) { "LINK_PROFILE_SAFE_RETRY_REQUIRES_IDEMPOTENCY" }
        require(p.dependencies.distinct().size == p.dependencies.size) { "LINK_PROFILE_DUPLICATE_DEPENDENCY" }
        require(p.transportAllowlist.distinct().size == p.transportAllowlist.size) { "LINK_PROFILE_DUPLICATE_TRANSPORT" }
    }

    private fun select(input: LinkPlannerInput, bytes: Int, requireQuery: Boolean = false): LinkTransportCapability? = input.transports
        .filter { it.available && (input.profile.transportAllowlist.isEmpty() || it.adapterId in input.profile.transportAllowlist) && (!requireQuery || it.supportsReceiverQuery) && (it.maxPayloadBytes == null || bytes <= it.maxPayloadBytes) }
        .sortedBy { it.adapterId }.firstOrNull()

    private fun plan(input: LinkPlannerInput, decision: LinkDecision, reasons: List<String>, bytes: Int, transport: LinkTransportCapability?, reconcile: Boolean, next: Long?): TransmissionPlan {
        val profileHash = LinkCanonical.sha256(profileMap(input.profile))
        val snapshotHash = LinkCanonical.sha256(snapshotMap(input.snapshot))
        val remaining = (input.profile.activeProbeBudgetBytes - input.activeProbeBytesUsed).coerceAtLeast(0)
        val probe = remaining > 0 && input.snapshot.validated && !input.snapshot.metered
        val identity = mapOf("plannerVersion" to input.plannerVersion, "opId" to input.opId, "profileHash" to profileHash, "snapshotHash" to snapshotHash, "decision" to decision.name, "reasons" to reasons, "bytes" to bytes, "adapterId" to transport?.adapterId, "networkKey" to input.snapshot.networkKey, "reconcileFirst" to reconcile, "nextEligibilityAtMs" to next)
        return TransmissionPlan(LinkCanonical.sha256(identity), input.plannerVersion, input.opId, profileHash, input.snapshot.snapshotId, snapshotHash, decision, reasons, transport?.adapterId, input.snapshot.networkKey, bytes, reconcile, next, probe, remaining)
    }

    private fun wait(input: LinkPlannerInput, reason: String): TransmissionPlan = plan(input, LinkDecision.WAIT_FOR_VALIDATED_LINK, listOf(reason), 0, null, false, input.profile.maxDelayMs?.let { input.nowMs + it })
    private fun good(input: LinkPlannerInput) = input.snapshot.validated && !input.snapshot.captivePortal && !input.snapshot.suspended && (!input.snapshot.metered || input.snapshot.temporarilyUnmetered) && !input.snapshot.congested && !input.snapshot.roaming
    private fun nearDeadline(input: LinkPlannerInput): Boolean = input.profile.deadlineAtMs?.let { input.nowMs + (input.profile.maxDelayMs ?: 0) >= it } ?: false

    fun create(raw: LinkPlannerInput): TransmissionPlan {
        validate(raw.profile); val input = raw
        if (input.profile.expiresAtMs != null && input.nowMs >= input.profile.expiresAtMs) return plan(input, LinkDecision.EXPIRED_NO_SEND, listOf("OPERATION_EXPIRED"), 0, null, false, null)
        if (input.automaticRetryAttempt && input.profile.retryContract == LinkRetryContract.NO_AUTOMATIC_RETRY) return plan(input, LinkDecision.REJECT_BY_POLICY, listOf("RETRY_CONTRACT_PROHIBITS_RESEND"), 0, null, false, null)
        if (input.priorAmbiguousOutcome && input.profile.retryContract == LinkRetryContract.RECONCILE_BEFORE_RETRY) {
            val t = select(input, 0, true); val reasons = if (t == null) listOf("RECEIVER_RECONCILIATION_REQUIRED", "TRANSPORT_NOT_CAPABLE") else listOf("RECEIVER_RECONCILIATION_REQUIRED")
            return plan(input, LinkDecision.RECONCILE_BEFORE_RETRY, reasons, 0, t, true, null)
        }
        if (input.nowMs < input.snapshot.observedAtMs || input.nowMs - input.snapshot.observedAtMs > input.snapshot.maxAgeMs) return wait(input, "STALE_LINK_SNAPSHOT")
        if (!input.snapshot.hasNetwork) return wait(input, "NO_NETWORK")
        if (!input.snapshot.internetCapable) return wait(input, "NETWORK_NOT_INTERNET_CAPABLE")
        if (input.snapshot.suspended) return wait(input, "NETWORK_SUSPENDED")
        if (input.snapshot.captivePortal) return wait(input, "CAPTIVE_PORTAL")
        if (!input.snapshot.validated && !input.profile.allowUnvalidated) return wait(input, "NETWORK_NOT_VALIDATED")
        if (input.snapshot.metered && !input.snapshot.temporarilyUnmetered && !input.profile.allowMetered) return wait(input, "POLICY_METERED_FORBIDDEN")
        if (input.snapshot.roaming && !input.profile.allowRoaming) return wait(input, "POLICY_ROAMING_FORBIDDEN")
        if (input.snapshot.congested && !input.profile.allowCongested && input.profile.urgency != LinkUrgency.CRITICAL) return plan(input, LinkDecision.DEFER_HEAVY, listOf(if (input.profile.urgency == LinkUrgency.BULK) "NETWORK_CONGESTED_DEFER_BULK" else "NETWORK_CONGESTED_DEFER_BULK", "HEAVY_DEFERRED"), 0, null, false, null)
        val extra = if (!input.snapshot.validated) listOf("UNVALIDATED_EXPLICITLY_ALLOWED") else emptyList()
        val fullT = select(input, input.payload.fullBytes); val fullFits = input.payload.fullBytes <= input.profile.maxImmediateBytes && fullT != null
        if (input.profile.payloadStrategy == LinkPayloadStrategy.DELTA_ALLOWED && input.payload.deltaBytes != null) {
            val exact = input.payload.deltaBaseRequired != null && input.payload.deltaBaseAvailable == input.payload.deltaBaseRequired
            if (exact) {
                val t = select(input, input.payload.deltaBytes)
                if (t != null && input.payload.deltaBytes <= input.profile.maxImmediateBytes) return plan(input, LinkDecision.SEND_DELTA_NOW, listOf("DELTA_BASE_AVAILABLE") + extra, input.payload.deltaBytes, t, false, null)
            } else if (input.payload.deltaBaseRequired != null && !fullFits) return plan(input, LinkDecision.DEFER_HEAVY, listOf("DELTA_BASE_UNKNOWN", "HEAVY_DEFERRED"), 0, null, false, null)
        }
        if (fullFits && (good(input) || input.profile.payloadStrategy == LinkPayloadStrategy.FULL_ONLY || nearDeadline(input))) {
            val reasons = mutableListOf("FULL_PAYLOAD_FITS"); reasons += extra; if (nearDeadline(input)) reasons += "CRITICAL_DEADLINE"; if (good(input) && input.hasOutstandingDeferredObjects) reasons += "GOOD_LINK_FLUSH_ELIGIBLE"
            return plan(input, LinkDecision.SEND_FULL_NOW, reasons, input.payload.fullBytes, fullT, false, null)
        }
        if (input.profile.payloadStrategy == LinkPayloadStrategy.CORE_PLUS_DEFERRED && input.payload.criticalCoreBytes != null) {
            val t = select(input, input.payload.criticalCoreBytes)
            if (t != null && input.payload.criticalCoreBytes <= input.profile.maxImmediateBytes) {
                val reasons = mutableListOf("CRITICAL_CORE_FITS", "FULL_PAYLOAD_TOO_LARGE", "HEAVY_DEFERRED"); reasons += extra; if (input.snapshot.metered && input.profile.urgency == LinkUrgency.CRITICAL) reasons += "POLICY_METERED_ALLOWS_CRITICAL"; if (input.snapshot.congested && input.profile.urgency == LinkUrgency.CRITICAL) reasons += "NETWORK_CONGESTED_DEFER_BULK"; if (nearDeadline(input)) reasons += "CRITICAL_DEADLINE"
                return plan(input, LinkDecision.SEND_CRITICAL_CORE_NOW, reasons, input.payload.criticalCoreBytes, t, false, null)
            }
        }
        if (good(input) && input.prefetchEligible && !input.hasOutstandingDeferredObjects) return plan(input, LinkDecision.PREFETCH_WHEN_GOOD, listOf("PREFETCH_ELIGIBLE"), 0, null, false, null)
        if (input.profile.urgency == LinkUrgency.BULK || input.payload.deferredBytes > 0) {
            val reasons = mutableListOf<String>(); if (input.snapshot.congested) reasons += "NETWORK_CONGESTED_DEFER_BULK"; reasons += "HEAVY_DEFERRED"; if (input.activeProbeBytesUsed >= input.profile.activeProbeBudgetBytes && input.profile.activeProbeBudgetBytes > 0) reasons += "BUDGET_EXHAUSTED"
            return plan(input, LinkDecision.DEFER_HEAVY, reasons, 0, null, false, null)
        }
        return plan(input, LinkDecision.REJECT_BY_POLICY, listOf(if (fullT != null) "TRANSPORT_NOT_CAPABLE" else "TRANSPORT_UNAVAILABLE"), 0, null, false, null)
    }
}
