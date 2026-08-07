package com.zungun.runtime.link

import com.zungun.runtime.db.LinkObservationEntity
import com.zungun.runtime.db.LinkOperationStateEntity
import com.zungun.runtime.db.TransmissionPlanEntity
import org.json.JSONArray
import org.json.JSONObject

object LinkPersistence {
    fun profileJson(profile: DeliveryProfileV2): String = JSONObject()
        .put("profileVersion", profile.profileVersion).put("urgency", profile.urgency.name)
        .put("deadlineAtMs", profile.deadlineAtMs ?: JSONObject.NULL).put("expiresAtMs", profile.expiresAtMs ?: JSONObject.NULL)
        .put("maxDelayMs", profile.maxDelayMs ?: JSONObject.NULL).put("retryContract", profile.retryContract.name)
        .put("idempotencyRequired", profile.idempotencyRequired).put("semanticRevalidationRequired", profile.semanticRevalidationRequired)
        .put("orderingKey", profile.orderingKey ?: JSONObject.NULL).put("dependencies", JSONArray(profile.dependencies))
        .put("payloadStrategy", profile.payloadStrategy.name).put("maxImmediateBytes", profile.maxImmediateBytes)
        .put("allowMetered", profile.allowMetered).put("allowRoaming", profile.allowRoaming).put("allowCongested", profile.allowCongested)
        .put("allowUnvalidated", profile.allowUnvalidated).put("heavyDataPolicy", profile.heavyDataPolicy)
        .put("activeProbeBudgetBytes", profile.activeProbeBudgetBytes).put("transportAllowlist", JSONArray(profile.transportAllowlist))
        .put("receiptRequirement", profile.receiptRequirement).put("evidenceRequirement", profile.evidenceRequirement).toString()

    fun profile(value: String): DeliveryProfileV2 {
        val j = JSONObject(value); fun strings(name: String) = j.getJSONArray(name).let { a -> (0 until a.length()).map { a.getString(it) } }
        return DeliveryProfileV2(profileVersion=j.getInt("profileVersion"),urgency=LinkUrgency.valueOf(j.getString("urgency")),deadlineAtMs=j.optLongOrNull("deadlineAtMs"),expiresAtMs=j.optLongOrNull("expiresAtMs"),maxDelayMs=j.optLongOrNull("maxDelayMs"),retryContract=LinkRetryContract.valueOf(j.getString("retryContract")),idempotencyRequired=j.getBoolean("idempotencyRequired"),semanticRevalidationRequired=j.getBoolean("semanticRevalidationRequired"),orderingKey=j.optStringOrNull("orderingKey"),dependencies=strings("dependencies"),payloadStrategy=LinkPayloadStrategy.valueOf(j.getString("payloadStrategy")),maxImmediateBytes=j.getInt("maxImmediateBytes"),allowMetered=j.getBoolean("allowMetered"),allowRoaming=j.getBoolean("allowRoaming"),allowCongested=j.getBoolean("allowCongested"),allowUnvalidated=j.getBoolean("allowUnvalidated"),heavyDataPolicy=j.getString("heavyDataPolicy"),activeProbeBudgetBytes=j.getInt("activeProbeBudgetBytes"),transportAllowlist=strings("transportAllowlist"),receiptRequirement=j.getString("receiptRequirement"),evidenceRequirement=j.getString("evidenceRequirement"))
    }

    fun snapshotJson(s: LinkSnapshot): String = JSONObject()
        .put("snapshotId",s.snapshotId).put("observedAtMs",s.observedAtMs).put("maxAgeMs",s.maxAgeMs).put("hasNetwork",s.hasNetwork)
        .put("internetCapable",s.internetCapable).put("validated",s.validated).put("captivePortal",s.captivePortal).put("metered",s.metered)
        .put("temporarilyUnmetered",s.temporarilyUnmetered).put("congested",s.congested).put("roaming",s.roaming).put("vpn",s.vpn).put("suspended",s.suspended)
        .put("downstreamKbps",s.downstreamKbps ?: JSONObject.NULL).put("upstreamKbps",s.upstreamKbps ?: JSONObject.NULL).put("transports",JSONArray(s.transports))
        .put("networkKey",s.networkKey ?: JSONObject.NULL).put("recentRttMsEwma",s.recentRttMsEwma ?: JSONObject.NULL).put("recentFailureRateEwma",s.recentFailureRateEwma ?: JSONObject.NULL)
        .put("recentThroughputKbpsEwma",s.recentThroughputKbpsEwma ?: JSONObject.NULL).toString()

    fun state(operationId: String, profile: DeliveryProfileV2, nowMs: Long): LinkOperationStateEntity {
        val json = profileJson(profile); val hash = LinkCanonical.sha256(JSONObject(json).toMap())
        return LinkOperationStateEntity(operationId,json,hash,profile.retryContract.name,profile.payloadStrategy.name,profile.orderingKey,null,null,0,false,null,nowMs)
    }

    fun observation(operationId: String, snapshot: LinkSnapshot): LinkObservationEntity {
        val json=snapshotJson(snapshot); val hash=LinkCanonical.sha256(JSONObject(json).toMap())
        return LinkObservationEntity(snapshot.snapshotId,operationId,snapshot.observedAtMs,snapshot.maxAgeMs,json,hash,snapshot.networkKey)
    }

    fun plan(operationId: String, value: TransmissionPlan, createdAtMs: Long) = TransmissionPlanEntity(value.planId,operationId,value.plannerVersion,value.profileHash,value.snapshotId,value.snapshotHash,value.decision.name,JSONArray(value.reasonCodes).toString(),value.adapterId,value.networkKey,value.plannedBytes,value.reconcileFirst,value.nextEligibilityAtMs,value.activeProbeAuthorized,value.activeProbeBudgetRemainingBytes,createdAtMs)

    private fun JSONObject.optLongOrNull(name: String): Long? = if (isNull(name)) null else getLong(name)
    private fun JSONObject.optStringOrNull(name: String): String? = if (isNull(name)) null else getString(name)
    private fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { key -> convert(get(key)) }
    private fun convert(value: Any?): Any? = when(value){ JSONObject.NULL -> null; is JSONObject -> value.toMap(); is JSONArray -> (0 until value.length()).map{convert(value.get(it))}; else -> value }
}
