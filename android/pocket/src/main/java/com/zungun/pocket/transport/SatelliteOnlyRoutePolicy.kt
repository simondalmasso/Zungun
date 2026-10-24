package com.zungun.pocket.transport

enum class ProviderDataEntitlement {
    VERIFIED,
    UNKNOWN,
    DENIED
}

enum class RouteAction {
    QUEUE_WHILE_SATELLITE_UNVERIFIED,
    BLOCK_NO_TRANSPORT_CONFIGURATION,
    PERMIT_SATELLITE_ATTEMPT
}

enum class RouteReason {
    NO_CURRENT_OBSERVATION,
    SATELLITE_PLATFORM_UNSUPPORTED,
    SATELLITE_OBSERVATION_STALE,
    NO_SATELLITE_TRANSPORT,
    SATELLITE_DATA_ENTITLEMENT_UNVERIFIED,
    SATELLITE_DATA_NOT_AUTHORIZED,
    RELAY_NOT_CONFIGURED,
    SATELLITE_ADAPTER_NOT_INSTALLED,
    SATELLITE_ATTEMPT_PERMITTED
}

data class SatelliteRouteSnapshot(
    val apiLevel: Int,
    val satelliteTransportPresent: Boolean,
    val observedAtMillis: Long,
    val providerDataEntitlement: ProviderDataEntitlement = ProviderDataEntitlement.UNKNOWN
)

data class RouteDecision(
    val action: RouteAction,
    val reason: RouteReason
)

/**
 * Deterministic gate only. Permission to attempt transmission is not evidence
 * that a message was sent, accepted by a relay, or delivered to a recipient.
 */
object SatelliteOnlyRoutePolicy {
    const val MIN_SATELLITE_TRANSPORT_API = 35
    const val MAX_OBSERVATION_AGE_MILLIS = 5_000L

    fun evaluate(
        snapshot: SatelliteRouteSnapshot?,
        nowMillis: Long,
        relayConfigured: Boolean,
        authorizedAdapterInstalled: Boolean
    ): RouteDecision {
        if (snapshot == null) return queue(RouteReason.NO_CURRENT_OBSERVATION)
        if (snapshot.apiLevel < MIN_SATELLITE_TRANSPORT_API) {
            return queue(RouteReason.SATELLITE_PLATFORM_UNSUPPORTED)
        }

        val ageMillis = nowMillis - snapshot.observedAtMillis
        if (ageMillis < 0L || ageMillis > MAX_OBSERVATION_AGE_MILLIS) {
            return queue(RouteReason.SATELLITE_OBSERVATION_STALE)
        }
        if (!snapshot.satelliteTransportPresent) {
            return queue(RouteReason.NO_SATELLITE_TRANSPORT)
        }

        when (snapshot.providerDataEntitlement) {
            ProviderDataEntitlement.UNKNOWN ->
                return queue(RouteReason.SATELLITE_DATA_ENTITLEMENT_UNVERIFIED)
            ProviderDataEntitlement.DENIED ->
                return block(RouteReason.SATELLITE_DATA_NOT_AUTHORIZED)
            ProviderDataEntitlement.VERIFIED -> Unit
        }

        if (!relayConfigured) return block(RouteReason.RELAY_NOT_CONFIGURED)
        if (!authorizedAdapterInstalled) {
            return block(RouteReason.SATELLITE_ADAPTER_NOT_INSTALLED)
        }

        return RouteDecision(
            action = RouteAction.PERMIT_SATELLITE_ATTEMPT,
            reason = RouteReason.SATELLITE_ATTEMPT_PERMITTED
        )
    }

    private fun queue(reason: RouteReason) = RouteDecision(
        action = RouteAction.QUEUE_WHILE_SATELLITE_UNVERIFIED,
        reason = reason
    )

    private fun block(reason: RouteReason) = RouteDecision(
        action = RouteAction.BLOCK_NO_TRANSPORT_CONFIGURATION,
        reason = reason
    )
}
