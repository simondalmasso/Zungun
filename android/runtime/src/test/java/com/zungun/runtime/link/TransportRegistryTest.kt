package com.zungun.runtime.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TransportRegistryTest {
    private val profile = DeliveryProfileV2(
        urgency = LinkUrgency.CRITICAL,
        deadlineAtMs = null,
        expiresAtMs = 100_000,
        maxDelayMs = 5_000,
        retryContract = LinkRetryContract.RECONCILE_BEFORE_RETRY,
        idempotencyRequired = true,
        semanticRevalidationRequired = true,
        orderingKey = null,
        dependencies = emptyList(),
        payloadStrategy = LinkPayloadStrategy.FULL_ONLY,
        maxImmediateBytes = 4096,
        allowMetered = true,
        allowRoaming = false,
        allowCongested = true,
        heavyDataPolicy = "DEFER_ON_CONSTRAINED",
        activeProbeBudgetBytes = 0,
        transportAllowlist = emptyList(),
        receiptRequirement = "DURABLE_ACCEPTANCE",
        evidenceRequirement = "FULL_WITNESS",
    )

    @Test fun filtersEvidenceIncapableCandidatesBeforeRanking() {
        val result = RuntimeTransportSelector.plannerCapabilities(profile, listOf(
            RuntimeTransportCapability("cheap-no-receipt", true, supportsDurableReceipt = false, supportsReceiverQuery = true, supportsResume = true, supportsNetworkBinding = true, estimatedCostMicrounitsPerMb = 1),
            RuntimeTransportCapability("safe", true, supportsDurableReceipt = true, supportsReceiverQuery = true, supportsResume = true, supportsNetworkBinding = true, estimatedCostMicrounitsPerMb = 100),
        ))
        assertEquals(listOf("safe"), result.map { it.adapterId })
    }

    @Test fun ranksMeasuredReliabilityThenRttThroughputCostWithStableTieBreak() {
        val candidates = listOf(
            RuntimeTransportCapability("unknown", true, supportsDurableReceipt = true, supportsReceiverQuery = true, supportsResume = true, supportsNetworkBinding = true),
            RuntimeTransportCapability("beta", true, supportsDurableReceipt = true, supportsReceiverQuery = true, supportsResume = true, supportsNetworkBinding = true, measuredReliabilityPermille = 998, measuredRttMs = 90, measuredThroughputKbps = 1000, estimatedCostMicrounitsPerMb = 30),
            RuntimeTransportCapability("alpha", true, supportsDurableReceipt = true, supportsReceiverQuery = true, supportsResume = true, supportsNetworkBinding = true, measuredReliabilityPermille = 998, measuredRttMs = 90, measuredThroughputKbps = 1000, estimatedCostMicrounitsPerMb = 30),
            RuntimeTransportCapability("lower-reliability", true, supportsDurableReceipt = true, supportsReceiverQuery = true, supportsResume = true, supportsNetworkBinding = true, measuredReliabilityPermille = 990, measuredRttMs = 20, measuredThroughputKbps = 4000, estimatedCostMicrounitsPerMb = 1),
        )
        val result = RuntimeTransportSelector.plannerCapabilities(profile, candidates)
        assertEquals(listOf("alpha", "beta", "lower-reliability", "unknown"), result.map { it.adapterId })
        assertEquals(listOf(0, 1, 2, 3), result.map { it.selectionRank })
        assertFalse(result.any { it.adapterId == "unknown" && it.selectionRank == 0 })
    }
}
