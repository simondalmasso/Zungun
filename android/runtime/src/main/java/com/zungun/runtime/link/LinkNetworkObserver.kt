package com.zungun.runtime.link

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

class LinkNetworkObserver(
    context: Context,
    private val maxAgeMs: Long = 30_000,
    private val onSnapshot: (LinkSnapshot) -> Unit,
) : AutoCloseable {
    private val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java)
    private val generation = AtomicLong(0)
    private val keys = ConcurrentHashMap<Network,String>()
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = emit(network)
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = emit(network, capabilities)
        override fun onLost(network: Network) { keys.remove(network); if (manager.activeNetwork == null) onSnapshot(offline()) }
        override fun onBlockedStatusChanged(network: Network, blocked: Boolean) = emit(network)
    }

    fun start() { manager.registerDefaultNetworkCallback(callback); manager.activeNetwork?.let(::emit) ?: onSnapshot(offline()) }
    override fun close() { runCatching { manager.unregisterNetworkCallback(callback) } }

    private fun emit(network: Network, supplied: NetworkCapabilities? = null) {
        if (network != manager.activeNetwork) return
        val caps = supplied ?: manager.getNetworkCapabilities(network) ?: return
        val now = System.currentTimeMillis(); val networkKey = keys.computeIfAbsent(network) { "net-${generation.incrementAndGet()}" }
        val transports = listOf(
            NetworkCapabilities.TRANSPORT_CELLULAR to "CELLULAR", NetworkCapabilities.TRANSPORT_WIFI to "WIFI",
            NetworkCapabilities.TRANSPORT_ETHERNET to "ETHERNET", NetworkCapabilities.TRANSPORT_VPN to "VPN",
            NetworkCapabilities.TRANSPORT_BLUETOOTH to "BLUETOOTH",
        ).filter { caps.hasTransport(it.first) }.map { it.second }.sorted()
        onSnapshot(LinkSnapshot(snapshotId=snapshotId(networkKey,now,caps),observedAtMs=now,maxAgeMs=maxAgeMs,hasNetwork=true,internetCapable=caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET),validated=caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),captivePortal=caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL),metered=!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),temporarilyUnmetered=android.os.Build.VERSION.SDK_INT>=30 && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_TEMPORARILY_NOT_METERED),congested=!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_CONGESTED),roaming=!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING),vpn=caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN),suspended=!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED),downstreamKbps=caps.linkDownstreamBandwidthKbps.takeIf{it>0},upstreamKbps=caps.linkUpstreamBandwidthKbps.takeIf{it>0},transports=transports,networkKey=networkKey,recentRttMsEwma=null,recentFailureRateEwma=null,recentThroughputKbpsEwma=null))
    }

    private fun offline(): LinkSnapshot { val now=System.currentTimeMillis(); return LinkSnapshot("offline-$now",now,maxAgeMs,false,false,false,false,false,false,false,false,false,false,null,null,emptyList(),null,null,null,null) }
    private fun snapshotId(networkKey:String,now:Long,caps:NetworkCapabilities):String { val raw="$networkKey|$now|${caps.hashCode()}"; val h=MessageDigest.getInstance("SHA-256").digest(raw.toByteArray()).joinToString(""){"%02x".format(it)};return "ls_${h.take(32)}" }
}
