package com.zungun.runtime.link

import com.zungun.runtime.db.LinkObservationEntity
import com.zungun.runtime.db.LinkOperationStateEntity
import com.zungun.runtime.db.TransmissionPlanEntity
import org.json.JSONArray
import org.json.JSONObject

object LinkPersistence {
    fun profileJson(profile: DeliveryProfileV2): String = JSONObject()
        .put("profileVersion", profile.profileVersion)
        .put("urgency", profile.urgency.name)
        .put("deadlineAtMs", profile.deadlineAtMs ?: JSONObject.NULL)
        .put("expiresAtMs", profile.expiresAtMs ?: JSONObject.NULL)
        .put("maxDelayMs", profile.maxDelayMs ?: JSONObject.NULL)
        .put("retryContract", profile.retryContract.name)
        .put("idempotencyRequired", profile.idempotencyRequired)
        .put("semanticRevalidationRequired", profile.semanticRevalidationRequired)
        .put("orderingKey", profile.orderingKey ?: JSONObject.NULL)
        .put("dependencies", JSONArray(profile.dependencies))
        .put("payloadStrategy", profile.payloadStrategy.name)
        .put("maxImmediateBytes", profile.maxImmediateBytes)
        .put("allowMetered", profile.allowMetered)
        .put("allowRoaming", profile.allowRoaming)
        .put("allowCongested", profile.allowCongested)
        .put("allowUnvalidated", profile.allowUnvalidated)
        .put("heavyDataPolicy", profile.heavyDataPolicy)
        .put("activeProbeBudgetBytes", profile.activeProbeBudgetBytes)
        .put("transportAllowlist", JSONArray(profile.transportAllowlist))
        .put("receiptRequirement", profile.receiptRequirement)
        .put("evidenceRequirement", profile.evidenceRequirement)
        .toString()

    fun profile(value: String): DeliveryProfileV2 {
        val j = JSONObject(value)
        fun strings(name: String): List<String> = j.getJSONArray(name).let { array ->
            (0 until array.length()).map { array.getString(it) }
        }
        return DeliveryProfileV2(
            profileVersion = j.getInt("profileVersion"),
            urgency = LinkUrgency.valueOf(j.getString("urgency")),
            deadlineAtMs = j.optLongOrNull("deadlineAtMs"),
            expiresAtMs = j.optLongOrNull("expiresAtMs"),
            maxDelayMs = j.optLongOrNull("maxDelayMs"),
            retryContract = LinkRetryContract.valueOf(j.getString("retryContract")),
            idempotencyRequired = j.getBoolean("idempotencyRequired"),
            semanticRevalidationRequired = j.getBoolean("semanticRevalidationRequired"),
            orderingKey = j.optStringOrNull("orderingKey"),
            dependencies = strings("dependencies"),
            payloadStrategy = LinkPayloadStrategy.valueOf(j.getString("payloadStrategy")),
            maxImmediateBytes = j.getInt("maxImmediateBytes"),
            allowMetered = j.getBoolean("allowMetered"),
            allowRoaming = j.getBoolean("allowRoaming"),
            allowCongested = j.getBoolean("allowCongested"),
            allowUnvalidated = j.getBoolean("allowUnvalidated"),
            heavyDataPolicy = j.getString("heavyDataPolicy"),
            activeProbeBudgetBytes = j.getInt("activeProbeBudgetBytes"),
            transportAllowlist = strings("transportAllowlist"),
            receiptRequirement = j.getString("receiptRequirement"),
            evidenceRequirement = j.getString("evidenceRequirement"),
        )
    }

    fun payloadMetadata(value: String): LinkPayloadMetadata? = LinkPayloadMetadataCodec.read(value)

    fun snapshotJson(snapshot: LinkSnapshot): String = JSONObject()
        .put("snapshotId", snapshot.snapshotId)
        .put("observedAtMs", snapshot.observedAtMs)
        .put("maxAgeMs", snapshot.maxAgeMs)
        .put("hasNetwork", snapshot.hasNetwork)
        .put("internetCapable", snapshot.internetCapable)
        .put("validated", snapshot.validated)
        .put("captivePortal", snapshot.captivePortal)
        .put("metered", snapshot.metered)
        .put("temporarilyUnmetered", snapshot.temporarilyUnmetered)
        .put("congested", snapshot.congested)
        .put("roaming", snapshot.roaming)
        .put("vpn", snapshot.vpn)
        .put("suspended", snapshot.suspended)
        .put("downstreamKbps", snapshot.downstreamKbps ?: JSONObject.NULL)
        .put("upstreamKbps", snapshot.upstreamKbps ?: JSONObject.NULL)
        .put("transports", JSONArray(snapshot.transports))
        .put("networkKey", snapshot.networkKey ?: JSONObject.NULL)
        .put("recentRttMsEwma", snapshot.recentRttMsEwma ?: JSONObject.NULL)
        .put("recentFailureRateEwma", snapshot.recentFailureRateEwma ?: JSONObject.NULL)
        .put("recentThroughputKbpsEwma", snapshot.recentThroughputKbpsEwma ?: JSONObject.NULL)
        .toString()

    fun state(
        operationId: String,
        profile: DeliveryProfileV2,
        nowMs: Long,
        payloadMetadata: LinkPayloadMetadata? = null,
    ): LinkOperationStateEntity {
        val base = profileJson(profile)
        val hash = LinkCanonical.sha256(JSONObject(base).toCanonicalMap())
        val stored = LinkPayloadMetadataCodec.attach(base, payloadMetadata)
        return LinkOperationStateEntity(
            operationId, stored, hash, profile.retryContract.name, profile.payloadStrategy.name,
            profile.orderingKey, null, null, 0, false, null, nowMs,
        )
    }

    fun observation(operationId: String, snapshot: LinkSnapshot): LinkObservationEntity {
        val json = snapshotJson(snapshot)
        val hash = LinkCanonical.sha256(JSONObject(json).toCanonicalMap())
        return LinkObservationEntity(snapshot.snapshotId, operationId, snapshot.observedAtMs, snapshot.maxAgeMs, json, hash, snapshot.networkKey)
    }

    fun plan(operationId: String, value: TransmissionPlan, createdAtMs: Long): TransmissionPlanEntity = TransmissionPlanEntity(
        value.planId, operationId, value.plannerVersion, value.profileHash, value.snapshotId, value.snapshotHash,
        value.decision.name, JSONArray(value.reasonCodes).toString(), value.adapterId, value.networkKey,
        value.plannedBytes, value.reconcileFirst, value.nextEligibilityAtMs, value.activeProbeAuthorized,
        value.activeProbeBudgetRemainingBytes, createdAtMs,
    )

    private fun JSONObject.optLongOrNull(name: String): Long? = if (isNull(name)) null else getLong(name)
    private fun JSONObject.optStringOrNull(name: String): String? = if (isNull(name)) null else getString(name)
    private fun JSONObject.toCanonicalMap(): Map<String, Any?> = keys().asSequence()
        .filter { it != "payloadMetadata" }
        .associateWith { key -> convert(get(key)) }

    private fun convert(value: Any?): Any? = when (value) {
        JSONObject.NULL -> null
        is JSONObject -> value.toCanonicalMap()
        is JSONArray -> (0 until value.length()).map { convert(value.get(it)) }
        else -> value
    }
}
