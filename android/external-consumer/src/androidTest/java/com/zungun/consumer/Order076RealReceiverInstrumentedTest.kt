package com.zungun.consumer

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.ListenableWorker
import androidx.work.WorkManager
import androidx.work.workDataOf
import androidx.work.testing.TestListenableWorkerBuilder
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.delivery.DeliveryWorker
import com.zungun.runtime.delivery.StableIdentity
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationPolicy
import com.zungun.runtime.model.OperationState
import com.zungun.runtime.network.CredentialProvider
import com.zungun.runtime.network.HttpReceiverTransportClient
import com.zungun.runtime.network.ReceiverConfiguration
import com.zungun.runtime.network.TransportResult
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Order076RealReceiverInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val arguments = InstrumentationRegistry.getArguments()
    private val endpoint get() = arguments.getString("endpoint") ?: "http://10.0.2.2:18789"
    private val token get() = arguments.getString("token") ?: error("token argument required")
    private val receiverId get() = arguments.getString("receiverId") ?: "receiver_order076b"

    @Test
    fun configureAndEnqueueOffline() = runBlocking {
        WorkManager.getInstance(context).cancelAllWork().result.get()
        val cleanDatabase = ZungunDatabase.open(context, DATABASE_NAME)
        try {
            cleanDatabase.clearAllTables()
        } finally {
            cleanDatabase.close()
        }
        ConsumerApplication.configure(context, endpoint, token, receiverId)
        val operationId = CriticalOperationRuntime(context).enqueue(request(), CREATED_AT_MS)
        assertEquals(OPERATION_ID, operationId)
        waitFor("offline attempt persisted as UNKNOWN", 90_000) {
            snapshot()?.let { it.state == OperationState.UNKNOWN.name && it.attempts >= 1 } == true
        }
        val value = snapshot() ?: error("operation not persisted")
        assertEquals(OperationState.UNKNOWN.name, value.state)
        assertTrue(value.attempts >= 1)
        println("ORDER076_OPERATION_ID=$operationId")
    }

    @Test
    fun assertProcessRecovery() = runBlocking {
        assertTrue(ConsumerApplication.installFromPreferences(context))
        val before = snapshot() ?: error("operation missing after force-stop")
        assertFalse(before.state in TERMINAL_STATES)
        val recovered = CriticalOperationRuntime(context).recoverPending()
        assertTrue(recovered >= 1)
        waitFor("WorkManager work restored after process stop", 30_000) {
            WorkManager.getInstance(context).getWorkInfosByTag("zungun:$OPERATION_ID").get().isNotEmpty()
        }
        assertNotNull(snapshot())
    }

    @Test
    fun assertRebootRecovery() = runBlocking {
        assertTrue(ConsumerApplication.installFromPreferences(context))
        val value = snapshot() ?: error("operation missing after emulator reboot")
        assertFalse(value.state in TERMINAL_STATES)
        assertTrue(value.attempts >= 1)
        waitFor("boot recovery scheduled durable operation", 45_000) {
            WorkManager.getInstance(context).getWorkInfosByTag("zungun:$OPERATION_ID").get().isNotEmpty()
        }
    }

    @Test
    fun assertLostResponseUnknown() = runBlocking {
        assertTrue(ConsumerApplication.installFromPreferences(context))
        val attemptsBeforeProxyDelivery = snapshot()?.attempts ?: error("operation missing before proxy delivery")
        CriticalOperationRuntime(context).recoverPending()
        waitFor("response lost after receiver persistence remains UNKNOWN", 120_000) {
            snapshot()?.let {
                it.state == OperationState.UNKNOWN.name && it.attempts > attemptsBeforeProxyDelivery
            } == true
        }
        val database = ZungunDatabase.open(context, DATABASE_NAME)
        try {
            val operation = database.operations().get(OPERATION_ID) ?: error("operation missing after proxy delivery")
            val attempts = database.operations().attemptsFor(OPERATION_ID)
            assertTrue(operation.attempts > attemptsBeforeProxyDelivery)
            assertEquals(OperationState.UNKNOWN.name, operation.state)
            assertTrue(attempts.count { it.status == "UNKNOWN" } >= 2)
            assertEquals(null, database.operations().receiptFor(OPERATION_ID))
        } finally {
            database.close()
        }
    }

    @Test
    fun awaitTerminalReceipt() = runBlocking {
        assertTrue(ConsumerApplication.installFromPreferences(context))
        CriticalOperationRuntime(context).recoverPending()
        waitFor("duplicate retry returned bound signed receipt", 150_000) {
            val database = ZungunDatabase.open(context, DATABASE_NAME)
            try {
                val operation = database.operations().get(OPERATION_ID)
                operation?.state == OperationState.COMPLETED.name &&
                    database.operations().receiptFor(OPERATION_ID) != null
            } finally {
                database.close()
            }
        }
        val database = ZungunDatabase.open(context, DATABASE_NAME)
        try {
            val operation = database.operations().get(OPERATION_ID) ?: error("operation missing")
            assertEquals(OperationState.COMPLETED.name, operation.state)
            val receipt = database.operations().receiptFor(OPERATION_ID)
            assertNotNull(receipt)
            assertTrue(receipt!!.payloadJson.contains(OPERATION_ID))
            assertTrue(receipt.payloadJson.contains(MESSAGE_COMMITMENT))
            val kinds = database.operations().evidenceFor(OPERATION_ID).map { it.kind }
            assertTrue(kinds.containsAll(listOf("RECEIVER_ACCEPTED", "APPLICATION_ACK", "SIGNED_RECEIPT")))
            assertTrue(database.operations().attemptsFor(OPERATION_ID).size >= 3)
        } finally {
            database.close()
        }
    }

    @Test
    fun verifyNegativeReceiptMatrix() = runBlocking {
        val original = snapshot() ?: error("primary operation missing")
        val client = HttpReceiverTransportClient()
        val missing = client.deliver(original, configuration("missing"), System.currentTimeMillis())
        assertTrue(missing is TransportResult.Accepted && missing.receipt == null)

        assertRejected("tampered", original)
        assertRejected("future", original)
        assertRejected("expired", original)
        assertRejected("revoked", original)
        assertRejected("mismatch", original.copy(
            operationId = "op_android_076b_binding_mismatch",
            idempotencyKey = "idem_android_076b_binding_mismatch",
            replayNonce = "nonce_android_076b_binding_mismatch",
        ))
    }

    private suspend fun assertRejected(mode: String, operation: OperationEntity) {
        val result = runCatching {
            HttpReceiverTransportClient().deliver(operation, configuration(mode), System.currentTimeMillis())
        }
        assertTrue("$mode receipt must fail closed", result.isFailure)
    }

    private fun configuration(mode: String) = ReceiverConfiguration(
        endpointUrl = "$endpoint/negative/$mode",
        receiverId = receiverId,
        credentialProvider = CredentialProvider { token },
        connectTimeoutMs = 3_000,
        readTimeoutMs = 5_000,
        allowCleartextLoopback = true,
    )

    private suspend fun snapshot(): OperationEntity? {
        val database = ZungunDatabase.open(context, DATABASE_NAME)
        return try { database.operations().get(OPERATION_ID) } finally { database.close() }
    }

    private fun request() = EnqueueRequest(
        tenantId = "tenant_order076b",
        deviceId = DEVICE_ID,
        localSequence = 76,
        scopeType = "SHIFT",
        scopeId = SCOPE_ID,
        workOrderId = ConsumerApplication.WORK_ORDER_ID,
        messageId = "msg_android_order076b",
        messageCommitment = MESSAGE_COMMITMENT,
        payload = "{\"action\":\"COMPLETE\",\"workOrderId\":\"${ConsumerApplication.WORK_ORDER_ID}\"}".toByteArray(),
        contentType = "application/json",
        policy = OperationPolicy(
            priority = 3,
            createdAtMs = CREATED_AT_MS,
            expiresAtMs = EXPIRES_AT_MS,
            retryBudget = 20,
            cancellationAllowed = false,
            semanticRevalidationRequired = true,
            maxPayloadBytes = 16_384,
        ),
    )

    private suspend fun waitFor(label: String, timeoutMs: Long, predicate: suspend () -> Boolean) {
        val started = System.currentTimeMillis()
        while (System.currentTimeMillis() - started < timeoutMs) {
            if (predicate()) return
            delay(500)
        }
        fail("timeout: $label; snapshot=${snapshot()}")
    }

    companion object {
        const val DATABASE_NAME = "zungun-critical-operations.db"
        const val DEVICE_ID = "device_android_076b"
        const val SCOPE_ID = "shift_android_076b"
        const val CREATED_AT_MS = 1_780_000_000_000L
        const val EXPIRES_AT_MS = 1_900_000_000_000L
        const val MESSAGE_COMMITMENT = "sha256:order076b-android-real-http"
        val OPERATION_ID: String = StableIdentity.operationId(
            "tenant_order076b", DEVICE_ID, 76, CREATED_AT_MS,
        )
        val TERMINAL_STATES = setOf(
            OperationState.COMPLETED.name,
            OperationState.REJECTED.name,
            OperationState.EXPIRED.name,
            OperationState.CANCELLED.name,
        )
    }
}
