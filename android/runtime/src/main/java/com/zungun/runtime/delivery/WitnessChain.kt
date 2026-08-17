package com.zungun.runtime.delivery

import com.zungun.runtime.db.WitnessEvidenceEntity
import com.zungun.runtime.network.CanonicalJson
import org.json.JSONObject

object WitnessChain {
    private const val SCHEMA = "zungun-witness/1"

    fun initial(operationId: String, deviceId: String, nowMs: Long): List<WitnessEvidenceEntity> {
        val detected = append(
            operationId = operationId,
            evidenceId = "android:$operationId:detected",
            state = "DETECTED",
            evidenceClass = "MACHINE_ASSERTION",
            emitterId = "android:$deviceId",
            scope = "witness:source",
            observedAtMs = nowMs,
            monotonicMs = nowMs,
            provenance = "android:runtime",
            reasonCode = "APP_OPERATION_CREATED",
            claims = JSONObject().put("boundaryRole", "SENSOR_OR_SOURCE").put("sourceId", "android:$deviceId"),
            previous = null,
        )
        val committed = append(
            operationId = operationId,
            evidenceId = "android:$operationId:committed",
            state = "COMMITTED_LOCAL",
            evidenceClass = "MACHINE_ASSERTION",
            emitterId = "android:$deviceId",
            scope = "witness:local",
            observedAtMs = nowMs + 1,
            monotonicMs = nowMs + 1,
            provenance = "android:room",
            reasonCode = "LOCAL_DURABLE_COMMIT",
            claims = JSONObject().put("boundaryRole", "ZUNGUN_WITNESS").put("localCommitRef", "room:$operationId"),
            previous = detected,
        )
        return listOf(detected, committed)
    }

    fun custody(operationId: String, deviceId: String, nowMs: Long, previous: WitnessEvidenceEntity): WitnessEvidenceEntity = append(
        operationId = operationId,
        evidenceId = "android:$operationId:custody",
        state = "CUSTODY_ACCEPTED",
        evidenceClass = "MACHINE_ASSERTION",
        emitterId = "android:$deviceId",
        scope = "witness:transport",
        observedAtMs = nowMs,
        monotonicMs = maxOf(nowMs, previous.monotonicMs + 1),
        provenance = "android:http",
        reasonCode = "HTTP_TRANSPORT_CUSTODY",
        claims = JSONObject()
            .put("boundaryRole", "TRANSPORT")
            .put("transportKind", "HTTP_WEBHOOK")
            .put("routeId", "receiver:http")
            .put("custodyRef", "workmanager:$operationId"),
        previous = previous,
    )

    private fun append(
        operationId: String,
        evidenceId: String,
        state: String,
        evidenceClass: String,
        emitterId: String,
        scope: String,
        observedAtMs: Long,
        monotonicMs: Long,
        provenance: String,
        reasonCode: String,
        claims: JSONObject,
        previous: WitnessEvidenceEntity?,
    ): WitnessEvidenceEntity {
        val position = (previous?.chainPosition ?: -1) + 1
        val body = JSONObject()
            .put("schemaVersion", SCHEMA)
            .put("incidentId", operationId)
            .put("evidenceId", evidenceId)
            .put("state", state)
            .put("evidenceClass", evidenceClass)
            .put("emitterId", emitterId)
            .put("authorizationScope", scope)
            .put("observedAtMs", observedAtMs)
            .put("monotonicMs", monotonicMs)
            .put("provenance", provenance)
            .put("reasonCode", reasonCode)
            .put("claims", claims)
            .put("previousState", previous?.state ?: JSONObject.NULL)
            .put("previousHash", previous?.evidenceSha256 ?: JSONObject.NULL)
            .put("chainPosition", position)
        val canonical = CanonicalJson.stringify(body)
        val hash = "sha256:${EvidenceHasher.sha256(canonical)}"
        body.put("evidenceHash", hash)
        return WitnessEvidenceEntity(
            evidenceId = evidenceId,
            operationId = operationId,
            chainPosition = position,
            state = state,
            evidenceJson = CanonicalJson.stringify(body),
            evidenceSha256 = hash,
            previousHash = previous?.evidenceSha256,
            monotonicMs = monotonicMs,
            createdAtMs = observedAtMs,
        )
    }
}
