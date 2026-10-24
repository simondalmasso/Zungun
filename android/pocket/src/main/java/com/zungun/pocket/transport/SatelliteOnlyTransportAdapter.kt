package com.zungun.pocket.transport

import android.net.Network

/**
 * Provider-specific implementation seam. Implementations must bind every
 * request to the supplied satellite Network, accept only encrypted envelopes,
 * and use an authorized provider/relay endpoint. No default/mock adapter is
 * shipped as a real transport.
 */
interface SatelliteOnlyTransportAdapter {
    suspend fun transmit(
        network: Network,
        encryptedEnvelope: ByteArray
    ): SatelliteTransmissionResult

    suspend fun query(messageId: String): SatelliteTransmissionResult?
}

sealed interface SatelliteTransmissionResult {
    data class AcceptedByTransport(val receipt: ByteArray) : SatelliteTransmissionResult
    data class NotSent(val reasonCode: String) : SatelliteTransmissionResult
    data class Unknown(val reasonCode: String) : SatelliteTransmissionResult
    data class RemoteReceived(val receipt: ByteArray) : SatelliteTransmissionResult
    data class DeliveredToDevice(val receipt: ByteArray) : SatelliteTransmissionResult
}
