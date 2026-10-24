package com.zungun.pocket.transport

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ZppNonceTest {
    @Test fun canonicalVectorIsExactlyTwentyFourBytes() {
        // epoch=0x1234, messageId=0xABCD, direction B->A, then 19 zero bytes.
        val expected = hexToBytes("1234abcd01" + "00".repeat(19))
        val actual = ZppNonce.encode(0x1234, 0xABCD, ZppDirection.B_TO_A)

        assertEquals(24, expected.size)
        assertEquals(ZppNonce.SIZE_BYTES, actual.size)
        assertArrayEquals(expected, actual)
    }

    @Test fun bothDirectionCodesAreStableAndDistinct() {
        val aToB = ZppNonce.encode(9, 12, ZppDirection.A_TO_B)
        val bToA = ZppNonce.encode(9, 12, ZppDirection.B_TO_A)

        assertEquals(0, aToB[4].toInt())
        assertEquals(1, bToA[4].toInt())
        assertNotEquals(aToB.toList(), bToA.toList())
    }

    @Test fun epochAndMessageIdBoundariesUseBigEndianEncoding() {
        val nonce = ZppNonce.encode(0xFFFF, 0xFFFD, ZppDirection.A_TO_B)

        assertArrayEquals(
            byteArrayOf(0xFF.toByte(), 0xFF.toByte(), 0xFF.toByte(), 0xFD.toByte(), 0x00),
            nonce.copyOfRange(0, 5)
        )
        assertTrue(nonce.copyOfRange(5, ZppNonce.SIZE_BYTES).all { it == 0.toByte() })
    }

    @Test fun exhaustedAndOutOfRangeFieldsAreRejected() {
        assertIllegalArgument { ZppNonce.encode(-1, 0, ZppDirection.A_TO_B) }
        assertIllegalArgument { ZppNonce.encode(0x10000, 0, ZppDirection.A_TO_B) }
        assertIllegalArgument { ZppNonce.encode(0, -1, ZppDirection.A_TO_B) }
        assertIllegalArgument { ZppNonce.encode(0, 0xFFFE, ZppDirection.A_TO_B) }
        assertIllegalArgument { ZppNonce.encode(0, 0xFFFF, ZppDirection.A_TO_B) }
    }

    private fun assertIllegalArgument(action: () -> Unit) {
        try {
            action()
            throw AssertionError("expected IllegalArgumentException")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }

    private fun hexToBytes(value: String): ByteArray {
        require(value.length % 2 == 0)
        return ByteArray(value.length / 2) { index ->
            value.substring(index * 2, index * 2 + 2).toInt(16).toByte()
        }
    }
}
