package com.zungun.runtime

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.db.ZungunDatabase
import com.zungun.runtime.link.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LinkRecoveryInstrumentedTest {
    @Test
    fun noAutomaticRetryGateAndProfileSurviveDatabaseReopen() {
        runBlocking {
            val context = ApplicationProvider.getApplicationContext<android.content.Context>()
            val name = "link-recovery-order081.sqlite"
            context.deleteDatabase(name)
            val profile = DeliveryProfileV2(
                urgency = LinkUrgency.HIGH,
                deadlineAtMs = null,
                expiresAtMs = 50_000,
                maxDelayMs = 5_000,
                retryContract = LinkRetryContract.NO_AUTOMATIC_RETRY,
                idempotencyRequired = true,
                semanticRevalidationRequired = true,
                orderingKey = null,
                dependencies = emptyList(),
                payloadStrategy = LinkPayloadStrategy.FULL_ONLY,
                maxImmediateBytes = 4096,
                allowMetered = false,
                allowRoaming = false,
                allowCongested = false,
                allowUnvalidated = false,
                heavyDataPolicy = "GOOD_LINK_ONLY",
                activeProbeBudgetBytes = 0,
                transportAllowlist = listOf("http"),
                receiptRequirement = "DURABLE_ACCEPTANCE",
                evidenceRequirement = "FULL_WITNESS",
            )
            var db = ZungunDatabase.open(context, name)
            val operation = OperationEntity(
                "op-link",
                "idem",
                "tenant",
                "device",
                "SHIFT",
                "scope",
                "wo",
                "msg",
                "commit",
                "nonce",
                "{}".toByteArray(),
                "application/json",
                2,
                1,
                100_000,
                3,
                16_384,
                1,
                true,
                true,
                "UNKNOWN",
                "timeout",
                2,
            )
            db.operations().insert(operation)
            db.link().linkState(LinkPersistence.state(operation.operationId, profile, 2))
            db.link().setRetryGate(operation.operationId, true, null, 3)
            db.close()
            db = ZungunDatabase.open(context, name)
            assertNotNull(db.link().state(operation.operationId))
            assertEquals(true, db.link().state(operation.operationId)!!.automaticRetryBlocked)
            assertEquals(0, db.link().recoverableOperations().count { it.operationId == operation.operationId })
            db.close()
            context.deleteDatabase(name)
        }
    }
}
