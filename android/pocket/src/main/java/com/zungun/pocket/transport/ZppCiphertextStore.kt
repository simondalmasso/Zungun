package com.zungun.pocket.transport

import android.content.Context
import android.system.Os
import android.system.OsConstants
import android.util.AtomicFile
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

internal data class ZppRecordKey(
    val epoch: Int,
    val messageId: Int,
    val direction: ZppDirection
) {
    init {
        require(epoch in 0..ZppNonce.MAX_EPOCH)
        require(messageId in 0..ZppNonce.MAX_MESSAGE_ID)
    }
}

internal interface ZppCiphertextStore {
    /** Persist a reservation before encrypting; failed reservations permanently burn the identity. */
    fun sealOnce(key: ZppRecordKey, createFrame: () -> ByteArray): ByteArray
    fun load(key: ZppRecordKey): ByteArray?
}

internal class ZppRecordAlreadySealedException(message: String) : IllegalStateException(message)
internal class ZppCiphertextUnavailableException(message: String) : IllegalStateException(message)

/**
 * Per-peer durable outbound ciphertext journal. It stores ciphertext only, never
 * plaintext, and reserves an identity before calling the encryption callback.
 */
internal class AndroidZppCiphertextStore(
    context: Context,
    peerFingerprintHex: String
) : ZppCiphertextStore {
    init { require(isFingerprint(peerFingerprintHex)) { "peer fingerprint must be 64 lowercase hex characters" } }

    private val parent = File(context.noBackupFilesDir, "zungun-p2p-ciphertext")
    private val directory = File(parent, peerFingerprintHex)
    private val lockFile = File(directory, "journal.lock")
    private val processLock = processLocks.computeIfAbsent(lockFile.absolutePath) { Any() }

    override fun sealOnce(key: ZppRecordKey, createFrame: () -> ByteArray): ByteArray =
        withExclusiveLock {
            val target = fileFor(key)
            if (hasState(target)) {
                throw ZppRecordAlreadySealedException("record identity was already reserved; allocate a new message ID")
            }

            // A durable marker burns the ID before crypto starts. Crash recovery
            // never treats this marker as permission to encrypt the same nonce again.
            writeAtomic(target, RESERVED_MARKER)
            val created = createFrame()
            validateFrameForKey(created, key)
            writeAtomic(target, created)
            val persisted = readAtomic(target)
                ?: throw IOException("ciphertext record disappeared after commit")
            if (!MessageDigest.isEqual(persisted, created)) {
                throw IOException("ciphertext readback did not match the committed record")
            }
            persisted
        }

    override fun load(key: ZppRecordKey): ByteArray? = withExclusiveLock {
        val target = fileFor(key)
        if (!hasState(target)) return@withExclusiveLock null
        val bytes = readAtomic(target)
            ?: throw ZppCiphertextUnavailableException("ciphertext journal state exists but cannot be read")
        if (bytes.contentEquals(RESERVED_MARKER)) {
            throw ZppCiphertextUnavailableException("record ID was reserved but ciphertext was not committed; ID remains burned")
        }
        validateFrameForKey(bytes, key)
        bytes.copyOf()
    }

    private fun validateFrameForKey(frame: ByteArray, key: ZppRecordKey) {
        if (frame.size < ZppFrameHeader.BYTES + ZppCodec.TAG_BYTES ||
            frame.size > P2pDatagramPolicy.MAX_DATAGRAM_BYTES) {
            throw IOException("stored ZPP frame length is invalid")
        }
        val header = ZppFrameHeader.decode(frame.copyOfRange(0, ZppFrameHeader.BYTES))
        if (header.epoch != key.epoch || header.messageId != key.messageId || header.direction != key.direction) {
            throw IOException("stored ZPP frame identity does not match its journal key")
        }
    }

    private fun fileFor(key: ZppRecordKey): File {
        val epoch = key.epoch.toString(16).padStart(4, '0')
        val messageId = key.messageId.toString(16).padStart(4, '0')
        val name = epoch + "-" + messageId + "-" + key.direction.wireCode + ".bin"
        return File(directory, name)
    }

    private fun <T> withExclusiveLock(action: () -> T): T = synchronized(processLock) {
        ensureDirectory(parent, requireNotNull(parent.parentFile))
        ensureDirectory(directory, parent)
        RandomAccessFile(lockFile, "rw").use { random ->
            random.channel.lock().use { action() }
        }
    }

    private fun ensureDirectory(path: File, parentDirectory: File) {
        if (!path.exists()) {
            if (!path.mkdir() && !path.isDirectory) throw IOException("cannot create ciphertext journal directory")
            syncDirectory(parentDirectory)
        }
        if (!path.isDirectory) throw IOException("ciphertext journal path is not a directory")
    }

    private fun hasState(file: File): Boolean =
        file.exists() || File(file.path + ".bak").exists() || File(file.path + ".new").exists()

    private fun readAtomic(file: File): ByteArray? = try {
        AtomicFile(file).openRead().use { it.readBytes() }
    } catch (_: java.io.FileNotFoundException) {
        null
    }

    private fun writeAtomic(file: File, bytes: ByteArray) {
        val atomic = AtomicFile(file)
        var stream: FileOutputStream? = null
        try {
            stream = atomic.startWrite()
            stream.write(bytes)
            stream.fd.sync()
            atomic.finishWrite(stream)
            syncDirectory()
        } catch (error: Exception) {
            stream?.let { failedStream -> runCatching { atomic.failWrite(failedStream) } }
            throw error
        }
    }

    private fun syncDirectory(path: File = directory) {
        val descriptor = Os.open(path.absolutePath, OsConstants.O_RDONLY, 0)
        try {
            Os.fsync(descriptor)
        } finally {
            runCatching { Os.close(descriptor) }
        }
    }

    companion object {
        private val processLocks = ConcurrentHashMap<String, Any>()
        private val RESERVED_MARKER = byteArrayOf(0x5A, 0x50, 0x52, 0x53, 0x56, 0x01)
        private fun isFingerprint(value: String) =
            value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' }
    }
}
