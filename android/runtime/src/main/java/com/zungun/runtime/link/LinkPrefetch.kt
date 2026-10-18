package com.zungun.runtime.link

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.zungun.runtime.network.DeliveryRuntimeRegistry

data class LinkPrefetchSpec(
    val resourceKey: String,
    val revisionOrHash: String,
    val sizeEstimate: Long,
    val expiresAtMs: Long,
    val priority: Int,
    val sensitivityClass: String,
    val providerKey: String,
)

data class LinkPrefetchRequest(
    val resourceKey: String,
    val revisionOrHash: String,
    val sizeEstimate: Long,
    val sensitivityClass: String,
    val providerKey: String,
    val network: Network?,
)

data class LinkPrefetchResult(val storedRevisionOrHash: String, val bytesStored: Long)

fun interface LinkPrefetchAdapter {
    suspend fun fetch(request: LinkPrefetchRequest): LinkPrefetchResult
}

object LinkPrefetchScheduler {
    fun enqueue(context: Context, operationId: String) {
        val request = OneTimeWorkRequestBuilder<LinkPrefetchWorker>()
            .setInputData(workDataOf("operationId" to operationId))
            .addTag("zungun:link:prefetch:$operationId")
            .build()
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            "zungun:link:prefetch:$operationId", ExistingWorkPolicy.KEEP, request,
        )
    }
}

class LinkPrefetchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val operationId = inputData.getString("operationId") ?: return Result.failure()
        val provider = runCatching { DeliveryRuntimeRegistry.require() }.getOrNull() ?: return Result.success()
        val adapter = provider.prefetchAdapter(applicationContext) ?: return Result.success()
        val database = provider.database(applicationContext)
        try {
            val now = System.currentTimeMillis()
            val snapshot = LinkCoordinator(applicationContext, database).observeSnapshot(now)
            val good = snapshot.validated && snapshot.internetCapable && !snapshot.captivePortal && !snapshot.suspended &&
                (!snapshot.metered || snapshot.temporarilyUnmetered) && !snapshot.congested && !snapshot.roaming
            if (!good) return Result.success()
            val network = applicationContext.getSystemService(ConnectivityManager::class.java).activeNetwork
            for (hint in database.link().pendingPrefetch(operationId)) {
                if (hint.expiresAtMs <= now) { database.link().setPrefetchState(operationId,hint.resourceKey,"EXPIRED",now); continue }
                require(hint.sizeEstimate in 0..64L*1024*1024) { "LINK_PREFETCH_SIZE_INVALID" }
                require(hint.providerKey.matches(Regex("[A-Za-z0-9._:-]{1,128}"))) { "LINK_PREFETCH_PROVIDER_INVALID" }
                database.link().setPrefetchState(operationId,hint.resourceKey,"IN_PROGRESS",now)
                val result = runCatching { adapter.fetch(LinkPrefetchRequest(hint.resourceKey,hint.revisionOrHash,hint.sizeEstimate,hint.sensitivityClass,hint.providerKey,network)) }
                if (result.isFailure) { database.link().setPrefetchState(operationId,hint.resourceKey,"PENDING",System.currentTimeMillis()); return Result.success() }
                val value = result.getOrThrow()
                require(value.storedRevisionOrHash == hint.revisionOrHash) { "LINK_PREFETCH_REVISION_MISMATCH" }
                require(value.bytesStored in 0..hint.sizeEstimate) { "LINK_PREFETCH_BYTES_INVALID" }
                database.link().setPrefetchState(operationId,hint.resourceKey,"COMPLETED",System.currentTimeMillis())
            }
            return Result.success()
        } finally { database.close() }
    }
}
