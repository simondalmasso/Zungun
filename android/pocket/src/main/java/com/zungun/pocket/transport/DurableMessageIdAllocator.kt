package com.zungun.pocket.transport

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

/**
 * Crash-conscious per-session message-ID allocator.
 *
 * This primitive must only be initialized after an authenticated KEYX has
 * completed and produced a fresh era/session secret. It does not implement
 * KEYX, encryption, peer authentication, or protection against restoration of
 * an entire previously valid filesystem snapshot.
 *
 * The committed head is the sole authority. Invalid/missing committed data
 * fails closed; the allocator must never recover by selecting an older slot.
 */
internal class DurableMessageIdAllocator(
    private val storage: MessageIdJournalStorage,
    private val authenticator: MessageIdHeadAuthenticator
) {
    data class Allocation(val epoch: Int, val messageId: Int, val sessionId: ByteArray)

    /**
     * Starts a newly authenticated epoch. For an existing journal, epochs must
     * strictly increase and session IDs must change. On a new journal, epoch
     * zero is required. A deleted/corrupt journal is not silently recreated.
     *
     * Call only after two-way key confirmation and creation of a fresh root key.
     */
    @Synchronized
    fun initializeAfterKeyConfirmation(epoch: Int, sessionId: ByteArray) {
        require(epoch in 0..MAX_EPOCH) { "epoch out of range" }
        require(sessionId.size == SESSION_ID_BYTES) { "session ID must be 32 bytes" }
        storage.withExclusiveLock {
            val current = loadCommitted()
            if (current == null) {
                if (storage.hasAnyState()) throw HandshakeRequiredException("journal exists without a valid commit head")
                require(epoch == 0) { "first epoch must be zero" }
                commit(slot = 0, State(generation = 1, epoch = epoch, nextMessageId = 0, sessionId = sessionId.copyOf()))
            } else {
                if (epoch <= current.state.epoch) {
                    throw HandshakeRequiredException("epoch downgrade or reuse rejected")
                }
                if (MessageDigest.isEqual(sessionId, current.state.sessionId)) {
                    throw HandshakeRequiredException("new epoch requires a fresh session ID")
                }
                val generation = nextGeneration(current.state.generation)
                commit(
                    slot = 1 - current.slot,
                    State(generation, epoch, 0, sessionId.copyOf())
                )
            }
        }
    }

    /**
     * Commits the incremented state before returning the selected ID. A crash
     * can waste an ID but cannot return an ID before its consumption is committed.
     * Retransmissions must reuse the exact already-encrypted bytes outside this class.
     */
    @Synchronized
    fun allocate(): Allocation = storage.withExclusiveLock {
        val current = loadCommitted()
            ?: throw HandshakeRequiredException("no authenticated epoch is initialized")
        val state = current.state
        if (state.nextMessageId >= MAX_MESSAGE_ID_EXCLUSIVE) {
            throw HandshakeRequiredException("message ID space exhausted; fresh authenticated epoch required")
        }
        val messageId = state.nextMessageId
        val updated = state.copy(
            generation = nextGeneration(state.generation),
            nextMessageId = messageId + 1
        )
        commit(1 - current.slot, updated)
        Allocation(state.epoch, messageId, state.sessionId.copyOf())
    }

    private fun nextGeneration(value: Long): Long {
        if (value <= 0 || value == Long.MAX_VALUE) {
            throw HandshakeRequiredException("journal generation exhausted or invalid")
        }
        return value + 1
    }

    private fun loadCommitted(): Committed? {
        val rawHead = storage.readHead()
        if (rawHead == null) {
            if (storage.hasAnyState()) throw HandshakeRequiredException("commit head is missing")
            return null
        }
        val parsed = parseHead(rawHead) ?: throw HandshakeRequiredException("commit head is malformed")
        if (!authenticator.verify(parsed.authenticatedBytes, parsed.mac)) {
            throw HandshakeRequiredException("commit head authentication failed")
        }
        val rawSlot = storage.readSlot(parsed.slot)
            ?: throw HandshakeRequiredException("committed journal slot is missing")
        if (!MessageDigest.isEqual(sha256(rawSlot), parsed.slotDigest)) {
            throw HandshakeRequiredException("committed journal slot digest mismatch")
        }
        val state = parseState(rawSlot) ?: throw HandshakeRequiredException("committed journal slot is malformed")
        if (state.generation != parsed.generation) {
            throw HandshakeRequiredException("commit head and slot generation mismatch")
        }
        return Committed(parsed.slot, state)
    }

    private fun commit(slot: Int, state: State) {
        val rawSlot = encodeState(state)
        // Ordering is intentional: slot first, authenticated head last.
        storage.writeSlot(slot, rawSlot)
        val unsignedHead = encodeHeadUnsigned(slot, state.generation, sha256(rawSlot))
        val mac = authenticator.authenticate(unsignedHead)
        if (mac.size != MAC_BYTES) throw IOException("head authenticator returned an invalid tag length")
        storage.writeHead(unsignedHead + mac)
    }

    internal data class State(
        val generation: Long,
        val epoch: Int,
        val nextMessageId: Int,
        val sessionId: ByteArray
    )
    private data class Committed(val slot: Int, val state: State)
    private data class ParsedHead(
        val slot: Int,
        val generation: Long,
        val slotDigest: ByteArray,
        val authenticatedBytes: ByteArray,
        val mac: ByteArray
    )

    private fun encodeState(state: State): ByteArray {
        require(state.generation > 0)
        require(state.epoch in 0..MAX_EPOCH)
        require(state.nextMessageId in 0..MAX_MESSAGE_ID_EXCLUSIVE)
        require(state.sessionId.size == SESSION_ID_BYTES)
        return ByteBuffer.allocate(SLOT_BYTES).order(ByteOrder.BIG_ENDIAN)
            .putInt(SLOT_MAGIC).putInt(FORMAT_VERSION).putLong(state.generation)
            .putInt(state.epoch).putInt(state.nextMessageId).put(state.sessionId).array()
    }

    private fun parseState(bytes: ByteArray): State? {
        if (bytes.size != SLOT_BYTES) return null
        return runCatching {
            val input = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
            if (input.int != SLOT_MAGIC || input.int != FORMAT_VERSION) return null
            val generation = input.long
            val epoch = input.int
            val nextId = input.int
            val sessionId = ByteArray(SESSION_ID_BYTES).also(input::get)
            if (generation <= 0 || epoch !in 0..MAX_EPOCH || nextId !in 0..MAX_MESSAGE_ID_EXCLUSIVE) return null
            State(generation, epoch, nextId, sessionId)
        }.getOrNull()
    }

    private fun encodeHeadUnsigned(slot: Int, generation: Long, slotDigest: ByteArray): ByteArray {
        require(slot in 0..1 && generation > 0 && slotDigest.size == DIGEST_BYTES)
        return ByteBuffer.allocate(HEAD_UNSIGNED_BYTES).order(ByteOrder.BIG_ENDIAN)
            .putInt(HEAD_MAGIC).putInt(FORMAT_VERSION).putInt(slot).putLong(generation).put(slotDigest).array()
    }

    private fun parseHead(bytes: ByteArray): ParsedHead? {
        if (bytes.size != HEAD_BYTES) return null
        return runCatching {
            val input = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
            if (input.int != HEAD_MAGIC || input.int != FORMAT_VERSION) return null
            val slot = input.int
            val generation = input.long
            val digest = ByteArray(DIGEST_BYTES).also(input::get)
            if (slot !in 0..1 || generation <= 0) return null
            ParsedHead(slot, generation, digest, bytes.copyOfRange(0, HEAD_UNSIGNED_BYTES), bytes.copyOfRange(HEAD_UNSIGNED_BYTES, HEAD_BYTES))
        }.getOrNull()
    }

    private fun sha256(bytes: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(bytes)

    internal class HandshakeRequiredException(message: String) : IllegalStateException(message)

    companion object {
        const val MAX_EPOCH = 0xFFFF
        /** IDs 0..0xFFFD may be used; 0xFFFE is the exhausted sentinel. */
        const val MAX_MESSAGE_ID_EXCLUSIVE = 0xFFFE
        private const val SESSION_ID_BYTES = 32
        private const val DIGEST_BYTES = 32
        private const val MAC_BYTES = 32
        private const val SLOT_MAGIC = 0x5A505331 // ZPS1
        private const val HEAD_MAGIC = 0x5A504831 // ZPH1
        private const val FORMAT_VERSION = 1
        private const val SLOT_BYTES = 4 + 4 + 8 + 4 + 4 + SESSION_ID_BYTES
        private const val HEAD_UNSIGNED_BYTES = 4 + 4 + 4 + 8 + DIGEST_BYTES
        private const val HEAD_BYTES = HEAD_UNSIGNED_BYTES + MAC_BYTES
    }
}

internal interface MessageIdJournalStorage {
    fun <T> withExclusiveLock(action: () -> T): T
    fun hasAnyState(): Boolean
    fun readHead(): ByteArray?
    fun readSlot(slot: Int): ByteArray?
    fun writeHead(bytes: ByteArray)
    fun writeSlot(slot: Int, bytes: ByteArray)
}

internal interface MessageIdHeadAuthenticator {
    fun authenticate(bytes: ByteArray): ByteArray
    fun verify(bytes: ByteArray, mac: ByteArray): Boolean
}

/** Android storage adapter. Files live in noBackupFilesDir and each file uses AtomicFile. */
internal class AndroidMessageIdJournalStorage(
    context: Context,
    peerFingerprintHex: String
) : MessageIdJournalStorage {
    init { require(isFingerprint(peerFingerprintHex)) { "peer fingerprint must be 64 lowercase hex characters" } }
    // The fingerprint must be SHA-256 of the verified peer identity public key, not a display name or pairing code.
    private val directory = File(File(context.noBackupFilesDir, "zungun-p2p-id-journal"), peerFingerprintHex)
    private val headFile = File(directory, "head.bin")
    private val slotFiles = arrayOf(File(directory, "slot0.bin"), File(directory, "slot1.bin"))
    private val lockFile = File(directory, "journal.lock")
    private val processLock = processLocks.computeIfAbsent(lockFile.absolutePath) { Any() }

    override fun <T> withExclusiveLock(action: () -> T): T = synchronized(processLock) {
        if (!directory.exists() && !directory.mkdirs()) throw IOException("cannot create P2P journal directory")
        RandomAccessFile(lockFile, "rw").use { random ->
            random.channel.lock().use { action() }
        }
    }

    override fun hasAnyState(): Boolean =
        (listOf(headFile) + slotFiles).any { file ->
            file.exists() || File(file.path + ".bak").exists() || File(file.path + ".new").exists()
        }

    override fun readHead(): ByteArray? = readAtomic(headFile)
    override fun readSlot(slot: Int): ByteArray? {
        require(slot in 0..1)
        return readAtomic(slotFiles[slot])
    }
    override fun writeHead(bytes: ByteArray) = writeAtomic(headFile, bytes)
    override fun writeSlot(slot: Int, bytes: ByteArray) {
        require(slot in 0..1)
        writeAtomic(slotFiles[slot], bytes)
    }

    private fun readAtomic(file: File): ByteArray? {
        val atomic = AtomicFile(file)
        return try {
            atomic.openRead().use { it.readBytes() }
        } catch (_: java.io.FileNotFoundException) {
            null
        }
    }

    private fun writeAtomic(file: File, bytes: ByteArray) {
        val atomic = AtomicFile(file)
        var stream: FileOutputStream? = null
        try {
            stream = atomic.startWrite()
            stream.write(bytes)
            atomic.finishWrite(stream)
        } catch (error: Exception) {
            stream?.let { failedStream -> runCatching { atomic.failWrite(failedStream) } }
            throw error
        }
    }

    companion object {
        private val processLocks = ConcurrentHashMap<String, Any>()
        private fun isFingerprint(value: String) = value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }
    }
}

/** HMAC key is hardware/OS-managed in Android Keystore, not stored beside the mutable journal. */
internal class AndroidKeystoreMessageIdHeadAuthenticator(
    peerFingerprintHex: String
) : MessageIdHeadAuthenticator {
    private val keyAlias: String

    init {
        require(peerFingerprintHex.length == 64 && peerFingerprintHex.all { it in '0'..'9' || it in 'a'..'f' }) {
            "peer fingerprint must be 64 lowercase hex characters"
        }
        keyAlias = "zungun-p2p-id-head-v1-$peerFingerprintHex"
    }
    override fun authenticate(bytes: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(loadOrCreateKey())
        return mac.doFinal(bytes)
    }

    override fun verify(bytes: ByteArray, macBytes: ByteArray): Boolean {
        val key = loadExistingKey() ?: return false
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(key)
        return MessageDigest.isEqual(mac.doFinal(bytes), macBytes)
    }

    private fun loadExistingKey(): SecretKey? {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return store.getKey(keyAlias, null) as? SecretKey
    }

    private fun loadOrCreateKey(): SecretKey {
        loadExistingKey()?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
                ).setDigests(KeyProperties.DIGEST_SHA256).build()
            )
            generateKey()
        }
    }

}
