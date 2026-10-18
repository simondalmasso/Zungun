package com.zungun.runtime

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.workDataOf
import androidx.work.testing.TestListenableWorkerBuilder
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.db.TransportAttemptEntity
import com.zungun.runtime.delivery.DeliveryWorker
import com.zungun.runtime.delivery.SemanticRevalidator
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
        val operationId = seed()
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
        val operationId = seed()
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

    @Test
    fun deliveringOperationIsNotReclaimedOrSentAgain() = runBlocking {
        val operationId = seed(OperationState.DELIVERING)
        var calls = 0
        install(ReceiverTransportClient { _, _, _ ->
            calls += 1
            TransportResult.AmbiguousFailure("SHOULD_NOT_SEND")
        })
        val result = worker(operationId).doWork()
        assertEquals(ListenableWorker.Result.retry()::class, result::class)
        assertEquals(0, calls)
        val database = ZungunDatabase.open(context, databaseName)
        try {
            assertEquals(OperationState.DELIVERING.name, database.operations().get(operationId)?.state)
            assertTrue(database.operations().attemptsFor(operationId).isEmpty())
        } finally {
            database.close()
        }
    }

    @Test
    fun staleDeliveringAttemptRecoversToUnknownWithoutImmediateResend() = runBlocking {
        val operationId = seed(OperationState.DELIVERING)
        val startedAt = System.currentTimeMillis() - 1_000
        val database = ZungunDatabase.open(context, databaseName)
        try {
            database.operations().transportAttempt(
                TransportAttemptEntity(
                    attemptId = "transport_stale_$operationId",
                    operationId = operationId,
                    attemptNumber = 1,
                    startedAtMs = startedAt,
                    completedAtMs = null,
                    status = "STARTED",
                    httpStatus = null,
                    responseSha256 = null,
                    errorCode = null,
                ),
            )
        } finally {
            database.close()
        }

        var calls = 0
        install(ReceiverTransportClient { _, _, _ ->
            calls += 1
            TransportResult.AmbiguousFailure("SHOULD_NOT_SEND_DURING_RECOVERY")
        })
        val result = worker(operationId).doWork()
        assertEquals(ListenableWorker.Result.retry()::class, result::class)
        assertEquals(0, calls)

        val recoveredDatabase = ZungunDatabase.open(context, databaseName)
        try {
            assertEquals(OperationState.UNKNOWN.name, recoveredDatabase.operations().get(operationId)?.state)
            val attempt = recoveredDatabase.operations().attemptsFor(operationId).single()
            assertEquals("UNKNOWN", attempt.status)
            assertNotNull(attempt.completedAtMs)
            assertEquals("PROCESS_INTERRUPTED_DURING_DELIVERY", attempt.errorCode)
            assertTrue(recoveredDatabase.operations().evidenceFor(operationId).any { it.kind == "UNKNOWN" })
        } finally {
            recoveredDatabase.close()
        }
    }

    private suspend fun seed(state: OperationState = OperationState.QUEUED): String {
        context.deleteDatabase(databaseName)
        val now = System.currentTimeMillis()
        val operationId = "op_worker_${state.name.lowercase()}_$now"
        val database = ZungunDatabase.open(context, databaseName)
        try {
            val inserted = database.operations().insert(
                OperationEntity(
                    operationId = operationId,
                    idempotencyKey = "idem_$operationId",
                    tenantId = "tenant",
                    deviceId = "device",
                    scopeType = "SHIFT",
                    scopeId = "shift",
                    workOrderId = "WO-1",
                    messageId = "msg-1",
                    messageCommitment = "sha256:message",
                    replayNonce = "nonce_$operationId",
                    payload = "{}".toByteArray(),
                    contentType = "application/json",
                    priority = 2,
                    createdAtMs = now,
                    expiresAtMs = now + 3_600_000,
                    retryBudget = 5,
                    maxPayloadBytes = 16_384,
                    attempts = if (state == OperationState.DELIVERING) 1 else 0,
                    cancellationAllowed = true,
                    semanticRevalidationRequired = true,
                    state = state.name,
                    lastError = null,
                    updatedAtMs = now,
                ),
            )
            check(inserted != -1L)
            return operationId
        } finally {
            database.close()
        }
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
