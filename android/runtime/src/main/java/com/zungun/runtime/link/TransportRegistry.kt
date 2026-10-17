package com.zungun.runtime.link

/** Runtime capability advertised by an installed transport adapter. Unknown measurements stay null. */
data class RuntimeTransportCapability(
    val adapterId: String,
    val available: Boolean,
    val reachabilityClass: String = "INTERNET",
    val maxPayloadBytes: Int? = null,
    val supportsDurableReceipt: Boolean,
    val supportsReceiverQuery: Boolean,
    val supportsResume: Boolean,
    val supportsNetworkBinding: Boolean,
    val duplex: String = "FULL",
    val estimatedCostMicrounitsPerMb: Long? = null,
    val estimatedLatencyMs: Int? = null,
    val measuredReliabilityPermille: Int? = null,
    val measuredRttMs: Int? = null,
    val measuredThroughputKbps: Int? = null,
)

object RuntimeTransportSelector {
    fun plannerCapabilities(profile: DeliveryProfileV2, candidates: List<RuntimeTransportCapability>): List<LinkTransportCapability> {
        val requireReceipt = profile.receiptRequirement != "NONE"
        val requireEvidence = profile.evidenceRequirement == "FULL_WITNESS"
        val eligible = candidates.filter { c ->
            c.available &&
                (profile.transportAllowlist.isEmpty() || c.adapterId in profile.transportAllowlist) &&
                (!requireReceipt || c.supportsDurableReceipt) &&
                (!requireEvidence || c.supportsDurableReceipt)
        }.sortedWith(runtimeComparator)
        return eligible.mapIndexed { index, c -> LinkTransportCapability(c.adapterId, true, c.maxPayloadBytes, c.supportsReceiverQuery, index) }
    }

    private val runtimeComparator = Comparator<RuntimeTransportCapability> { a, b ->
        compareValuesBy(a, b,
            { if (it.supportsDurableReceipt) 0 else 1 },
            { if (it.supportsReceiverQuery) 0 else 1 },
            { if (it.supportsResume) 0 else 1 },
            { if (it.supportsNetworkBinding) 0 else 1 },
            { if (it.measuredReliabilityPermille == null) 1 else 0 },
            { -(it.measuredReliabilityPermille ?: 0) },
            { if (it.measuredRttMs == null) 1 else 0 },
            { it.measuredRttMs ?: 0 },
            { if (it.measuredThroughputKbps == null) 1 else 0 },
            { -(it.measuredThroughputKbps ?: 0) },
            { if (it.estimatedCostMicrounitsPerMb == null) 1 else 0 },
            { it.estimatedCostMicrounitsPerMb ?: 0L },
            { if (it.estimatedLatencyMs == null) 1 else 0 },
            { it.estimatedLatencyMs ?: 0 },
            { it.adapterId },
        )
    }
}
