package com.zungun.pocket.transport

import org.junit.Assert.assertEquals
import org.junit.Test

class SatelliteOnlyRoutePolicyTest {
    private val now = 1_800_000_000_000L

    private fun snapshot(
        api: Int = 35,
        satellite: Boolean = true,
        observedAt: Long = now,
        entitlement: ProviderDataEntitlement = ProviderDataEntitlement.VERIFIED
    ) = SatelliteRouteSnapshot(api, satellite, observedAt, entitlement)

    private fun evaluate(
        snapshot: SatelliteRouteSnapshot?,
        relay: Boolean = true,
        adapter: Boolean = true
    ) = SatelliteOnlyRoutePolicy.evaluate(
        snapshot = snapshot,
        nowMillis = now,
        relayConfigured = relay,
        authorizedAdapterInstalled = adapter
    )

    @Test fun missingObservationQueuesWithoutSelectingTerrestrialFallback() {
        val result = evaluate(null)
        assertEquals(RouteAction.QUEUE_WHILE_SATELLITE_UNVERIFIED, result.action)
        assertEquals(RouteReason.NO_CURRENT_OBSERVATION, result.reason)
    }

    @Test fun platformBeforeApi35QueuesAsUnsupported() {
        val result = evaluate(snapshot(api = 34, satellite = false))
        assertEquals(RouteAction.QUEUE_WHILE_SATELLITE_UNVERIFIED, result.action)
        assertEquals(RouteReason.SATELLITE_PLATFORM_UNSUPPORTED, result.reason)
    }

    @Test fun cellularOrWifiOnlySnapshotNeverPermitsSend() {
        val result = evaluate(snapshot(satellite = false))
        assertEquals(RouteAction.QUEUE_WHILE_SATELLITE_UNVERIFIED, result.action)
        assertEquals(RouteReason.NO_SATELLITE_TRANSPORT, result.reason)
    }

    @Test fun staleAndFutureObservationsFailClosed() {
        val stale = evaluate(snapshot(observedAt = now - 5_001L))
        val future = evaluate(snapshot(observedAt = now + 1L))
        assertEquals(RouteReason.SATELLITE_OBSERVATION_STALE, stale.reason)
        assertEquals(RouteAction.QUEUE_WHILE_SATELLITE_UNVERIFIED, stale.action)
        assertEquals(RouteReason.SATELLITE_OBSERVATION_STALE, future.reason)
        assertEquals(RouteAction.QUEUE_WHILE_SATELLITE_UNVERIFIED, future.action)
    }

    @Test fun unknownProviderIpEntitlementQueuesButExplicitDenialBlocks() {
        val unknown = evaluate(snapshot(entitlement = ProviderDataEntitlement.UNKNOWN))
        val denied = evaluate(snapshot(entitlement = ProviderDataEntitlement.DENIED))
        assertEquals(RouteAction.QUEUE_WHILE_SATELLITE_UNVERIFIED, unknown.action)
        assertEquals(RouteReason.SATELLITE_DATA_ENTITLEMENT_UNVERIFIED, unknown.reason)
        assertEquals(RouteAction.BLOCK_NO_TRANSPORT_CONFIGURATION, denied.action)
        assertEquals(RouteReason.SATELLITE_DATA_NOT_AUTHORIZED, denied.reason)
    }

    @Test fun verifiedSatelliteWithoutRelayIsBlockedNotQueued() {
        val result = evaluate(snapshot(), relay = false)
        assertEquals(RouteAction.BLOCK_NO_TRANSPORT_CONFIGURATION, result.action)
        assertEquals(RouteReason.RELAY_NOT_CONFIGURED, result.reason)
    }

    @Test fun verifiedSatelliteWithoutAuthorizedAdapterIsBlockedNotQueued() {
        val result = evaluate(snapshot(), adapter = false)
        assertEquals(RouteAction.BLOCK_NO_TRANSPORT_CONFIGURATION, result.action)
        assertEquals(RouteReason.SATELLITE_ADAPTER_NOT_INSTALLED, result.reason)
    }

    @Test fun onlyFreshSatelliteEntitledAndConfiguredRoutePermitsAnAttempt() {
        val result = evaluate(snapshot())
        assertEquals(RouteAction.PERMIT_SATELLITE_ATTEMPT, result.action)
        assertEquals(RouteReason.SATELLITE_ATTEMPT_PERMITTED, result.reason)
    }
}
