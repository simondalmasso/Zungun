package com.zungun.runtime.link

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import java.util.concurrent.atomic.AtomicBoolean

internal data class LinkWakeDispatchResult(
    val recoveredOperations: Int,
    val deferredOperations: Int,
    val prefetchOperations: Int,
)

internal object LinkNetworkWakeDispatcher {
    suspend fun dispatch(context: Context): LinkWakeDispatchResult {
        val provider = runCatching { DeliveryRuntimeRegistry.require() }.getOrNull()
            ?: return LinkWakeDispatchResult(0, 0, 0)
        val database = provider.database(context.applicationContext)
        return try {
            val recovered = CriticalOperationRuntime(context.applicationContext, database).recoverPending(replaceProvenNotSentBackoff=true)
            val deferred = database.link().operationsWithPendingDeferred()
            deferred.forEach { DeferredTransferScheduler.enqueue(context.applicationContext, it) }
            val prefetch = database.link().operationsWithPendingPrefetch()
            prefetch.forEach { LinkPrefetchScheduler.enqueue(context.applicationContext, it) }
            LinkWakeDispatchResult(recovered, deferred.size, prefetch.size)
        } finally {
            database.close()
        }
    }
}

object LinkNetworkWakeRegistry {
    private const val NETWORK_WAKE_WORK = "zungun:link:network-wake"
    private val started = AtomicBoolean(false)
    private val wakeOutstanding = AtomicBoolean(false)
    @Volatile private var observer: LinkNetworkObserver? = null
    @Volatile private var latestSnapshot: LinkSnapshot? = null

    fun ensure(context: Context) {
        if (!started.compareAndSet(false, true)) return
        val app = context.applicationContext
        observer = LinkNetworkObserver(app) { snapshot -> acceptSnapshot(app, snapshot) }
            .also { it.start() }
    }

    internal fun acceptSnapshot(
        context: Context,
        snapshot: LinkSnapshot,
        enqueue: (Context) -> Unit = ::enqueueRuntimeWake,
    ): Boolean {
        latestSnapshot = snapshot
        if (!wakeOutstanding.compareAndSet(false, true)) return false
        return try {
            enqueue(context.applicationContext)
            true
        } catch (error: Throwable) {
            wakeOutstanding.set(false)
            throw error
        }
    }

    private fun enqueueRuntimeWake(context: Context) {
        WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
            NETWORK_WAKE_WORK,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<LinkWakeWorker>().build(),
        )
    }

    internal fun completeWake() {
        wakeOutstanding.set(false)
    }

    internal fun resetForTest() {
        observer?.close()
        observer = null
        latestSnapshot = null
        started.set(false)
        wakeOutstanding.set(false)
    }

    fun latest(nowMs: Long): LinkSnapshot? = latestSnapshot?.takeIf {
        nowMs >= it.observedAtMs && nowMs - it.observedAtMs <= it.maxAgeMs
    }
}

class LinkWakeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        LinkNetworkWakeDispatcher.dispatch(applicationContext)
        Result.success()
    } finally {
        LinkNetworkWakeRegistry.completeWake()
    }
}
