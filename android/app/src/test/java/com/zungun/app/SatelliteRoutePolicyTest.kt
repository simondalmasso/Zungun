package com.zungun.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SatelliteRoutePolicyTest {
    @Test fun acceptsOnlyAndroid35OrNewerSatelliteInternetNetworks() {
        assertTrue(SatelliteRoutePolicy.canUseSatelliteIp(
            apiLevel = 35,
            hasSatelliteTransport = true,
            hasInternetCapability = true,
        ))
    }

    @Test fun rejectsOrdinaryCellularInternetEvenWhenItIsConnected() {
        assertFalse(SatelliteRoutePolicy.canUseSatelliteIp(
            apiLevel = 35,
            hasSatelliteTransport = false,
            hasInternetCapability = true,
        ))
    }

    @Test fun rejectsSatelliteTransportWithoutIpCapability() {
        assertFalse(SatelliteRoutePolicy.canUseSatelliteIp(
            apiLevel = 35,
            hasSatelliteTransport = true,
            hasInternetCapability = false,
        ))
    }

    @Test fun rejectsSatelliteTransportOnUnsupportedOsVersion() {
        assertFalse(SatelliteRoutePolicy.canUseSatelliteIp(
            apiLevel = 34,
            hasSatelliteTransport = true,
            hasInternetCapability = true,
        ))
    }
}
