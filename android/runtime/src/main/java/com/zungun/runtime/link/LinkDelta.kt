package com.zungun.runtime.link

import android.util.Base64
import org.json.JSONObject
import java.security.MessageDigest

data class LinkDeltaSpec(
    val baseSha256: String,
    val payload: ByteArray,
    val sha256: String = MessageDigest.getInstance("SHA-256").digest(payload).joinToString("") { "%02x".format(it) },
) {
    init {
        require(baseSha256.matches(Regex("[0-9a-f]{64}"))) { "LINK_DELTA_BASE_INVALID" }
        require(sha256.matches(Regex("[0-9a-f]{64}"))) { "LINK_DELTA_HASH_INVALID" }
        require(MessageDigest.getInstance("SHA-256").digest(payload).joinToString("") { "%02x".format(it) } == sha256) { "LINK_DELTA_HASH_MISMATCH" }
    }
}

data class LinkPayloadMetadata(val delta: LinkDeltaSpec?)

internal object LinkPayloadMetadataCodec {
    fun attach(profileJson: String, metadata: LinkPayloadMetadata?): String {
        if (metadata?.delta == null) return profileJson
        val root = JSONObject(profileJson)
        root.put("payloadMetadata", JSONObject()
            .put("deltaBaseSha256", metadata.delta.baseSha256)
            .put("deltaSha256", metadata.delta.sha256)
            .put("deltaPayloadBase64", Base64.encodeToString(metadata.delta.payload, Base64.NO_WRAP)))
        return root.toString()
    }

    fun read(profileJson: String): LinkPayloadMetadata? {
        val root = JSONObject(profileJson)
        if (root.isNull("payloadMetadata") || !root.has("payloadMetadata")) return null
        val value = root.getJSONObject("payloadMetadata")
        val payload = Base64.decode(value.getString("deltaPayloadBase64"), Base64.DEFAULT)
        return LinkPayloadMetadata(LinkDeltaSpec(value.getString("deltaBaseSha256"), payload, value.getString("deltaSha256")))
    }
}
