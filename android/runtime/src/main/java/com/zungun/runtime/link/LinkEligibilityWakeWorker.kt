package com.zungun.runtime.link

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import java.util.concurrent.TimeUnit

object LinkEligibilityWakeScheduler {
    fun schedule(context: Context, operationId: String, eligibleAtMs: Long, nowMs: Long = System.currentTimeMillis()) {
        val delay = (eligibleAtMs - nowMs).coerceAtLeast(1_000)
        val request = OneTimeWorkRequestBuilder<LinkEligibilityWakeWorker>()
            .setInputData(workDataOf("operationId" to operationId))
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .addTag("zungun:link:eligibility:$operationId")
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            "zungun:link:eligibility:$operationId",
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }
}

class LinkEligibilityWakeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val operationId = inputData.getString("operationId") ?: return Result.failure()
        val provider = runCatching { DeliveryRuntimeRegistry.require() }.getOrNull() ?: return Result.success()
        val database = provider.database(applicationContext)
        return try {
            val linkState = database.link().state(operationId) ?: return Result.success()
            if (linkState.automaticRetryBlocked) return Result.success()
            CriticalOperationRuntime(applicationContext, database).schedule(operationId, true)
            Result.success()
        } finally {
            database.close()
        }
    }
}
