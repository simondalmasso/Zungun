package com.zungun.pocket.transport

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ZppCodecTest {
    @Test fun canonicalSodiumVectorMatchesWireFormat() {
        val codec = testCodec()
        val secret = ByteArray(32) { it.toByte() }
        val reservedAllocation = allocation(epoch = 0x1234, messageId = 0xABCD)
        val store = MemoryStore()
        val frame = codec.sealNew(
            secret,
            reservedAllocation,
            ZppDirection.B_TO_A,
            "ZPP1 vector payload".toByteArray(Charsets.US_ASCII),
            store
        )

        assertEquals(
            "5a5001011234abcd801de07a57652e9b0e06e32654bfe16625ef2b09ff6e7b13db07e0dc897354b54c47b3",
            frame.toHex()
        )
        val opened = codec.open(secret, frame, 0x1234, ZppDirection.B_TO_A)
        assertEquals(0xABCD, opened.header.messageId)
        assertArrayEquals("ZPP1 vector payload".toByteArray(Charsets.US_ASCII), opened.plaintext)
    }

    @Test fun wrongEpochOrDirectionIsRejectedBeforeDecrypting() {
        val codec = testCodec()
        val secret = ByteArray(32) { (it * 3).toByte() }
        val frame = codec.sealNew(secret, allocation(7, 4), ZppDirection.A_TO_B, byteArrayOf(1, 2, 3), MemoryStore())

        assertThrows<ZppProtocolException> { codec.open(secret, frame, 8, ZppDirection.A_TO_B) }
        assertThrows<ZppProtocolException> { codec.open(secret, frame, 7, ZppDirection.B_TO_A) }
    }

    @Test fun modifiedHeaderCiphertextOrTagFailsAuthentication() {
        val codec = testCodec()
        val secret = ByteArray(32) { (it + 9).toByte() }
        val frame = codec.sealNew(secret, allocation(21, 66), ZppDirection.A_TO_B, "secret".toByteArray(), MemoryStore())

        val headerTampered = frame.copyOf().also { it[7] = (it[7].toInt() xor 1).toByte() }
        val ciphertextTampered = frame.copyOf().also {
            it[ZppFrameHeader.BYTES + 1] = (it[ZppFrameHeader.BYTES + 1].toInt() xor 1).toByte()
        }
        val tagTampered = frame.copyOf().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }

        assertThrows<ZppAuthenticationException> { codec.open(secret, headerTampered, 21, ZppDirection.A_TO_B) }
        assertThrows<ZppAuthenticationException> { codec.open(secret, ciphertextTampered, 21, ZppDirection.A_TO_B) }
        assertThrows<ZppAuthenticationException> { codec.open(secret, tagTampered, 21, ZppDirection.A_TO_B) }
    }

    @Test fun datagramIsBoundedByConservativeMtu() {
        val codec = testCodec()
        val secret = ByteArray(32) { 0x4A.toByte() }
        val max = codec.sealNew(secret, allocation(3, 0), ZppDirection.A_TO_B, ByteArray(ZppCodec.MAX_PLAINTEXT_BYTES), MemoryStore())
        assertEquals(P2pDatagramPolicy.MAX_DATAGRAM_BYTES, max.size)
        assertArrayEquals(ByteArray(ZppCodec.MAX_PLAINTEXT_BYTES), codec.open(secret, max, 3, ZppDirection.A_TO_B).plaintext)

        assertThrows<IllegalArgumentException> {
            codec.sealNew(secret, allocation(3, 1), ZppDirection.A_TO_B, ByteArray(ZppCodec.MAX_PLAINTEXT_BYTES + 1), MemoryStore())
        }
        assertTrue(max.size <= 1232)
    }

    @Test fun sealedIdentityCannotBeEncryptedTwiceAndRetransmissionUsesStoredBytes() {
        val codec = testCodec()
        val secret = ByteArray(32) { it.toByte() }
        val reservedAllocation = allocation(2, 77)
        val store = MemoryStore()
        val first = codec.sealNew(secret, reservedAllocation, ZppDirection.B_TO_A, byteArrayOf(4, 5, 6), store)
        val retransmitted = codec.loadForRetransmission(2, 77, ZppDirection.B_TO_A, store)
        assertArrayEquals(first, retransmitted)

        assertThrows<ZppRecordAlreadySealedException> {
            codec.sealNew(secret, reservedAllocation, ZppDirection.B_TO_A, byteArrayOf(4, 5, 6), store)
        }
        assertEquals(1, store.encryptions)
        val otherDirection = codec.sealNew(
            secret, allocation(2, 77), ZppDirection.A_TO_B, byteArrayOf(4, 5, 6), MemoryStore()
        )
        assertNotEquals(first.toList(), otherDirection.toList())
    }

    @Test fun frameHeaderHasCanonicalEightByteLayout() {
        val header = ZppFrameHeader(0x1234, 0xABCD, ZppDirection.B_TO_A)
        assertEquals("5a5001011234abcd", header.encode().toHex())
        assertEquals(header, ZppFrameHeader.decode(header.encode()))
    }

    private fun testCodec() = ZppCodec(LazySodiumJava(SodiumJava()))

    private fun allocation(epoch: Int, messageId: Int) =
        DurableMessageIdAllocator.Allocation(epoch, messageId, ByteArray(32))

    private class MemoryStore : ZppCiphertextStore {
        private val values = linkedMapOf<ZppRecordKey, ByteArray>()
        var encryptions: Int = 0
            private set

        override fun sealOnce(key: ZppRecordKey, createFrame: () -> ByteArray): ByteArray {
            if (values.containsKey(key)) {
                throw ZppRecordAlreadySealedException("already sealed")
            }
            encryptions++
            val created = createFrame()
            values[key] = created.copyOf()
            return created.copyOf()
        }

        override fun load(key: ZppRecordKey): ByteArray? = values[key]?.copyOf()
    }

    private inline fun <reified T : Throwable> assertThrows(noinline action: () -> Unit) {
        try {
            action()
        } catch (error: Throwable) {
            if (error is T) return
            throw AssertionError(
                "expected " + T::class.java.name + ", got " + error::class.java.name,
                error
            )
        }
        throw AssertionError("expected " + T::class.java.name)
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xFF) }
}
