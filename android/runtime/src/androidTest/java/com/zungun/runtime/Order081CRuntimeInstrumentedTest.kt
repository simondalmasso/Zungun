package com.zungun.runtime

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.zungun.runtime.db.DeferredObjectEntity
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.db.TransmissionPlanEntity
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.delivery.DeliveryWorker
import com.zungun.runtime.delivery.LinkDeliveryWorker
import com.zungun.runtime.delivery.SemanticRevalidator
import com.zungun.runtime.link.*
import com.zungun.runtime.model.OperationState
import com.zungun.runtime.network.*
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class Order081CRuntimeInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dbName = "order081c-${System.nanoTime()}.sqlite"

    @After
    fun cleanup() {
        DeliveryRuntimeRegistry.clear()
        context.deleteDatabase(dbName)
    }

    @Test
    fun requiredForEffectReceiptDoesNotFalseCompleteAcrossReopen() = runBlocking {
        val op = operation("effect-gate", OperationState.QUEUED.name, 0)
        ZungunDatabase.open(context, dbName).use { db ->
            db.operations().insert(op)
            db.link().linkState(LinkPersistence.state(op.operationId, profile(LinkPayloadStrategy.CORE_PLUS_DEFERRED), 1_000))
            db.link().deferred(deferred(op.operationId, "effect-object", "REQUIRED_FOR_EFFECT"))
            val state = LinkCompletionPolicy.persistAcceptedReceipt(db, op.operationId, receipt(op.operationId), 2_000, 1)
            assertEquals(OperationState.RECEIVER_ACCEPTED, state)
            assertEquals(1, db.link().requiredEffectPendingCount(op.operationId))
        }
        ZungunDatabase.open(context, dbName).use { db ->
            assertEquals(OperationState.RECEIVER_ACCEPTED.name, db.operations().get(op.operationId)!!.state)
            assertEquals(1, db.link().requiredEffectPendingCount(op.operationId))
            db.link().setDeferredState(op.operationId, "effect-object", "COMPLETED", 3_000)
            assertTrue(LinkCompletionPolicy.finalizeAfterDeferredTransfer(db, op.operationId, 3_001))
            assertEquals(OperationState.COMPLETED.name, db.operations().get(op.operationId)!!.state)
        }
    }

    @Test
    fun selectedDeltaBytesAreActuallyTransmittedAndStatusExposesProgress() = runBlocking {
        val op = operation("delta-send", OperationState.QUEUED.name, 0)
        val deltaBytes = "delta-v1".toByteArray()
        val delta = LinkDeltaSpec(sha256("base-v1".toByteArray()), deltaBytes)
        ZungunDatabase.open(context, dbName).use { db ->
            db.operations().insert(op)
            db.link().linkState(LinkPersistence.state(op.operationId, profile(LinkPayloadStrategy.DELTA_ALLOWED), 1_000, LinkPayloadMetadata(delta)))
            db.link().plan(TransmissionPlanEntity(
                planId = "plan-delta",
                operationId = op.operationId,
                plannerVersion = "link-planner-v1",
                profileHash = db.link().state(op.operationId)!!.profileHash,
                snapshotId = "snap-1",
                snapshotHash = "snap-hash",
                decision = "SEND_DELTA_NOW",
                reasonsJson = "[\"DELTA_BASE_AVAILABLE\"]",
                adapterId = "http",
                networkKey = "net-1",
                plannedBytes = deltaBytes.size,
                reconcileFirst = false,
                nextEligibilityAtMs = null,
                activeProbeAuthorized = false,
                activeProbeBudgetRemainingBytes = 0,
                createdAtMs = 1_100,
            ))
            db.link().deferred(deferred(op.operationId, "evidence-object", "REQUIRED_FOR_FINAL_EVIDENCE"))
        }
        val sent = mutableListOf<ByteArray>()
        DeliveryRuntimeRegistry.install(provider(ReceiverTransportClient { operation, _, _ ->
            sent += operation.payload.copyOf()
            TransportResult.Accepted(false, "COMPLETED", receipt(op.operationId), 200, sha256("ok".toByteArray()))
        }))
        TestListenableWorkerBuilder<DeliveryWorker>(context)
            .setInputData(workDataOf("operationId" to op.operationId))
            .build()
            .doWork()
        assertEquals(1, sent.size)
        assertTrue(sent.single().contentEquals(deltaBytes))
        ZungunDatabase.open(context, dbName).use { db ->
            assertTrue(db.operations().evidenceFor(op.operationId).any {
                it.kind == "TRANSMITTED_REPRESENTATION" && it.payloadJson.contains("DELTA") && it.payloadJson.contains(delta.sha256)
            })
            val status = LinkStatusReader.read(db, op.operationId)
            assertNotNull(status)
            assertEquals("plan-delta", status!!.planId)
            assertEquals("SEND_DELTA_NOW", status.planDecision)
            assertEquals(1, status.requiredFinalEvidencePending)
            assertNotNull(status.immediateReceiptId)
        }
    }

    @Test
    fun reconcileBeforeRetryRecoversAcceptanceWithoutSecondSideEffect() = runBlocking {
        val op = operation("reconcile-accepted", OperationState.UNKNOWN.name, 1)
        seedAmbiguous(op)
        val transportCalls = AtomicInteger(0)
        val queryCalls = AtomicInteger(0)
        DeliveryRuntimeRegistry.install(provider(
            transport = ReceiverTransportClient { _, _, _ ->
                transportCalls.incrementAndGet()
                error("SECOND_SIDE_EFFECT_SEND")
            },
            reconciliation = ReceiverReconciliationClient { _, _, _ ->
                queryCalls.incrementAndGet()
                ReceiverReconciliationResult.AcceptanceRecovered("COMPLETED", "EFFECT_APPLIED", receipt(op.operationId))
            },
        ))
        TestListenableWorkerBuilder<LinkDeliveryWorker>(context)
            .setInputData(workDataOf("operationId" to op.operationId))
            .build()
            .doWork()
        assertEquals(1, queryCalls.get())
        assertEquals(0, transportCalls.get())
        ZungunDatabase.open(context, dbName).use { db ->
            assertEquals(OperationState.COMPLETED.name, db.operations().get(op.operationId)!!.state)
            assertNotNull(db.operations().receiptFor(op.operationId))
            assertTrue(db.operations().evidenceFor(op.operationId).any { it.kind == "RECONCILIATION_RESULT" })
        }
    }

    @Test
    fun boundedNotAcceptedAllowsExactlyOneRetryButUnboundedNotFoundAllowsNone() = runBlocking {
        val bounded = operation("reconcile-bounded", OperationState.UNKNOWN.name, 1)
        seedAmbiguous(bounded)
        val boundedCalls = AtomicInteger(0)
        DeliveryRuntimeRegistry.install(provider(
            transport = ReceiverTransportClient { _, _, _ ->
                boundedCalls.incrementAndGet()
                TransportResult.Accepted(false, "COMPLETED", receipt(bounded.operationId), 200, sha256("ok".toByteArray()))
            },
            reconciliation = ReceiverReconciliationClient { _, _, _ -> ReceiverReconciliationResult.BoundedNotAccepted("proof-not-accepted") },
        ))
        TestListenableWorkerBuilder<LinkDeliveryWorker>(context)
            .setInputData(workDataOf("operationId" to bounded.operationId)).build().doWork()
        assertEquals(1, boundedCalls.get())

        val unbounded = operation("reconcile-unbounded", OperationState.UNKNOWN.name, 1)
        seedAmbiguous(unbounded)
        val unsafeCalls = AtomicInteger(0)
        DeliveryRuntimeRegistry.install(provider(
            transport = ReceiverTransportClient { _, _, _ ->
                unsafeCalls.incrementAndGet()
                error("UNSAFE_RESEND")
            },
            reconciliation = ReceiverReconciliationClient { _, _, _ -> ReceiverReconciliationResult.NotFoundUnbounded },
        ))
        TestListenableWorkerBuilder<LinkDeliveryWorker>(context)
            .setInputData(workDataOf("operationId" to unbounded.operationId)).build().doWork()
        assertEquals(0, unsafeCalls.get())
        ZungunDatabase.open(context, dbName).use { db ->
            assertEquals(OperationState.UNKNOWN.name, db.operations().get(unbounded.operationId)!!.state)
            assertTrue(db.link().state(unbounded.operationId)!!.automaticRetryBlocked)
        }
    }

    private suspend fun seedAmbiguous(op: OperationEntity) {
        ZungunDatabase.open(context, dbName).use { db ->
            db.operations().insert(op)
            db.link().linkState(LinkPersistence.state(op.operationId, profile(LinkPayloadStrategy.FULL_ONLY), 1_000))
        }
    }

    private fun provider(
        transport: ReceiverTransportClient,
        reconciliation: ReceiverReconciliationClient = ReceiverReconciliationClient { _, _, _ -> ReceiverReconciliationResult.QueryFailed("UNUSED") },
    ) = object : DeliveryDependencyProvider {
        override fun database(context: Context): ZungunDatabase = ZungunDatabase.open(context, dbName)
        override fun receiverConfiguration(context: Context) = ReceiverConfiguration(
            "http://10.0.2.2:18788",
            "receiver-order081c",
            CredentialProvider { "token-order081c-123456" },
            allowCleartextLoopback = true,
        )
        override fun semanticRevalidator(context: Context) = SemanticRevalidator { Result.success(Unit) }
        override fun transportClient(context: Context) = transport
        override fun transportClient(context: Context, adapterId: String): ReceiverTransportClient {
            require(adapterId == "http")
            return transport
        }
        override fun transportCapabilities(context: Context) = listOf(
            RuntimeTransportCapability(
                "http", true,
                supportsDurableReceipt = true,
                supportsReceiverQuery = true,
                supportsResume = true,
                supportsNetworkBinding = true,
            ),
        )
        override fun reconciliationClient(context: Context) = reconciliation
    }

    private fun operation(suffix: String, state: String, attempts: Int): OperationEntity = OperationEntity(
        operationId = "op-$suffix",
        idempotencyKey = "idem-$suffix",
        tenantId = "tenant",
        deviceId = "device",
        scopeType = "SHIFT",
        scopeId = "scope",
        workOrderId = "wo",
        messageId = "msg-$suffix",
        messageCommitment = "sha256:${sha256(suffix.toByteArray())}",
        replayNonce = "nonce-$suffix",
        payload = "full-semantic-payload-$suffix".toByteArray(),
        contentType = "application/json",
        priority = 9,
        createdAtMs = 1_000,
        expiresAtMs = Long.MAX_VALUE / 2,
        retryBudget = 5,
        maxPayloadBytes = 1_048_576,
        attempts = attempts,
        cancellationAllowed = false,
        semanticRevalidationRequired = false,
        state = state,
        lastError = if (state == OperationState.UNKNOWN.name) "LOST_RESPONSE_AFTER_SEND" else null,
        updatedAtMs = 1_000,
    )

    private fun profile(strategy: LinkPayloadStrategy) = DeliveryProfileV2(
        urgency = LinkUrgency.CRITICAL,
        deadlineAtMs = null,
        expiresAtMs = Long.MAX_VALUE / 2,
        maxDelayMs = 5_000,
        retryContract = LinkRetryContract.RECONCILE_BEFORE_RETRY,
        idempotencyRequired = true,
        semanticRevalidationRequired = false,
        orderingKey = null,
        dependencies = emptyList(),
        payloadStrategy = strategy,
        maxImmediateBytes = 4096,
        allowMetered = true,
        allowRoaming = true,
        allowCongested = true,
        heavyDataPolicy = "DEFER_ON_CONSTRAINED",
        activeProbeBudgetBytes = 0,
        transportAllowlist = listOf("http"),
        receiptRequirement = "DURABLE_ACCEPTANCE",
        evidenceRequirement = "FULL_WITNESS",
    )

    private fun deferred(operationId: String, objectId: String, requirement: String) = DeferredObjectEntity(
        operationId,
        objectId,
        "application/octet-stream",
        4096,
        sha256(objectId.toByteArray()),
        requirement,
        1024,
        "[]",
        "PENDING",
        1_000,
    )

    private fun receipt(operationId: String) = VerifiedReceipt(
        receiptId = "receipt-$operationId",
        keyId = "test-key",
        algorithm = "ES256",
        payloadJson = "{\"operationId\":\"$operationId\"}",
        signatureBase64 = "test-signature",
        payloadSha256 = sha256(operationId.toByteArray()),
        applicationOutcome = "EFFECT_APPLIED",
    )

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }
}
