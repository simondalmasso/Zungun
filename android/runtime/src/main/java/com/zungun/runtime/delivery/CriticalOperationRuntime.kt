package com.zungun.runtime.delivery

import android.content.Context
import androidx.room.withTransaction
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.zungun.runtime.db.EvidenceEntity
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationState
import java.util.concurrent.TimeUnit

class CriticalOperationRuntime(
    private val context: Context,
    private val database: ZungunDatabase = ZungunDatabase.open(context),
) {
    suspend fun enqueue(
        request: EnqueueRequest,
        nowMs: Long = request.policy.createdAtMs,
    ): String {
        require(request.payload.size <= request.policy.maxPayloadBytes) {
            "Payload exceeds maxPayloadBytes"
        }
        require(request.policy.expiresAtMs > nowMs) {
            "Operation must not be expired when enqueued"
        }
        require(request.policy.retryBudget in 0..100) {
            "retryBudget must be between 0 and 100"
        }

        val operationId = StableIdentity.operationId(
            tenantId = request.tenantId,
            deviceId = request.deviceId,
            sequence = request.localSequence,
            createdAtMs = request.policy.createdAtMs,
        )
        val entity = OperationEntity(
            operationId = operationId,
            idempotencyKey = "idem_$operationId",
            tenantId = request.tenantId,
            deviceId = request.deviceId,
            scopeType = request.scopeType,
            scopeId = request.scopeId,
            workOrderId = request.workOrderId,
            messageId = request.messageId,
            messageCommitment = request.messageCommitment,
            replayNonce = "nonce_$operationId",
            payload = request.payload,
            contentType = request.contentType,
            priority = request.policy.priority,
            createdAtMs = request.policy.createdAtMs,
            expiresAtMs = request.policy.expiresAtMs,
            retryBudget = request.policy.retryBudget,
            maxPayloadBytes = request.policy.maxPayloadBytes,
            attempts = 0,
            cancellationAllowed = request.policy.cancellationAllowed,
            semanticRevalidationRequired = request.policy.semanticRevalidationRequired,
            state = OperationState.QUEUED.name,
            lastError = null,
            updatedAtMs = nowMs,
        )

        database.withTransaction {
            val inserted = database.operations().insert(entity)
            if (inserted == -1L) {
                val existing = database.operations().get(operationId)
                    ?: error("IDEMPOTENCY_CONFLICT")
                require(existing.messageCommitment == request.messageCommitment &&
                    existing.payload.contentEquals(request.payload)) {
                    "IDEMPOTENCY_CONFLICT"
                }
            } else {
                database.operations().evidence(
                    EvidenceEntity(
                        operationId = operationId,
                        source = "DEVICE",
                        kind = "QUEUED",
                        occurredAtMs = nowMs,
                        reference = "local",
                        payloadJson = "{}",
                        sha256 = EvidenceHasher.sha256("$operationId|QUEUED|$nowMs"),
                    ),
                )
            }
        }
        schedule(operationId)
        return operationId
    }

    fun schedule(operationId: String) {
        val request = OneTimeWorkRequestBuilder<DeliveryWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf("operationId" to operationId))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            .addTag("zungun:$operationId")
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "zungun:$operationId",
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    suspend fun cancel(operationId: String, nowMs: Long): Boolean {
        val cancelled = database.operations().cancel(operationId, nowMs) == 1
        if (cancelled) WorkManager.getInstance(context).cancelUniqueWork("zungun:$operationId")
        return cancelled
    }

    suspend fun recoverPending(): Int {
        val pending = database.operations().pending()
        pending.forEach { schedule(it.operationId) }
        return pending.size
    }
}
