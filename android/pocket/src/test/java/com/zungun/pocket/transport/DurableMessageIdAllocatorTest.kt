package com.zungun.pocket.transport

import java.io.IOException
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DurableMessageIdAllocatorTest {
    @Test fun allocationCommitsBeforeReturningAndResumesAfterReconstruction() {
        val storage = MemoryStorage()
        val auth = TestAuthenticator()
        val allocator = DurableMessageIdAllocator(storage, auth)
        allocator.initializeAfterKeyConfirmation(0, session(1))

        assertEquals(0, allocator.allocate().messageId)
        assertEquals(1, allocator.allocate().messageId)
        val afterRestart = DurableMessageIdAllocator(storage, auth)
        val resumed = afterRestart.allocate()
        assertEquals(0, resumed.epoch)
        assertEquals(2, resumed.messageId)
        assertEquals(3, DurableMessageIdAllocator(storage, auth).allocate().messageId)
    }

    @Test fun failedHeadCommitDoesNotReturnOrConsumeAnId() {
        val storage = MemoryStorage()
        val allocator = DurableMessageIdAllocator(storage, TestAuthenticator())
        allocator.initializeAfterKeyConfirmation(0, session(2))
        storage.failNextHeadWrite = true

        expectHandshakeOrStorageFailure { allocator.allocate() }
        assertEquals(0, allocator.allocate().messageId)
        assertEquals(1, allocator.allocate().messageId)
    }

    @Test fun corruptedCommittedSlotFailsClosedInsteadOfFallingBackToOlderSlot() {
        val storage = MemoryStorage()
        val allocator = DurableMessageIdAllocator(storage, TestAuthenticator())
        allocator.initializeAfterKeyConfirmation(0, session(3))
        assertEquals(0, allocator.allocate().messageId) // commits generation 2 to slot 1
        storage.corruptSlot(1)

        assertHandshakeRequired { allocator.allocate() }
    }

    @Test fun deletedEntireJournalCannotBeReinitializedWhileHmacKeyExists() {
        val storage = MemoryStorage()
        val auth = TestAuthenticator()
        val allocator = DurableMessageIdAllocator(storage, auth)
        allocator.initializeAfterKeyConfirmation(0, session(44))
        assertEquals(0, allocator.allocate().messageId)

        // Simulates every file disappearing while the per-peer Keystore HMAC key survives.
        storage.clearAll()
        assertHandshakeRequired { allocator.initializeAfterKeyConfirmation(0, session(45)) }
        assertHandshakeRequired { allocator.allocate() }
    }

    @Test fun corruptedCommitHeadFailsClosed() {
        val storage = MemoryStorage()
        val allocator = DurableMessageIdAllocator(storage, TestAuthenticator())
        allocator.initializeAfterKeyConfirmation(0, session(4))
        storage.corruptHead()
        assertHandshakeRequired { allocator.allocate() }
    }

    @Test fun epochMustAdvanceExactlyOneAndSessionIdMustChange() {
        val storage = MemoryStorage()
        val allocator = DurableMessageIdAllocator(storage, TestAuthenticator())
        allocator.initializeAfterKeyConfirmation(0, session(5))
        assertHandshakeRequired { allocator.initializeAfterKeyConfirmation(0, session(6)) }
        assertHandshakeRequired { allocator.initializeAfterKeyConfirmation(2, session(6)) }
        assertHandshakeRequired { allocator.initializeAfterKeyConfirmation(1, session(5)) }
        allocator.initializeAfterKeyConfirmation(1, session(6))
        val allocation = allocator.allocate()
        assertEquals(1, allocation.epoch)
        assertEquals(0, allocation.messageId)
    }

    @Test fun missingHeadWithLeftoverSlotsRequiresHandshake() {
        val storage = MemoryStorage()
        val allocator = DurableMessageIdAllocator(storage, TestAuthenticator())
        allocator.initializeAfterKeyConfirmation(0, session(7))
        storage.head = null
        assertHandshakeRequired { allocator.allocate() }
        assertHandshakeRequired { allocator.initializeAfterKeyConfirmation(0, session(8)) }
    }

    @Test fun messageIdsNeverWrap() {
        val storage = MemoryStorage()
        val allocator = DurableMessageIdAllocator(storage, TestAuthenticator())
        allocator.initializeAfterKeyConfirmation(0, session(9))

        for (expected in 0 until DurableMessageIdAllocator.MAX_MESSAGE_ID_EXCLUSIVE) {
            assertEquals(expected, allocator.allocate().messageId)
        }
        assertHandshakeRequired { allocator.allocate() }
        allocator.initializeAfterKeyConfirmation(1, session(91))
        assertEquals(0, allocator.allocate().messageId)
    }

    @Test fun concurrentAllocationsAreUnique() {
        val storage = MemoryStorage()
        val allocator = DurableMessageIdAllocator(storage, TestAuthenticator())
        allocator.initializeAfterKeyConfirmation(0, session(10))
        val ids = Collections.synchronizedSet(mutableSetOf<Int>())
        val start = CountDownLatch(1)
        val executor = Executors.newFixedThreadPool(6)
        try {
            val jobs = (0 until 6).map {
                executor.submit {
                    start.await()
                    repeat(100) { assertTrue(ids.add(allocator.allocate().messageId)) }
                }
            }
            start.countDown()
            jobs.forEach { it.get() }
        } finally {
            executor.shutdownNow()
        }
        assertEquals(600, ids.size)
        assertEquals(600, DurableMessageIdAllocator(storage, TestAuthenticator()).allocate().messageId)
    }

    private fun session(seed: Int) = ByteArray(32) { (seed + it).toByte() }

    private fun assertHandshakeRequired(action: () -> Unit) {
        try {
            action()
            throw AssertionError("expected HandshakeRequiredException")
        } catch (_: DurableMessageIdAllocator.HandshakeRequiredException) {
            // expected fail-closed behavior
        }
    }

    private fun expectHandshakeOrStorageFailure(action: () -> Unit) {
        try {
            action()
        } catch (_: DurableMessageIdAllocator.HandshakeRequiredException) {
            return
        } catch (_: IOException) {
            return
        }
        throw AssertionError("expected failed commit to abort allocation")
    }

    private class MemoryStorage : MessageIdJournalStorage {
        private val lock = Any()
        var head: ByteArray? = null
        private val slots = arrayOfNulls<ByteArray>(2)
        var failNextHeadWrite = false

        override fun <T> withExclusiveLock(action: () -> T): T = synchronized(lock) { action() }
        override fun hasAnyState(): Boolean = head != null || slots.any { it != null }
        override fun readHead(): ByteArray? = head?.copyOf()
        override fun readSlot(slot: Int): ByteArray? = slots[slot]?.copyOf()
        override fun writeHead(bytes: ByteArray) {
            if (failNextHeadWrite) {
                failNextHeadWrite = false
                throw IOException("simulated head commit failure")
            }
            head = bytes.copyOf()
        }
        override fun writeSlot(slot: Int, bytes: ByteArray) { slots[slot] = bytes.copyOf() }
        fun clearAll() {
            head = null
            slots.indices.forEach { slots[it] = null }
        }
        fun corruptHead() { head = head?.also { it[it.lastIndex] = (it.last().toInt() xor 0x55).toByte() } }
        fun corruptSlot(slot: Int) {
            slots[slot]?.let { it[it.lastIndex] = (it.last().toInt() xor 0x55).toByte() }
        }
    }

    /** Deterministic test-only authenticator; production uses Android Keystore HMAC-SHA-256. */
    private class TestAuthenticator : MessageIdHeadAuthenticator {
        private var hasKey = false

        override fun hasKeyMaterial(): Boolean = hasKey

        override fun authenticate(bytes: ByteArray): ByteArray {
            hasKey = true
            return MessageDigest.getInstance("SHA-256").digest(bytes)
        }

        override fun verify(bytes: ByteArray, mac: ByteArray): Boolean =
            hasKey && MessageDigest.isEqual(authenticate(bytes), mac)
    }
}
