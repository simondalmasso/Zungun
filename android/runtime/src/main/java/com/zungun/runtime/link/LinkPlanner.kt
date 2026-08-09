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
    val selectionRank: Int = 0,
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
        for (c in value) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> when {
                    c.code == 12 -> append("\\f")
                    c.code < 0x20 -> append("\\u%04x".format(c.code))
                    else -> append(c)
                }
            }
        }
        append('"')
    }

    fun json(value: Any?): String = when (value) {
        null -> "null"
        is String -> quote(value)
        is Boolean -> value.toString()
        is Number -> value.toString()
        is List<*> -> value.joinToString("[", ",", "]") { json(it) }
        is Map<*, *> -> {
            val sorted = TreeMap<String, Any?>()
            value.forEach { (key, item) -> sorted[key as String] = item }
            sorted.entries.joinToString("{", ",", "}") { quote(it.key) + ":" + json(it.value) }
        }
        else -> error("UNSUPPORTED_CANONICAL_TYPE:${value::class.java.name}")
    }

    fun sha256(value: Any?): String = MessageDigest.getInstance("SHA-256")
        .digest(json(value).toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
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

    private fun select(i: LinkPlannerInput, bytes: Int, requireQuery: Boolean = false): LinkTransportCapability? =
        i.transports.filter {
            it.available &&
                (i.profile.transportAllowlist.isEmpty() || it.adapterId in i.profile.transportAllowlist) &&
                (!requireQuery || it.supportsReceiverQuery) &&
                (it.maxPayloadBytes == null || bytes <= it.maxPayloadBytes)
        }.sortedWith(compareBy<LinkTransportCapability> { it.selectionRank }.thenBy { it.adapterId }).firstOrNull()

    private fun plan(i: LinkPlannerInput, d: LinkDecision, r: List<String>, b: Int, t: LinkTransportCapability?, rec: Boolean, next: Long?): TransmissionPlan {
        val ph = LinkCanonical.sha256(profileMap(i.profile))
        val sh = LinkCanonical.sha256(snapshotMap(i.snapshot))
        val remaining = (i.profile.activeProbeBudgetBytes - i.activeProbeBytesUsed).coerceAtLeast(0)
        val probe = remaining > 0 && i.snapshot.validated && !i.snapshot.metered
        val identity = mapOf(
            "plannerVersion" to i.plannerVersion, "opId" to i.opId, "profileHash" to ph, "snapshotHash" to sh,
            "decision" to d.name, "reasons" to r, "bytes" to b, "adapterId" to t?.adapterId,
            "networkKey" to i.snapshot.networkKey, "reconcileFirst" to rec, "nextEligibilityAtMs" to next,
        )
        return TransmissionPlan(LinkCanonical.sha256(identity), i.plannerVersion, i.opId, ph, i.snapshot.snapshotId, sh, d, r, t?.adapterId, i.snapshot.networkKey, b, rec, next, probe, remaining)
    }

    private fun wait(i: LinkPlannerInput, r: String) = plan(i, LinkDecision.WAIT_FOR_VALIDATED_LINK, listOf(r), 0, null, false, i.profile.maxDelayMs?.let { i.nowMs + it })
    private fun good(i: LinkPlannerInput) = i.snapshot.validated && !i.snapshot.captivePortal && !i.snapshot.suspended && (!i.snapshot.metered || i.snapshot.temporarilyUnmetered) && !i.snapshot.congested && !i.snapshot.roaming
    private fun nearDeadline(i: LinkPlannerInput) = i.profile.deadlineAtMs?.let { i.nowMs + (i.profile.maxDelayMs ?: 0) >= it } ?: false

    fun create(i: LinkPlannerInput): TransmissionPlan {
        validate(i.profile)
        if (i.profile.expiresAtMs != null && i.nowMs >= i.profile.expiresAtMs) return plan(i, LinkDecision.EXPIRED_NO_SEND, listOf("OPERATION_EXPIRED"), 0, null, false, null)
        if (i.automaticRetryAttempt && i.profile.retryContract == LinkRetryContract.NO_AUTOMATIC_RETRY) return plan(i, LinkDecision.REJECT_BY_POLICY, listOf("RETRY_CONTRACT_PROHIBITS_RESEND"), 0, null, false, null)
        if (i.priorAmbiguousOutcome && i.profile.retryContract == LinkRetryContract.RECONCILE_BEFORE_RETRY) {
            val t = select(i, 0, true)
            val reasons = if (t == null) listOf("RECEIVER_RECONCILIATION_REQUIRED", "TRANSPORT_NOT_CAPABLE") else listOf("RECEIVER_RECONCILIATION_REQUIRED")
            return plan(i, LinkDecision.RECONCILE_BEFORE_RETRY, reasons, 0, t, true, null)
        }
        if (i.nowMs < i.snapshot.observedAtMs || i.nowMs - i.snapshot.observedAtMs > i.snapshot.maxAgeMs) return wait(i, "STALE_LINK_SNAPSHOT")
        if (!i.snapshot.hasNetwork) return wait(i, "NO_NETWORK")
        if (!i.snapshot.internetCapable) return wait(i, "NETWORK_NOT_INTERNET_CAPABLE")
        if (i.snapshot.suspended) return wait(i, "NETWORK_SUSPENDED")
        if (i.snapshot.captivePortal) return wait(i, "CAPTIVE_PORTAL")
        if (!i.snapshot.validated && !i.profile.allowUnvalidated) return wait(i, "NETWORK_NOT_VALIDATED")
        if (i.snapshot.metered && !i.snapshot.temporarilyUnmetered && !i.profile.allowMetered) return wait(i, "POLICY_METERED_FORBIDDEN")
        if (i.snapshot.roaming && !i.profile.allowRoaming) return wait(i, "POLICY_ROAMING_FORBIDDEN")
        if (i.snapshot.congested && !i.profile.allowCongested && i.profile.urgency != LinkUrgency.CRITICAL) return plan(i, LinkDecision.DEFER_HEAVY, listOf("NETWORK_CONGESTED_DEFER_BULK", "HEAVY_DEFERRED"), 0, null, false, null)

        val extra = if (!i.snapshot.validated) listOf("UNVALIDATED_EXPLICITLY_ALLOWED") else emptyList()
        val fullT = select(i, i.payload.fullBytes)
        val fullFits = i.payload.fullBytes <= i.profile.maxImmediateBytes && fullT != null
        if (i.profile.payloadStrategy == LinkPayloadStrategy.DELTA_ALLOWED && i.payload.deltaBytes != null) {
            val exact = i.payload.deltaBaseRequired != null && i.payload.deltaBaseAvailable == i.payload.deltaBaseRequired
            if (exact) {
                val t = select(i, i.payload.deltaBytes)
                if (t != null && i.payload.deltaBytes <= i.profile.maxImmediateBytes) return plan(i, LinkDecision.SEND_DELTA_NOW, listOf("DELTA_BASE_AVAILABLE") + extra, i.payload.deltaBytes, t, false, null)
            } else if (i.payload.deltaBaseRequired != null && !fullFits) {
                return plan(i, LinkDecision.DEFER_HEAVY, listOf("DELTA_BASE_UNKNOWN", "HEAVY_DEFERRED"), 0, null, false, null)
            }
        }
        if (fullFits && (good(i) || i.profile.payloadStrategy == LinkPayloadStrategy.FULL_ONLY || nearDeadline(i))) {
            val reasons = mutableListOf("FULL_PAYLOAD_FITS")
            reasons += extra
            if (nearDeadline(i)) reasons += "CRITICAL_DEADLINE"
            if (good(i) && i.hasOutstandingDeferredObjects) reasons += "GOOD_LINK_FLUSH_ELIGIBLE"
            return plan(i, LinkDecision.SEND_FULL_NOW, reasons, i.payload.fullBytes, fullT, false, null)
        }
        if (i.profile.payloadStrategy == LinkPayloadStrategy.CORE_PLUS_DEFERRED && i.payload.criticalCoreBytes != null) {
            val t = select(i, i.payload.criticalCoreBytes)
            if (t != null && i.payload.criticalCoreBytes <= i.profile.maxImmediateBytes) {
                val reasons = mutableListOf("CRITICAL_CORE_FITS", "FULL_PAYLOAD_TOO_LARGE", "HEAVY_DEFERRED")
                reasons += extra
                if (i.snapshot.metered && i.profile.urgency == LinkUrgency.CRITICAL) reasons += "POLICY_METERED_ALLOWS_CRITICAL"
                if (i.snapshot.congested && i.profile.urgency == LinkUrgency.CRITICAL) reasons += "NETWORK_CONGESTED_DEFER_BULK"
                if (nearDeadline(i)) reasons += "CRITICAL_DEADLINE"
                return plan(i, LinkDecision.SEND_CRITICAL_CORE_NOW, reasons, i.payload.criticalCoreBytes, t, false, null)
            }
        }
        if (good(i) && i.prefetchEligible && !i.hasOutstandingDeferredObjects) return plan(i, LinkDecision.PREFETCH_WHEN_GOOD, listOf("PREFETCH_ELIGIBLE"), 0, null, false, null)
        if (i.profile.urgency == LinkUrgency.BULK || i.payload.deferredBytes > 0) {
            val reasons = mutableListOf<String>()
            if (i.snapshot.congested) reasons += "NETWORK_CONGESTED_DEFER_BULK"
            reasons += "HEAVY_DEFERRED"
            if (i.activeProbeBytesUsed >= i.profile.activeProbeBudgetBytes && i.profile.activeProbeBudgetBytes > 0) reasons += "BUDGET_EXHAUSTED"
            return plan(i, LinkDecision.DEFER_HEAVY, reasons, 0, null, false, null)
        }
        return plan(i, LinkDecision.REJECT_BY_POLICY, listOf(if (fullT != null) "TRANSPORT_NOT_CAPABLE" else "TRANSPORT_UNAVAILABLE"), 0, null, false, null)
    }
}
