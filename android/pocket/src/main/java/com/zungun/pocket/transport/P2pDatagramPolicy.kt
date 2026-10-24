package com.zungun.pocket.transport

/** Pure bounds/readiness policy shared by the Android transport and JVM tests. */
internal object P2pDatagramPolicy {
    /** IPv6 MTU 1280 minus 40-byte IP and 8-byte UDP headers. */
    const val MAX_DATAGRAM_BYTES = 1232

    fun canOpenSocket(networkAvailable: Boolean, groupFormed: Boolean): Boolean =
        networkAvailable && groupFormed

    fun acceptsDatagram(size: Int): Boolean = size in 1..MAX_DATAGRAM_BYTES
}
