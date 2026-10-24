package com.zungun.pocket.transport

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build

/**
 * Observes only Android networks explicitly identified as satellite.
 * Provider data entitlement is a separate verified input and is never inferred
 * from GPS, cellular transport, or Internet validation.
 */
class SatelliteNetworkMonitor(context: Context) {
    private val connectivity =
        context.applicationContext.getSystemService(ConnectivityManager::class.java)

    fun currentSnapshot(
        entitlement: ProviderDataEntitlement = ProviderDataEntitlement.UNKNOWN,
        nowMillis: Long = System.currentTimeMillis()
    ): SatelliteRouteSnapshot {
        if (Build.VERSION.SDK_INT < SatelliteOnlyRoutePolicy.MIN_SATELLITE_TRANSPORT_API) {
            return SatelliteRouteSnapshot(
                apiLevel = Build.VERSION.SDK_INT,
                satelliteTransportPresent = false,
                observedAtMillis = nowMillis,
                providerDataEntitlement = entitlement
            )
        }

        val present = connectivity.allNetworks.any { network ->
            connectivity.getNetworkCapabilities(network)
                ?.hasTransport(NetworkCapabilities.TRANSPORT_SATELLITE) == true
        }

        return SatelliteRouteSnapshot(
            apiLevel = Build.VERSION.SDK_INT,
            satelliteTransportPresent = present,
            observedAtMillis = nowMillis,
            providerDataEntitlement = entitlement
        )
    }

    fun observe(
        entitlement: ProviderDataEntitlement = ProviderDataEntitlement.UNKNOWN,
        onChanged: (SatelliteRouteSnapshot) -> Unit
    ): AutoCloseable {
        if (Build.VERSION.SDK_INT < SatelliteOnlyRoutePolicy.MIN_SATELLITE_TRANSPORT_API) {
            onChanged(currentSnapshot(entitlement))
            return AutoCloseable { }
        }

        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_SATELLITE)
            .build()

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                onChanged(snapshotFor(network, entitlement))
            }

            override fun onCapabilitiesChanged(
                network: Network,
                networkCapabilities: NetworkCapabilities
            ) {
                onChanged(
                    SatelliteRouteSnapshot(
                        apiLevel = Build.VERSION.SDK_INT,
                        satelliteTransportPresent = networkCapabilities
                            .hasTransport(NetworkCapabilities.TRANSPORT_SATELLITE),
                        observedAtMillis = System.currentTimeMillis(),
                        providerDataEntitlement = entitlement
                    )
                )
            }

            override fun onLost(network: Network) {
                onChanged(currentSnapshot(entitlement))
            }
        }

        try {
            connectivity.registerNetworkCallback(request, callback)
        } catch (_: SecurityException) {
            onChanged(
                SatelliteRouteSnapshot(
                    apiLevel = Build.VERSION.SDK_INT,
                    satelliteTransportPresent = false,
                    observedAtMillis = System.currentTimeMillis(),
                    providerDataEntitlement = ProviderDataEntitlement.UNKNOWN
                )
            )
            return AutoCloseable { }
        }

        return AutoCloseable {
            runCatching { connectivity.unregisterNetworkCallback(callback) }
        }
    }

    private fun snapshotFor(
        network: Network,
        entitlement: ProviderDataEntitlement
    ): SatelliteRouteSnapshot {
        val capabilities = connectivity.getNetworkCapabilities(network)
        return SatelliteRouteSnapshot(
            apiLevel = Build.VERSION.SDK_INT,
            satelliteTransportPresent =
                capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_SATELLITE) == true,
            observedAtMillis = System.currentTimeMillis(),
            providerDataEntitlement = entitlement
        )
    }
}
