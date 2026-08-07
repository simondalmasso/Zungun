package com.zungun.runtime.delivery

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.zungun.runtime.db.EvidenceEntity
import com.zungun.runtime.db.ReceiptEntity
import com.zungun.runtime.db.TransportAttemptEntity
import com.zungun.runtime.model.OperationState
import com.zungun.runtime.network.ConnectivityClassifier
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import com.zungun.runtime.network.TransportResult
import java.util.UUID

class DeliveryWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val operationId = inputData.getString("operationId") ?: return Result.failure()
        val dependencies = runCatching { DeliveryRuntimeRegistry.require() }.getOrElse {
            return Result.retry()
        }
        val database = dependencies.database(applicationContext)
        try {
            val dao = database.operations()
            val initial = dao.get(operationId) ?: return Result.failure()
            val now = System.currentTimeMillis()
            if (initial.state in TERMINAL_STATES) return Result.success()
            if (initial.expiresAtMs <= now) {
                dao.forceState(operationId, OperationState.EXPIRED.name, "TTL_EXPIRED", now, initial.attempts)
                return Result.failure(workDataOf("error" to "TTL_EXPIRED"))
            }
            if (initial.attempts >= initial.retryBudget) {
                dao.forceState(operationId, OperationState.UNKNOWN.name, "RETRY_BUDGET_EXHAUSTED", now, initial.attempts)
                return Result.failure(workDataOf("error" to "RETRY_BUDGET_EXHAUSTED"))
            }

            if (initial.semanticRevalidationRequired) {
                val validation = dependencies.semanticRevalidator(applicationContext).validate(initial)
                if (validation.isFailure) {
                    dao.forceState(
                        operationId,
                        OperationState.REJECTED.name,
                        "SEMANTIC_PRECONDITION_FAILED",
                        now,
                        initial.attempts,
                    )
                    return Result.failure(workDataOf("error" to "SEMANTIC_PRECONDITION_FAILED"))
                }
            }

            val connectivity = ConnectivityClassifier(applicationContext).current()
            val payloadDecision = PayloadPolicy.decide(
                connectivity,
                initial.payload.size,
                initial.maxPayloadBytes,
            )
            if (!payloadDecision.allowed) return Result.retry()

            val attemptNumber = initial.attempts + 1
            val attemptId = "transport_${UUID.randomUUID()}"
            val transitioned = database.withTransaction {
                val current = dao.get(operationId) ?: return@withTransaction false
                if (current.state in TERMINAL_STATES) return@withTransaction false
                val changed = dao.transition(
                    operationId,
                    current.state,
                    OperationState.DELIVERING.name,
                    null,
                    now,
                    attemptNumber,
                )
                if (changed != 1) return@withTransaction false
                dao.transportAttempt(
                    TransportAttemptEntity(
                        attemptId = attemptId,
                        operationId = operationId,
                        attemptNumber = attemptNumber,
                        startedAtMs = now,
                        completedAtMs = null,
                        status = "STARTED",
                        httpStatus = null,
                        responseSha256 = null,
                        errorCode = null,
                    ),
                )
                dao.evidence(evidence(operationId, "TRANSPORT_ATTEMPT", now, attemptId, "attempt=$attemptNumber"))
                true
            }
            if (!transitioned) return Result.retry()

            val current = dao.get(operationId) ?: return Result.failure()
            val result = dependencies.transportClient(applicationContext).deliver(
                current,
                dependencies.receiverConfiguration(applicationContext),
                System.currentTimeMillis(),
            )
            val completedAtMs = System.currentTimeMillis()
            return database.withTransaction {
                when (result) {
                    is TransportResult.Accepted -> {
                        dao.completeTransportAttempt(
                            attemptId,
                            completedAtMs,
                            "ACCEPTED",
                            result.httpStatus,
                            result.responseSha256,
                            null,
                        )
                        dao.evidence(evidence(
                            operationId,
                            "RECEIVER_ACCEPTED",
                            completedAtMs,
                            attemptId,
                            "duplicate=${result.duplicate};state=${result.receiverState}",
                        ))
                        val receipt = result.receipt
                        if (receipt == null) {
                            dao.forceState(
                                operationId,
                                OperationState.RECEIVER_ACCEPTED.name,
                                "APPLICATION_ACK_MISSING",
                                completedAtMs,
                                attemptNumber,
                            )
                            Result.retry()
                        } else {
                            dao.receipt(
                                ReceiptEntity(
                                    receiptId = receipt.receiptId,
                                    operationId = operationId,
                                    keyId = receipt.keyId,
                                    algorithm = receipt.algorithm,
                                    payloadJson = receipt.payloadJson,
                                    signatureBase64 = receipt.signatureBase64,
                                    payloadSha256 = receipt.payloadSha256,
                                    verifiedAtMs = completedAtMs,
                                ),
                            )
                            dao.evidence(evidence(
                                operationId,
                                "APPLICATION_ACK",
                                completedAtMs,
                                receipt.receiptId,
                                "outcome=${receipt.applicationOutcome}",
                            ))
                            dao.evidence(evidence(
                                operationId,
                                "SIGNED_RECEIPT",
                                completedAtMs,
                                receipt.receiptId,
                                "keyId=${receipt.keyId};payloadSha256=${receipt.payloadSha256}",
                            ))
                            val finalState = if (receipt.applicationOutcome == "REJECTED") {
                                OperationState.REJECTED
                            } else {
                                OperationState.COMPLETED
                            }
                            dao.forceState(operationId, finalState.name, null, completedAtMs, attemptNumber)
                            Result.success(workDataOf(
                                "operationId" to operationId,
                                "state" to finalState.name,
                                "receiptId" to receipt.receiptId,
                            ))
                        }
                    }
                    is TransportResult.DeterministicFailure -> {
                        dao.completeTransportAttempt(
                            attemptId,
                            completedAtMs,
                            "REJECTED",
                            result.httpStatus,
                            result.responseSha256,
                            result.code,
                        )
                        dao.forceState(
                            operationId,
                            OperationState.REJECTED.name,
                            result.code,
                            completedAtMs,
                            attemptNumber,
                        )
                        dao.evidence(evidence(operationId, "REJECTED", completedAtMs, attemptId, result.code))
                        Result.failure(workDataOf("error" to result.code))
                    }
                    is TransportResult.AmbiguousFailure -> {
                        dao.completeTransportAttempt(
                            attemptId,
                            completedAtMs,
                            "UNKNOWN",
                            null,
                            null,
                            result.code,
                        )
                        dao.forceState(
                            operationId,
                            OperationState.UNKNOWN.name,
                            result.code,
                            completedAtMs,
                            attemptNumber,
                        )
                        dao.evidence(evidence(operationId, "UNKNOWN", completedAtMs, attemptId, result.code))
                        if (attemptNumber < current.retryBudget && completedAtMs < current.expiresAtMs) {
                            Result.retry()
                        } else {
                            Result.failure(workDataOf("error" to "OUTCOME_UNKNOWN"))
                        }
                    }
                }
            }
        } finally {
            database.close()
        }
    }

    private fun evidence(
        operationId: String,
        kind: String,
        occurredAtMs: Long,
        reference: String,
        detail: String,
    ) = EvidenceEntity(
        operationId = operationId,
        source = when (kind) {
            "APPLICATION_ACK" -> "APPLICATION"
            else -> "DEVICE"
        },
        kind = kind,
        occurredAtMs = occurredAtMs,
        reference = reference,
        payloadJson = "{\"detail\":${org.json.JSONObject.quote(detail)}}",
        sha256 = EvidenceHasher.sha256("$operationId|$kind|$occurredAtMs|$reference|$detail"),
    )

    companion object {
        private val TERMINAL_STATES = setOf(
            OperationState.COMPLETED.name,
            OperationState.REJECTED.name,
            OperationState.EXPIRED.name,
            OperationState.CANCELLED.name,
        )
    }
}
