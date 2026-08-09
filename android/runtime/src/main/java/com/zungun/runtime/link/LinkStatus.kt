package com.zungun.runtime.link

import com.zungun.runtime.db.ZungunDatabase
import org.json.JSONArray

data class LinkOperationStatus(
    val operationId: String,
    val semanticState: String,
    val effectComplete: Boolean,
    val planId: String?,
    val planDecision: String?,
    val immediateReceiptId: String?,
    val deferredTotal: Int,
    val deferredCompleted: Int,
    val requiredForEffectPending: Int,
    val requiredForFinalEvidencePending: Int,
    val lastReason: String?,
    val witnessEvidenceId: String?,
    val proofReference: String?,
)

object LinkStatusReader {
    suspend fun read(database: ZungunDatabase, operationId: String): LinkOperationStatus? {
        val operation = database.operations().get(operationId) ?: return null
        val deferred = database.link().deferredFor(operationId)
        val plan = database.link().latestPlan(operationId)
        val receipt = database.operations().receiptFor(operationId)
        val witness = database.operations().witnessFor(operationId).lastOrNull()
        val reasons = plan?.let { runCatching { JSONArray(it.reasonsJson).optString(0).takeIf(String::isNotBlank) }.getOrNull() }
        val effectPending = deferred.count { it.requirement == "REQUIRED_FOR_EFFECT" && it.state != "COMPLETED" }
        val evidencePending = deferred.count { it.requirement == "REQUIRED_FOR_FINAL_EVIDENCE" && it.state != "COMPLETED" }
        return LinkOperationStatus(
            operationId = operationId,
            semanticState = operation.state,
            effectComplete = operation.state == "COMPLETED" && effectPending == 0,
            planId = plan?.planId,
            planDecision = plan?.decision,
            immediateReceiptId = receipt?.receiptId,
            deferredTotal = deferred.size,
            deferredCompleted = deferred.count { it.state == "COMPLETED" },
            requiredForEffectPending = effectPending,
            requiredForFinalEvidencePending = evidencePending,
            lastReason = operation.lastError ?: reasons,
            witnessEvidenceId = witness?.evidenceId,
            proofReference = witness?.evidenceSha256 ?: receipt?.payloadSha256,
        )
    }
}
