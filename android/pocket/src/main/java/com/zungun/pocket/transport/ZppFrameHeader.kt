package com.zungun.pocket.transport

/** Authenticated 8-byte wire header. The complete header is AEAD additional data. */
internal data class ZppFrameHeader(
    val epoch: Int,
    val messageId: Int,
    val direction: ZppDirection
) {
    init {
        require(epoch in 0..ZppNonce.MAX_EPOCH) { "epoch must fit an unsigned 16-bit field" }
        require(messageId in 0..ZppNonce.MAX_MESSAGE_ID) { "message ID is exhausted or reserved" }
    }

    fun encode(): ByteArray = ByteArray(BYTES).also { header ->
        header[0] = MAGIC_Z
        header[1] = MAGIC_P
        header[2] = VERSION.toByte()
        header[3] = direction.wireCode.toByte()
        header[4] = (epoch ushr 8).toByte()
        header[5] = epoch.toByte()
        header[6] = (messageId ushr 8).toByte()
        header[7] = messageId.toByte()
    }

    companion object {
        const val BYTES = 8
        const val VERSION = 1
        private const val MAGIC_Z: Byte = 0x5A
        private const val MAGIC_P: Byte = 0x50

        fun decode(bytes: ByteArray): ZppFrameHeader {
            if (bytes.size != BYTES) throw ZppProtocolException("invalid ZPP header size")
            if (bytes[0] != MAGIC_Z || bytes[1] != MAGIC_P) {
                throw ZppProtocolException("invalid ZPP sync marker")
            }
            if ((bytes[2].toInt() and 0xFF) != VERSION) {
                throw ZppProtocolException("unsupported ZPP frame version")
            }

            val direction = when (bytes[3].toInt() and 0xFF) {
                0x00 -> ZppDirection.A_TO_B
                0x01 -> ZppDirection.B_TO_A
                else -> throw ZppProtocolException("invalid ZPP direction")
            }
            val epoch = ((bytes[4].toInt() and 0xFF) shl 8) or (bytes[5].toInt() and 0xFF)
            val messageId = ((bytes[6].toInt() and 0xFF) shl 8) or (bytes[7].toInt() and 0xFF)
            if (messageId > ZppNonce.MAX_MESSAGE_ID) {
                throw ZppProtocolException("reserved or exhausted message ID")
            }
            return ZppFrameHeader(epoch, messageId, direction)
        }
    }
}

internal data class ZppOpenedFrame(
    val header: ZppFrameHeader,
    val plaintext: ByteArray
)

internal class ZppProtocolException(message: String) : IllegalArgumentException(message)
internal class ZppAuthenticationException(message: String) : SecurityException(message)
