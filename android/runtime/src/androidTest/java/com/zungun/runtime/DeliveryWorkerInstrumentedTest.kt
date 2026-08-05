package com.zungun.runtime

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.workDataOf
import androidx.work.testing.TestListenableWorkerBuilder
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.CriticalOperationRuntime
import com.zungun.runtime.delivery.DeliveryWorker
import com.zungun.runtime.delivery.SemanticRevalidator
import com.zungun.runtime.model.EnqueueRequest
import com.zungun.runtime.model.OperationPolicy
import com.zungun.runtime.model.OperationState
import com.zungun.runtime.network.CredentialProvider
import com.zungun.runtime.network.DeliveryDependencyProvider
import com.zungun.runtime.network.DeliveryRuntimeRegistry
import com.zungun.runtime.network.ReceiverConfiguration
import com.zungun.runtime.network.ReceiverTransportClient
import com.zungun.runtime.network.TransportResult
import com.zungun.runtime.network.VerifiedReceipt
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeliveryWorkerInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val databaseName = "delivery-worker-order076.sqlite"

    @After
    fun cleanup() {
        DeliveryRuntimeRegistry.clear()
        context.deleteDatabase(databaseName)
    }

    @Test
    fun ambiguousTransportPersistsAttemptAndUnknownState() = runBlocking {
        val operationId = enqueue()
        install(ReceiverTransportClient { _, _, _ -> TransportResult.AmbiguousFailure("SOCKET_TIMEOUT") })
        val result = worker(operationId).doWork()
        assertEquals(ListenableWorker.Result.retry()::class, result::class)
        val database = ZungunDatabase.open(context, databaseName)
        try {
            assertEquals(OperationState.UNKNOWN.name, database.operations().get(operationId)?.state)
            assertEquals(1, database.operations().attemptsFor(operationId).size)
            assertEquals("UNKNOWN", database.operations().attemptsFor(operationId).single().status)
        } finally {
            database.close()
        }
    }

    @Test
    fun verifiedReceiptCompletesOperationAndPersistsEvidence() = runBlocking {
        val operationId = enqueue()
        val receipt = VerifiedReceipt(
            receiptId = "receipt_test",
            keyId = "key_test",
            algorithm = "ECDSA_P256_SHA256",
            payloadJson = "{\"applicationOutcome\":\"EFFECT_APPLIED\"}",
            signatureBase64 = "verified-by-transport-client",
            payloadSha256 = "a".repeat(64),
            applicationOutcome = "EFFECT_APPLIED",
        )
        install(ReceiverTransportClient { _, _, _ ->
            TransportResult.Accepted(
                duplicate = true,
                receiverState = "COMPLETED",
                receipt = receipt,
                httpStatus = 202,
                responseSha256 = "b".repeat(64),
            )
        })
        val result = worker(operationId).doWork()
        assertEquals(ListenableWorker.Result.success()::class, result::class)
        val database = ZungunDatabase.open(context, databaseName)
        try {
            assertEquals(OperationState.COMPLETED.name, database.operations().get(operationId)?.state)
            assertNotNull(database.operations().receiptFor(operationId))
            val kinds = database.operations().evidenceFor(operationId).map { it.kind }
            assertTrue(kinds.containsAll(listOf("TRANSPORT_ATTEMPT", "RECEIVER_ACCEPTED", "APPLICATION_ACK", "SIGNED_RECEIPT")))
        } finally {
            database.close()
        }
    }

    private suspend fun enqueue(): String {
        context.deleteDatabase(databaseName)
        val now = System.currentTimeMillis()
        val database = ZungunDatabase.open(context, databaseName)
        return CriticalOperationRuntime(context, database).enqueue(
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
        ).also { database.close() }
    }

    private fun install(client: ReceiverTransportClient) {
        DeliveryRuntimeRegistry.install(object : DeliveryDependencyProvider {
            override fun database(context: Context) = ZungunDatabase.open(context, databaseName)

            override fun receiverConfiguration(context: Context) = ReceiverConfiguration(
                endpointUrl = "http://10.0.2.2:8788",
                receiverId = "receiver_test",
                credentialProvider = CredentialProvider { "instrumentation-token-order076" },
                allowCleartextLoopback = true,
            )

            override fun semanticRevalidator(context: Context) = SemanticRevalidator { Result.success(Unit) }
            override fun transportClient(context: Context) = client
        })
    }

    private fun worker(operationId: String): DeliveryWorker = TestListenableWorkerBuilder<DeliveryWorker>(context)
        .setInputData(workDataOf("operationId" to operationId))
        .build()
}
