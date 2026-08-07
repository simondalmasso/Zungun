package com.zungun.runtime

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
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PersistenceRecoveryInstrumentedTest {
    @Test
    fun offlineEnqueueSurvivesRuntimeRecreationAndRecoveryWithWitnessHistory() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )
        val name = "process-recovery-order080.sqlite"
        context.deleteDatabase(name)
        var db = ZungunDatabase.open(context, name)
        var runtime = CriticalOperationRuntime(context, db)
        val now = System.currentTimeMillis()
        val id = runtime.enqueue(
            EnqueueRequest(
                "tenant", "device", 1, "SHIFT", "shift", "WO-1", "msg-1",
                "sha256:message", "{}".toByteArray(), "application/json",
                OperationPolicy(2, now, now + 3_600_000, 5, true, true, 16_384),
            ),
            now,
        )
        assertNotNull(db.operations().get(id))
        val before = db.operations().witnessFor(id)
        assertEquals(listOf("DETECTED", "COMMITTED_LOCAL"), before.map { it.state })
        assertEquals(listOf(0, 1), before.map { it.chainPosition })
        assertEquals(null, before.first().previousHash)
        assertEquals(before.first().evidenceSha256, before.last().previousHash)
        assertTrue(before.all { JSONObject(it.evidenceJson).getString("incidentId") == id })
        db.close()

        db = ZungunDatabase.open(context, name)
        runtime = CriticalOperationRuntime(context, db)
        assertEquals(id, db.operations().get(id)?.operationId)
        val after = db.operations().witnessFor(id)
        assertEquals(before.map { it.evidenceSha256 }, after.map { it.evidenceSha256 })
        assertEquals(1, runtime.recoverPending())
        db.close()
        context.deleteDatabase(name)
    }
}
