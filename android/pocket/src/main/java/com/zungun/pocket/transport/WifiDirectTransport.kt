package com.zungun.pocket.transport

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Looper
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.SocketException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native Wi-Fi Direct UDP transport. It binds the socket to the exact Network
 * advertising WIFI_P2P and never falls back to the process default route.
 * This class does not implement encryption, framing, delivery receipts or ACKs.
 */
class WifiDirectTransport(
    context: Context,
    private val connectivity: ConnectivityManager =
        context.applicationContext.getSystemService(ConnectivityManager::class.java),
    private val wifiP2p: WifiP2pManager? =
        context.applicationContext.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager,
    private val port: Int = DEFAULT_PORT
) : AutoCloseable {
    enum class State { IDLE, WAITING_FOR_P2P_NETWORK, WAITING_FOR_GROUP, READY, FAILED, CLOSED }

    interface Listener {
        fun onStateChanged(state: State, detail: String? = null)
        fun onDatagram(bytes: ByteArray, sender: InetSocketAddress)
        fun onPeersFound(peers: List<WifiP2pDevice>) {}
    }

    private val appContext = context.applicationContext
    private val lock = Any()
    private val closed = AtomicBoolean(false)
    private val channel = wifiP2p?.initialize(appContext, Looper.getMainLooper(), null)
    private val networkCallbacks = mutableListOf<ConnectivityManager.NetworkCallback>()
    private var listener: Listener? = null
    private var p2pNetwork: Network? = null
    private var groupInfo: WifiP2pInfo? = null
    private var socket: DatagramSocket? = null
    private var lastPeer: InetSocketAddress? = null
    private var ownsGroup = false
    @Volatile private var state = State.IDLE

    fun currentState(): State = state

    fun start(listener: Listener) {
        synchronized(lock) {
            check(!closed.get()) { "transport is closed" }
            check(state == State.IDLE) { "transport already started" }
            this.listener = listener
            val manager = wifiP2p ?: return failLocked("WIFI_P2P_MANAGER_UNAVAILABLE")
            val ch = channel ?: return failLocked("WIFI_P2P_CHANNEL_UNAVAILABLE")
            state = State.WAITING_FOR_P2P_NETWORK
            notifyStateLocked(state)

            val requests = mutableListOf(
                NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_WIFI_P2P)
                    .build()
            )
            // Android 15/API 35 requires LOCAL_NETWORK to observe local networks
            // such as a Wi-Fi Direct Group Owner. The callback still verifies WIFI_P2P.
            if (Build.VERSION.SDK_INT >= 35) {
                requests += NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_LOCAL_NETWORK)
                    .build()
            }
            try {
                requests.forEach { request ->
                    val callback = newNetworkCallback(manager, ch)
                    networkCallbacks += callback
                    connectivity.registerNetworkCallback(request, callback)
                }
                requestGroupInfoLocked(manager, ch)
            } catch (_: SecurityException) {
                failLocked("P2P_PERMISSION_DENIED")
            } catch (_: RuntimeException) {
                failLocked("P2P_NETWORK_CALLBACK_FAILED")
            }
        }
    }

    fun discoverPeers() {
        val manager = wifiP2p ?: return notifyState(State.FAILED, "WIFI_P2P_MANAGER_UNAVAILABLE")
        val ch = channel ?: return notifyState(State.FAILED, "WIFI_P2P_CHANNEL_UNAVAILABLE")
        try {
            manager.discoverPeers(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    manager.requestPeers(ch) { peers ->
                        listener?.onPeersFound(peers.deviceList.toList())
                    }
                }
                override fun onFailure(reason: Int) =
                    notifyState(State.FAILED, "P2P_DISCOVERY_FAILED_$reason")
            })
        } catch (_: SecurityException) {
            notifyState(State.FAILED, "P2P_PERMISSION_DENIED")
        }
    }

    fun connect(deviceAddress: String) {
        require(isMacAddress(deviceAddress)) {
            "deviceAddress must be a MAC address from Wi-Fi Direct discovery"
        }
        val manager = wifiP2p ?: return notifyState(State.FAILED, "WIFI_P2P_MANAGER_UNAVAILABLE")
        val ch = channel ?: return notifyState(State.FAILED, "WIFI_P2P_CHANNEL_UNAVAILABLE")
        try {
            manager.connect(ch, WifiP2pConfig().apply { this.deviceAddress = deviceAddress },
                object : WifiP2pManager.ActionListener {
                    override fun onSuccess() {
                        synchronized(lock) { ownsGroup = true }
                        notifyState(State.WAITING_FOR_GROUP, "P2P_CONNECT_REQUEST_ACCEPTED")
                        requestGroupInfo()
                    }
                    override fun onFailure(reason: Int) =
                        notifyState(State.FAILED, "P2P_CONNECT_FAILED_$reason")
                })
        } catch (_: SecurityException) {
            notifyState(State.FAILED, "P2P_PERMISSION_DENIED")
        }
    }

    /** Sends a datagram. Framing, encryption, replay protection and ACKs belong above this layer. */
    @Throws(IOException::class)
    fun send(bytes: ByteArray, peer: InetSocketAddress? = null) {
        require(P2pDatagramPolicy.acceptsDatagram(bytes.size)) {
            "UDP datagram must be between 1 and " + P2pDatagramPolicy.MAX_DATAGRAM_BYTES + " bytes"
        }
        synchronized(lock) {
            check(state == State.READY && socket?.isClosed == false) { "P2P transport is not ready" }
            val info = requireNotNull(groupInfo)
            val target = peer ?: if (info.isGroupOwner) lastPeer else {
                info.groupOwnerAddress?.let { InetSocketAddress(it, port) }
            }
            requireNotNull(target) { "no peer address is known yet" }
            socket!!.send(DatagramPacket(bytes.copyOf(), bytes.size, target.address, target.port))
        }
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        synchronized(lock) {
            closeSocketLocked()
            networkCallbacks.forEach { runCatching { connectivity.unregisterNetworkCallback(it) } }
            networkCallbacks.clear()
            val manager = wifiP2p
            val activeChannel = channel
            if (ownsGroup && manager != null && activeChannel != null) runCatching {
                manager.removeGroup(activeChannel, object : WifiP2pManager.ActionListener {
                    override fun onSuccess() = Unit
                    override fun onFailure(reason: Int) = Unit
                })
            }
            p2pNetwork = null
            groupInfo = null
            state = State.CLOSED
            listener?.onStateChanged(State.CLOSED)
            listener = null
        }
    }

    private fun newNetworkCallback(
        manager: WifiP2pManager,
        ch: WifiP2pManager.Channel
    ) = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (!hasP2pCapability(network)) return
            synchronized(lock) {
                if (closed.get()) return
                setP2pNetworkLocked(network)
                updateWaitingStateLocked()
                requestGroupInfoLocked(manager, ch)
                openSocketIfReadyLocked()
            }
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_WIFI_P2P)) {
                synchronized(lock) {
                    if (closed.get()) return
                    setP2pNetworkLocked(network)
                    openSocketIfReadyLocked()
                }
            } else onNetworkUnavailable(network, manager, ch)
        }

        override fun onLost(network: Network) = onNetworkUnavailable(network, manager, ch)
    }

    private fun setP2pNetworkLocked(network: Network) {
        if (p2pNetwork != null && p2pNetwork != network) {
            closeSocketLocked()
            groupInfo = null
        }
        p2pNetwork = network
    }

    private fun hasP2pCapability(network: Network): Boolean =
        connectivity.getNetworkCapabilities(network)
            ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_WIFI_P2P) == true

    private fun onNetworkUnavailable(
        network: Network,
        manager: WifiP2pManager,
        ch: WifiP2pManager.Channel
    ) {
        synchronized(lock) {
            if (p2pNetwork != network) return
            closeSocketLocked()
            p2pNetwork = null
            groupInfo = null
            val alternate = connectivity.allNetworks.firstOrNull { hasP2pCapability(it) }
            if (alternate == null) updateWaitingStateLocked()
            else {
                setP2pNetworkLocked(alternate)
                requestGroupInfoLocked(manager, ch)
                openSocketIfReadyLocked()
            }
        }
    }

    private fun requestGroupInfo() {
        val manager = wifiP2p ?: return
        val ch = channel ?: return
        synchronized(lock) { requestGroupInfoLocked(manager, ch) }
    }

    private fun requestGroupInfoLocked(manager: WifiP2pManager, ch: WifiP2pManager.Channel) {
        try {
            manager.requestConnectionInfo(ch) { info ->
                synchronized(lock) {
                    if (closed.get()) return@requestConnectionInfo
                    groupInfo = info.takeIf { it.groupFormed }
                    if (groupInfo == null) {
                        closeSocketLocked()
                        updateWaitingStateLocked()
                    } else openSocketIfReadyLocked()
                }
            }
        } catch (_: SecurityException) {
            failLocked("P2P_PERMISSION_DENIED")
        }
    }

    private fun openSocketIfReadyLocked() {
        val network = p2pNetwork ?: return
        val info = groupInfo ?: return
        if (!P2pDatagramPolicy.canOpenSocket(true, info.groupFormed) || socket?.isClosed == false) return
        var candidate: DatagramSocket? = null
        try {
            candidate = DatagramSocket(null).apply { reuseAddress = true }
            network.bindSocket(candidate)
            candidate.bind(InetSocketAddress(port))
            socket = candidate
            state = State.READY
            notifyStateLocked(state, if (info.isGroupOwner) "P2P_GROUP_OWNER_LISTENING" else "P2P_CLIENT_READY")
            val receiver = candidate
            Thread({ receiveLoop(receiver) }, "zungun-p2p-udp-receiver").apply {
                isDaemon = true
                start()
            }
        } catch (e: Exception) {
            runCatching { candidate?.close() }
            socket = null
            failLocked(if (e is SocketException) "P2P_UDP_SOCKET_FAILED" else "P2P_NETWORK_BIND_FAILED")
        }
    }

    private fun receiveLoop(activeSocket: DatagramSocket) {
        while (!closed.get() && !activeSocket.isClosed) {
            try {
                val size = P2pDatagramPolicy.MAX_DATAGRAM_BYTES + 1
                val packet = DatagramPacket(ByteArray(size), size)
                activeSocket.receive(packet)
                if (!P2pDatagramPolicy.acceptsDatagram(packet.length)) continue
                val sender = packet.socketAddress as? InetSocketAddress ?: continue
                synchronized(lock) { lastPeer = sender }
                listener?.onDatagram(packet.data.copyOf(packet.length), sender)
            } catch (_: SocketException) {
                if (!closed.get()) notifyState(State.WAITING_FOR_P2P_NETWORK, "P2P_SOCKET_CLOSED")
                return
            } catch (_: IOException) {
                if (!closed.get()) notifyState(State.FAILED, "P2P_UDP_RECEIVE_FAILED")
                return
            }
        }
    }

    private fun closeSocketLocked() {
        socket?.let { runCatching { it.close() } }
        socket = null
    }

    private fun updateWaitingStateLocked() {
        if (closed.get() || state == State.FAILED) return
        state = if (p2pNetwork == null) State.WAITING_FOR_P2P_NETWORK else State.WAITING_FOR_GROUP
        notifyStateLocked(state)
    }

    private fun failLocked(detail: String) {
        closeSocketLocked()
        networkCallbacks.forEach { runCatching { connectivity.unregisterNetworkCallback(it) } }
        networkCallbacks.clear()
        state = State.FAILED
        notifyStateLocked(state, detail)
    }

    private fun notifyState(next: State, detail: String? = null) {
        state = next
        listener?.onStateChanged(next, detail)
    }

    private fun notifyStateLocked(next: State, detail: String? = null) {
        listener?.onStateChanged(next, detail)
    }

    private fun isMacAddress(value: String): Boolean {
        val parts = value.split(':')
        return parts.size == 6 && parts.all { part ->
            part.length == 2 && part.all { it in '0'..'9' || it.lowercaseChar() in 'a'..'f' }
        }
    }

    companion object { const val DEFAULT_PORT = 40812 }
}
