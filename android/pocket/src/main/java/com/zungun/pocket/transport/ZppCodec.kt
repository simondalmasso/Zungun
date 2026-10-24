package com.zungun.pocket.transport

import com.goterl.lazysodium.LazySodium
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.goterl.lazysodium.interfaces.AEAD
import com.goterl.lazysodium.interfaces.KeyDerivation

/**
 * ZPP/1 record codec backed by libsodium XChaCha20-Poly1305-IETF.
 *
 * The era secret must be provided only after authenticated, two-way-confirmed
 * KEYX. This type is deliberately not a KEYX implementation.
 *
 * Outbound frames must be sealed through sealNew, which reserves the record
 * identity before invoking encryption and persists the exact ciphertext before
 * returning it. Retries use loadForRetransmission; never call sealNew again
 * for an identity that has already been reserved.
 */
internal class ZppCodec(private val sodium: LazySodium) {
    fun sealNew(
        eraSecret: ByteArray,
        allocation: DurableMessageIdAllocator.Allocation,
        direction: ZppDirection,
        plaintext: ByteArray,
        store: ZppCiphertextStore
    ): ByteArray {
        require(eraSecret.size == ERA_SECRET_BYTES) { "era secret must be 32 bytes" }
        require(plaintext.size <= MAX_PLAINTEXT_BYTES) { "plaintext exceeds the UDP MTU budget" }
        require(allocation.epoch in 0..ZppNonce.MAX_EPOCH)
        require(allocation.messageId in 0..ZppNonce.MAX_MESSAGE_ID)

        val recordKey = ZppRecordKey(allocation.epoch, allocation.messageId, direction)
        return store.sealOnce(recordKey) {
            sealRaw(eraSecret, recordKey, plaintext.copyOf())
        }
    }

    fun loadForRetransmission(
        epoch: Int,
        messageId: Int,
        direction: ZppDirection,
        store: ZppCiphertextStore
    ): ByteArray = store.load(ZppRecordKey(epoch, messageId, direction))
        ?: throw ZppCiphertextUnavailableException("no durable ciphertext exists for this record")

    fun open(
        eraSecret: ByteArray,
        packet: ByteArray,
        expectedEpoch: Int,
        expectedDirection: ZppDirection
    ): ZppOpenedFrame {
        require(eraSecret.size == ERA_SECRET_BYTES) { "era secret must be 32 bytes" }
        require(expectedEpoch in 0..ZppNonce.MAX_EPOCH) { "expected epoch out of range" }
        if (packet.size < MIN_PACKET_BYTES || packet.size > P2pDatagramPolicy.MAX_DATAGRAM_BYTES) {
            throw ZppProtocolException("ZPP packet length is outside the allowed bounds")
        }

        val headerBytes = packet.copyOfRange(0, ZppFrameHeader.BYTES)
        val header = ZppFrameHeader.decode(headerBytes)
        if (header.epoch != expectedEpoch) {
            throw ZppProtocolException("frame epoch does not match the authenticated session epoch")
        }
        if (header.direction != expectedDirection) {
            throw ZppProtocolException("frame direction does not match the peer role")
        }

        val ciphertext = packet.copyOfRange(ZppFrameHeader.BYTES, packet.size)
        if (ciphertext.size < TAG_BYTES || ciphertext.size - TAG_BYTES > MAX_PLAINTEXT_BYTES) {
            throw ZppProtocolException("ciphertext length is outside the allowed bounds")
        }

        val key = deriveDirectionalKey(eraSecret, header.epoch, header.direction)
        try {
            // libsodium accepts a null secret-nonce pointer for XChaCha20-Poly1305.
            val plaintext = ByteArray(maxOf(1, ciphertext.size - TAG_BYTES))
            val plaintextLength = longArrayOf(0L)
            val ok = sodium.cryptoAeadXChaCha20Poly1305IetfDecrypt(
                plaintext,
                plaintextLength,
                null,
                ciphertext,
                ciphertext.size.toLong(),
                headerBytes,
                headerBytes.size.toLong(),
                ZppNonce.encode(header.epoch, header.messageId, header.direction),
                key
            )
            if (!ok) throw ZppAuthenticationException("ZPP authentication tag verification failed")
            val length = plaintextLength[0]
            if (length < 0 || length > MAX_PLAINTEXT_BYTES || length > plaintext.size) {
                throw ZppAuthenticationException("libsodium returned an invalid plaintext length")
            }
            return ZppOpenedFrame(header, plaintext.copyOf(length))
        } finally {
            key.fill(0)
        }
    }

    private fun sealRaw(eraSecret: ByteArray, recordKey: ZppRecordKey, plaintext: ByteArray): ByteArray {
        val header = ZppFrameHeader(recordKey.epoch, recordKey.messageId, recordKey.direction)
        val headerBytes = header.encode()
        val key = deriveDirectionalKey(eraSecret, recordKey.epoch, recordKey.direction)
        try {
            val ciphertext = ByteArray(plaintext.size + TAG_BYTES)
            val ciphertextLength = longArrayOf(0L)
            val ok = sodium.cryptoAeadXChaCha20Poly1305IetfEncrypt(
                ciphertext,
                ciphertextLength,
                plaintext,
                plaintext.size.toLong(),
                headerBytes,
                headerBytes.size.toLong(),
                null,
                ZppNonce.encode(recordKey.epoch, recordKey.messageId, recordKey.direction),
                key
            )
            if (!ok) throw IllegalStateException("libsodium failed to encrypt the ZPP record")
            val length = ciphertextLength[0]
            if (length != ciphertext.size.toLong()) {
                throw IllegalStateException("libsodium returned an unexpected ciphertext length")
            }
            val packet = headerBytes + ciphertext
            if (packet.size > P2pDatagramPolicy.MAX_DATAGRAM_BYTES) {
                throw IllegalArgumentException("encoded ZPP datagram exceeds the MTU budget")
            }
            return packet
        } finally {
            key.fill(0)
            plaintext.fill(0)
        }
    }

    private fun deriveDirectionalKey(eraSecret: ByteArray, epoch: Int, direction: ZppDirection): ByteArray {
        val context = when (direction) {
            ZppDirection.A_TO_B -> CONTEXT_A_TO_B
            ZppDirection.B_TO_A -> CONTEXT_B_TO_A
        }
        check(context.size == KeyDerivation.CONTEXT_BYTES) { "ZPP KDF context must be exactly 8 bytes" }
        val key = ByteArray(AEAD.XCHACHA20POLY1305_IETF_KEYBYTES)
        val result = sodium.cryptoKdfDeriveFromKey(
            key,
            key.size,
            epoch.toLong(),
            context,
            eraSecret
        )
        if (result != 0) {
            key.fill(0)
            throw IllegalStateException("libsodium failed to derive the ZPP directional key")
        }
        return key
    }

    companion object {
        const val ERA_SECRET_BYTES = 32
        const val TAG_BYTES = AEAD.XCHACHA20POLY1305_IETF_ABYTES
        const val MAX_PLAINTEXT_BYTES =
            P2pDatagramPolicy.MAX_DATAGRAM_BYTES - ZppFrameHeader.BYTES - TAG_BYTES
        private const val MIN_PACKET_BYTES = ZppFrameHeader.BYTES + TAG_BYTES

        // These contexts are exactly 8 bytes each and are part of the wire protocol.
        private val CONTEXT_A_TO_B = "ZPP1K_A_".toByteArray(Charsets.US_ASCII)
        private val CONTEXT_B_TO_A = "ZPP1K_B_".toByteArray(Charsets.US_ASCII)

        fun forAndroid(): ZppCodec = ZppCodec(LazySodiumAndroid(SodiumAndroid()))
    }
}
