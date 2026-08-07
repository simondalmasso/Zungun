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

object LinkNetworkWakeRegistry {
    private val started = AtomicBoolean(false)
    @Volatile private var observer: LinkNetworkObserver? = null
    @Volatile private var latestSnapshot: LinkSnapshot? = null

    fun ensure(context: Context) {
        if (!started.compareAndSet(false, true)) return
        val app = context.applicationContext
        observer = LinkNetworkObserver(app) { snapshot ->
            latestSnapshot = snapshot
            WorkManager.getInstance(app).enqueueUniqueWork(
                "zungun:link:network-wake",
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<LinkWakeWorker>().build(),
            )
        }.also { it.start() }
    }

    fun latest(nowMs: Long): LinkSnapshot? = latestSnapshot?.takeIf {
        nowMs >= it.observedAtMs && nowMs - it.observedAtMs <= it.maxAgeMs
    }
}

class LinkWakeWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
    override suspend fun doWork():Result{val provider=runCatching{DeliveryRuntimeRegistry.require()}.getOrNull()?:return Result.success();val db=provider.database(applicationContext);return try{CriticalOperationRuntime(applicationContext,db).recoverPending();db.link().operationsWithPendingDeferred().forEach{DeferredTransferScheduler.enqueue(applicationContext,it)};db.link().operationsWithPendingPrefetch().forEach{LinkPrefetchScheduler.enqueue(applicationContext,it)};Result.success()}finally{db.close()}}
}
