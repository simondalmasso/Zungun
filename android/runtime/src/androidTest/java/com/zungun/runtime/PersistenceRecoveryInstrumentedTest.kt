package com.zungun.runtime

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.Configuration
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationPolicy
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PersistenceRecoveryInstrumentedTest {
    @Test
    fun offlineEnqueueSurvivesRuntimeRecreationAndRecovery() {
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<Context>()
            WorkManagerTestInitHelper.initializeTestWorkManager(
                context,
                Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
            )
            val databaseName = "process-recovery-order075.sqlite"
            context.deleteDatabase(databaseName)
            var database = ZungunDatabase.open(context, databaseName)
            var runtime = CriticalOperationRuntime(context, database)
            val now = System.currentTimeMillis()
            val operationId = runtime.enqueue(
                EnqueueRequest(
                    tenantId = "tenant",
                    deviceId = "device",
                    localSequence = 1,
                    scopeType = "SHIFT",
                    scopeId = "shift",
                    workOrderId = "WO-1",
                    messageId = "msg-1",
                    messageCommitment = "sha256:message",
                    payload = "{}".toByteArray(),
                    contentType = "application/json",
                    policy = OperationPolicy(2, now, now + 3_600_000, 5, true, true, 16_384),
                ),
                now,
            )
            assertNotNull(database.operations().get(operationId))
            database.close()

            database = ZungunDatabase.open(context, databaseName)
            runtime = CriticalOperationRuntime(context, database)
            assertEquals(operationId, database.operations().get(operationId)?.operationId)
            assertEquals(1, runtime.recoverPending())
            database.close()
            context.deleteDatabase(databaseName)
        }
    }
}
