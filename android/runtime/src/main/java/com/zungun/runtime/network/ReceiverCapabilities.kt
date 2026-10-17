package com.zungun.runtime.network

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.net.URL

/** Versioned receiver capability contract. Absence/invalid/downgrade fails conservative. */
data class ReceiverCapabilities(
    val schemaVersion: String,
    val version: Int,
    val fetchedAtMs: Long,
    val expiresAtMs: Long,
    val supportsOperationQuery: Boolean,
    val supportsDurableReceipt: Boolean,
    val supportsResume: Boolean,
    val supportsNetworkBinding: Boolean,
    val deltaMode: String,
    val exactBaseAvailable: Boolean,
) {
    fun validAt(nowMs: Long): Boolean = schemaVersion == SCHEMA && version == 1 && fetchedAtMs <= nowMs && nowMs < expiresAtMs
    companion object {
        const val SCHEMA = "zungun.receiver-capabilities/1"
        fun conservative(nowMs: Long) = ReceiverCapabilities(SCHEMA, 1, nowMs, nowMs, false, false, false, false, "NONE", false)
    }
}

fun interface ReceiverCapabilityClient {
    suspend fun fetch(context: Context, configuration: ReceiverConfiguration, requiredBaseSha256: String?, nowMs: Long): ReceiverCapabilities
}

class HttpReceiverCapabilityClient : ReceiverCapabilityClient {
    override suspend fun fetch(context: Context, configuration: ReceiverConfiguration, requiredBaseSha256: String?, nowMs: Long): ReceiverCapabilities {
        val prefs = context.getSharedPreferences("zungun-receiver-capabilities-v1", Context.MODE_PRIVATE)
        val cacheKey = configuration.receiverId + "|" + configuration.endpointUrl + "|" + (requiredBaseSha256 ?: "~")
        prefs.getString(cacheKey, null)?.let { cached -> parse(cached, nowMs)?.let { return it } }
        val value = runCatching { request(configuration, requiredBaseSha256, nowMs) }.getOrNull() ?: return ReceiverCapabilities.conservative(nowMs)
        if (!value.validAt(nowMs)) return ReceiverCapabilities.conservative(nowMs)
        prefs.edit().putString(cacheKey, encode(value)).apply()
        return value
    }

    private suspend fun request(configuration: ReceiverConfiguration, base: String?, nowMs: Long): ReceiverCapabilities {
        val uri = URI(configuration.endpointUrl)
        val loopback = uri.host in setOf("127.0.0.1", "localhost", "10.0.2.2", "::1")
        require(uri.scheme == "https" || configuration.allowCleartextLoopback && loopback) { "TLS_REQUIRED" }
        val suffix = base?.let { "?baseSha256=" + URLEncoder.encode(it, "UTF-8") } ?: ""
        val connection = URL(configuration.endpointUrl.trimEnd('/') + "/api/v1/capabilities" + suffix).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"; connection.connectTimeout = configuration.connectTimeoutMs; connection.readTimeout = configuration.readTimeoutMs
            connection.instanceFollowRedirects = false; connection.setRequestProperty("authorization", "Bearer ${configuration.credentialProvider.bearerToken()}"); connection.setRequestProperty("accept", "application/json")
            if (connection.responseCode != 200) return ReceiverCapabilities.conservative(nowMs)
            val root = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            if (root.optString("schemaVersion") != ReceiverCapabilities.SCHEMA || root.optInt("version") != 1) return ReceiverCapabilities.conservative(nowMs)
            if (root.optString("receiverId") != configuration.receiverId) return ReceiverCapabilities.conservative(nowMs)
            val ttl = root.optLong("ttlMs", 0L)
            if (ttl !in 1..3_600_000) return ReceiverCapabilities.conservative(nowMs)
            val delta = root.optJSONObject("delta") ?: JSONObject()
            val ops = root.optJSONObject("operations") ?: JSONObject()
            val transfer = root.optJSONObject("transfer") ?: JSONObject()
            return ReceiverCapabilities(ReceiverCapabilities.SCHEMA, 1, nowMs, nowMs + ttl, ops.optBoolean("query", false), ops.optBoolean("durableReceipt", false), transfer.optBoolean("resume", false), transfer.optBoolean("networkBinding", false), delta.optString("mode", "NONE"), delta.optBoolean("exactBaseAvailable", false))
        } finally { connection.disconnect() }
    }

    private fun encode(c: ReceiverCapabilities) = JSONObject()
        .put("schemaVersion", c.schemaVersion).put("version", c.version).put("fetchedAtMs", c.fetchedAtMs).put("expiresAtMs", c.expiresAtMs)
        .put("supportsOperationQuery", c.supportsOperationQuery).put("supportsDurableReceipt", c.supportsDurableReceipt).put("supportsResume", c.supportsResume).put("supportsNetworkBinding", c.supportsNetworkBinding)
        .put("deltaMode", c.deltaMode).put("exactBaseAvailable", c.exactBaseAvailable).toString()

    private fun parse(text: String, nowMs: Long): ReceiverCapabilities? = runCatching {
        val j = JSONObject(text); ReceiverCapabilities(j.getString("schemaVersion"), j.getInt("version"), j.getLong("fetchedAtMs"), j.getLong("expiresAtMs"), j.getBoolean("supportsOperationQuery"), j.getBoolean("supportsDurableReceipt"), j.getBoolean("supportsResume"), j.getBoolean("supportsNetworkBinding"), j.getString("deltaMode"), j.getBoolean("exactBaseAvailable"))
    }.getOrNull()?.takeIf { it.validAt(nowMs) }
}
