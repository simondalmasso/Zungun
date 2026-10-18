package com.zungun.runtime.link

import org.junit.Assert.assertEquals
import org.junit.Test

class LinkPlannerGoldenTest {
    @Test
    fun sharedTypeScriptKotlinCorpusMatchesExactly() {
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream("link-planner-v1.vectors")) {
            "LINK_VECTOR_CORPUS_MISSING"
        }
        val lines = stream.bufferedReader().use { it.readLines() }.filter { it.isNotBlank() }.drop(1)
        assertEquals(10, lines.size)
        for (line in lines) {
            val parts = line.split('|')
            require(parts.size == 41) { "LINK_VECTOR_COLUMN_COUNT:${parts.size}" }
            val plan = LinkPlanner.create(row(parts))
            val actual = listOf(
                plan.decision.name,
                plan.reasonCodes.joinToString("+"),
                plan.plannedBytes.toString(),
                plan.profileHash,
                plan.snapshotHash,
                plan.planId,
            )
            assertEquals(parts[0], parts.subList(35, 41), actual)
        }
    }

    private fun row(parts: List<String>): LinkPlannerInput {
        fun value(index: Int) = parts[index]
        fun nullable(value: String): String? = if (value == "~") null else value
        fun nullableLong(index: Int) = nullable(value(index))?.toLong()
        fun bool(index: Int) = value(index) == "true"

        val profile = DeliveryProfileV2(
            urgency = LinkUrgency.valueOf(value(2)),
            deadlineAtMs = nullableLong(3),
            expiresAtMs = nullableLong(4),
            maxDelayMs = nullableLong(5),
            retryContract = LinkRetryContract.valueOf(value(6)),
            idempotencyRequired = bool(7),
            semanticRevalidationRequired = true,
            orderingKey = null,
            dependencies = emptyList(),
            payloadStrategy = LinkPayloadStrategy.valueOf(value(8)),
            maxImmediateBytes = value(9).toInt(),
            allowMetered = bool(10),
            allowRoaming = bool(11),
            allowCongested = bool(12),
            allowUnvalidated = bool(13),
            heavyDataPolicy = "DEFER_ON_CONSTRAINED",
            activeProbeBudgetBytes = 0,
            transportAllowlist = listOf("http"),
            receiptRequirement = "DURABLE_ACCEPTANCE",
            evidenceRequirement = "FULL_WITNESS",
        )
        val snapshot = LinkSnapshot(
            snapshotId = "s1",
            observedAtMs = value(14).toLong(),
            maxAgeMs = value(15).toLong(),
            hasNetwork = bool(16),
            internetCapable = bool(17),
            validated = bool(18),
            captivePortal = bool(19),
            metered = bool(20),
            temporarilyUnmetered = bool(21),
            congested = bool(22),
            roaming = bool(23),
            vpn = false,
            suspended = bool(24),
            downstreamKbps = 1000,
            upstreamKbps = 500,
            transports = listOf("CELLULAR"),
            networkKey = "net:1",
            recentRttMsEwma = 100,
            recentFailureRateEwma = 0,
            recentThroughputKbpsEwma = 500,
        )
        val payload = LinkPayloadShape(
            fullBytes = value(25).toInt(),
            criticalCoreBytes = nullable(value(26))?.toInt(),
            deferredBytes = value(27).toInt(),
            deltaBytes = nullable(value(28))?.toInt(),
            deltaBaseRequired = nullable(value(29)),
            deltaBaseAvailable = nullable(value(30)),
            hasRequiredDeferredEvidence = value(27).toInt() > 0,
        )
        return LinkPlannerInput(
            nowMs = value(1).toLong(),
            opId = "op1",
            profile = profile,
            snapshot = snapshot,
            payload = payload,
            transports = listOf(LinkTransportCapability("http", true, null, true)),
            priorAmbiguousOutcome = bool(31),
            automaticRetryAttempt = bool(32),
            activeProbeBytesUsed = 0,
            hasOutstandingDeferredObjects = bool(33),
            prefetchEligible = bool(34),
        )
    }
}
