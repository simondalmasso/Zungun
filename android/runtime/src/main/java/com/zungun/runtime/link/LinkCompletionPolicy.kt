package com.zungun.runtime.link

import com.zungun.runtime.db.EvidenceEntity
import com.zungun.runtime.db.ReceiptEntity
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.EvidenceHasher
import com.zungun.runtime.model.OperationState
import com.zungun.runtime.network.VerifiedReceipt

/** The receiver receipt proves the core business outcome; REQUIRED_FOR_EFFECT objects gate effect-complete state. */
object LinkCompletionPolicy {
    suspend fun persistAcceptedReceipt(
        database: ZungunDatabase,
        operationId: String,
        receipt: VerifiedReceipt,
        at: Long,
        attempts: Int,
    ): OperationState {
        database.operations().receipt(ReceiptEntity(receipt.receiptId, operationId, receipt.keyId, receipt.algorithm, receipt.payloadJson, receipt.signatureBase64, receipt.payloadSha256, at))
        database.operations().evidence(evidence(operationId, "APPLICATION_ACK", at, receipt.receiptId, "outcome=${receipt.applicationOutcome}"))
        database.operations().evidence(evidence(operationId, "SIGNED_RECEIPT", at, receipt.receiptId, "keyId=${receipt.keyId};payloadSha256=${receipt.payloadSha256}"))
        if (receipt.applicationOutcome == "REJECTED") {
            database.operations().forceState(operationId, OperationState.REJECTED.name, null, at, attempts)
            return OperationState.REJECTED
        }
        val requiredPending = database.link().requiredEffectPendingCount(operationId)
        if (requiredPending > 0) {
            database.operations().forceState(operationId, OperationState.RECEIVER_ACCEPTED.name, "REQUIRED_FOR_EFFECT_PENDING:$requiredPending", at, attempts)
            database.operations().evidence(evidence(operationId, "REQUIRED_FOR_EFFECT_PENDING", at, receipt.receiptId, "pending=$requiredPending"))
            return OperationState.RECEIVER_ACCEPTED
        }
        database.operations().forceState(operationId, OperationState.COMPLETED.name, null, at, attempts)
        return OperationState.COMPLETED
    }

    suspend fun finalizeAfterDeferredTransfer(database: ZungunDatabase, operationId: String, at: Long): Boolean {
        val operation = database.operations().get(operationId) ?: return false
        if (operation.state != OperationState.RECEIVER_ACCEPTED.name) return false
        if (database.link().requiredEffectPendingCount(operationId) != 0) return false
        val receipt = database.operations().receiptFor(operationId) ?: return false
        database.operations().forceState(operationId, OperationState.COMPLETED.name, null, at, operation.attempts)
        database.operations().evidence(evidence(operationId, "REQUIRED_FOR_EFFECT_SATISFIED", at, receipt.receiptId, "effectComplete=true"))
        return true
    }

    private fun evidence(operationId: String, kind: String, at: Long, reference: String, detail: String) = EvidenceEntity(
        operationId = operationId,
        source = if (kind == "APPLICATION_ACK") "APPLICATION" else "DEVICE",
        kind = kind,
        occurredAtMs = at,
        reference = reference,
        payloadJson = "{\"detail\":${org.json.JSONObject.quote(detail)}}",
        sha256 = EvidenceHasher.sha256("$operationId|$kind|$at|$reference|$detail"),
    )
}
