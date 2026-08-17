package com.zungun.runtime.link

import android.content.Context
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

data class StoredDeferredObject(
    val objectId: String,
    val sha256: String,
    val byteLength: Long,
    val chunkSizeBytes: Int,
    val chunkHashes: List<String>,
    val file: File,
)

class DeferredObjectStore(context: Context, private val maxObjectBytes: Long = 64L * 1024 * 1024) {
    private val root = File(context.applicationContext.filesDir, "zungun-link/objects").also { it.mkdirs() }

    fun put(input: InputStream, chunkSizeBytes: Int = 256 * 1024): StoredDeferredObject {
        require(chunkSizeBytes in 1024..4 * 1024 * 1024) { "LINK_CHUNK_SIZE_INVALID" }
        val temp = File(root, ".tmp-${UUID.randomUUID()}")
        val full = MessageDigest.getInstance("SHA-256")
        val chunks = mutableListOf<String>()
        var total = 0L
        try {
            temp.outputStream().buffered().use { output ->
                val buffer = ByteArray(chunkSizeBytes)
                while (true) {
                    var used = 0
                    while (used < buffer.size) {
                        val read = input.read(buffer, used, buffer.size - used)
                        if (read < 0) break
                        if (read == 0) continue
                        used += read; total += read
                        require(total <= maxObjectBytes) { "LINK_DEFERRED_OBJECT_TOO_LARGE" }
                    }
                    if (used == 0) break
                    output.write(buffer, 0, used); full.update(buffer, 0, used)
                    chunks += MessageDigest.getInstance("SHA-256").digest(buffer.copyOf(used)).hex()
                    if (used < buffer.size) break
                }
            }
            val hash = full.digest().hex(); val target = File(root, hash)
            if (target.exists()) {
                require(target.length() == total && sha256(target) == hash) { "LINK_DEFERRED_DEDUP_CORRUPT" }
                temp.delete()
            } else {
                require(temp.renameTo(target)) { "LINK_DEFERRED_ATOMIC_COMMIT_FAILED" }
            }
            return StoredDeferredObject("sha256:$hash",hash,total,chunkSizeBytes,chunks.toList(),target)
        } catch (error: Throwable) {
            temp.delete(); throw error
        }
    }

    fun open(sha256: String, offset: Long = 0): InputStream {
        require(sha256.matches(Regex("[0-9a-f]{64}"))) { "LINK_DEFERRED_HASH_INVALID" }
        val file=File(root,sha256); require(file.isFile) { "LINK_DEFERRED_OBJECT_MISSING" }; require(sha256(file)==sha256) { "LINK_DEFERRED_HASH_MISMATCH" }
        require(offset in 0..file.length()) { "LINK_DEFERRED_OFFSET_INVALID" }
        val input=file.inputStream().buffered(); var remaining=offset
        while(remaining>0){val skipped=input.skip(remaining);if(skipped<=0){input.close();error("LINK_DEFERRED_OFFSET_UNREACHABLE")};remaining-=skipped}
        return input
    }

    fun prefixSha256(sha256:String,length:Long):String {
        require(sha256.matches(Regex("[0-9a-f]{64}"))) { "LINK_DEFERRED_HASH_INVALID" };val file=File(root,sha256);require(length in 0..file.length()){"LINK_DEFERRED_OFFSET_INVALID"}
        val d=MessageDigest.getInstance("SHA-256");file.inputStream().use{input->val b=ByteArray(64*1024);var left=length;while(left>0){val n=input.read(b,0,minOf(b.size.toLong(),left).toInt());if(n<0)error("LINK_DEFERRED_PREFIX_TRUNCATED");d.update(b,0,n);left-=n}};return d.digest().hex()
    }

    private fun sha256(file: File): String { val d=MessageDigest.getInstance("SHA-256");file.inputStream().use{input->val b=ByteArray(64*1024);while(true){val n=input.read(b);if(n<0)break;if(n>0)d.update(b,0,n)}};return d.digest().hex() }
    private fun ByteArray.hex()=joinToString(""){"%02x".format(it)}
}
