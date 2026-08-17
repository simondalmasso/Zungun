package com.zungun.runtime.network

import android.util.Base64
import com.zungun.runtime.db.OperationEntity
import com.zungun.runtime.receipt.ReceiptVerifier
import com.zungun.runtime.receipt.VerificationKey
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.URI
import java.net.URL
import java.net.UnknownHostException
import java.security.MessageDigest

sealed interface TransportResult {
    data class Accepted(
        val duplicate: Boolean,
        val receiverState: String,
        val receipt: VerifiedReceipt?,
        val httpStatus: Int,
        val responseSha256: String,
    ) : TransportResult

    data class DeterministicFailure(
        val code: String,
        val httpStatus: Int,
        val responseSha256: String,
    ) : TransportResult

    /** Failure proven to have happened before a receiver connection was established; receiver acceptance is impossible. */
    data class RetryableNotSent(val code: String) : TransportResult

    data class AmbiguousFailure(val code: String) : TransportResult
}

data class VerifiedReceipt(
    val receiptId: String,
    val keyId: String,
    val algorithm: String,
    val payloadJson: String,
    val signatureBase64: String,
    val payloadSha256: String,
    val applicationOutcome: String,
)

fun interface ReceiverTransportClient {
    suspend fun deliver(
        operation: OperationEntity,
        configuration: ReceiverConfiguration,
        nowMs: Long,
    ): TransportResult

    suspend fun deliver(
        operation: OperationEntity,
        configuration: ReceiverConfiguration,
        nowMs: Long,
        witnessChainJson: List<String>,
    ): TransportResult = deliver(operation, configuration, nowMs)
}

class HttpReceiverTransportClient : ReceiverTransportClient {
    override suspend fun deliver(
        operation: OperationEntity,
        configuration: ReceiverConfiguration,
        nowMs: Long,
    ): TransportResult = deliver(operation, configuration, nowMs, emptyList())

    override suspend fun deliver(
        operation: OperationEntity,
        configuration: ReceiverConfiguration,
        nowMs: Long,
        witnessChainJson: List<String>,
    ): TransportResult {
        validateEndpoint(configuration)
        val token = configuration.credentialProvider.bearerToken()
        require(token.length >= 16) { "INVALID_CREDENTIAL" }
        val body = envelopeJson(operation).toString()
        return try {
            val response = request(
                url = "${configuration.endpointUrl.trimEnd('/')}/api/v1/operations",
                method = "POST",
                token = token,
                body = body,
                configuration = configuration,
            )
            val responseHash = sha256(response.body)
            if (response.status == 202) {
                if (witnessChainJson.isNotEmpty()) {
                    val witnessChain = JSONArray()
                    witnessChainJson.forEach { witnessChain.put(JSONObject(it)) }
                    val witnessResponse = request(
                        url = "${configuration.endpointUrl.trimEnd('/')}/api/v1/operations/${operation.operationId}/witness/ingest",
                        method = "POST",
                        token = token,
                        body = JSONObject().put("chain", witnessChain).put("nowMs", nowMs).toString(),
                        configuration = configuration,
                    )
                    if (witnessResponse.status !in 200..299) {
                        val code = runCatching {
                            JSONObject(witnessResponse.body).optString("error", "WITNESS_HTTP_${witnessResponse.status}")
                        }.getOrDefault("WITNESS_HTTP_${witnessResponse.status}")
                        return if (witnessResponse.status in 400..499) {
                            TransportResult.DeterministicFailure(code, witnessResponse.status, sha256(witnessResponse.body))
                        } else {
                            TransportResult.AmbiguousFailure(code)
                        }
                    }
                }
                val json = JSONObject(response.body)
                val receipt = if (json.isNull("receipt")) null else verifyReceipt(
                    operation,
                    configuration,
                    token,
                    json.getJSONObject("receipt"),
                    nowMs,
                )
                TransportResult.Accepted(
                    duplicate = json.getBoolean("duplicate"),
                    receiverState = json.getString("state"),
                    receipt = receipt,
                    httpStatus = response.status,
                    responseSha256 = responseHash,
                )
            } else if (response.status in 400..499) {
                val code = runCatching { JSONObject(response.body).optString("error", "HTTP_${response.status}") }
                    .getOrDefault("HTTP_${response.status}")
                TransportResult.DeterministicFailure(code, response.status, responseHash)
            } else {
                TransportResult.AmbiguousFailure("HTTP_${response.status}")
            }
        } catch (error: ConnectException) {
            TransportResult.RetryableNotSent(error.javaClass.simpleName)
        } catch (error: NoRouteToHostException) {
            TransportResult.RetryableNotSent(error.javaClass.simpleName)
        } catch (error: UnknownHostException) {
            TransportResult.RetryableNotSent(error.javaClass.simpleName)
        } catch (error: IOException) {
            TransportResult.AmbiguousFailure(error.javaClass.simpleName)
        }
    }

    private suspend fun verifyReceipt(
        operation: OperationEntity,
        configuration: ReceiverConfiguration,
        token: String,
        receipt: JSONObject,
        nowMs: Long,
    ): VerifiedReceipt {
        val payload = receipt.getJSONObject("payload")
        val payloadJson = CanonicalJson.stringify(payload)
        val keyId = receipt.getString("keyId")
        val resolver = configuration.verificationKeyResolver
        val key = resolver?.resolve(keyId) ?: fetchKey(configuration, token, keyId)
        require(key != null) { "RECEIPT_KEY_NOT_FOUND" }
        val algorithm = receipt.getString("algorithm")
        val signature = receipt.getString("signatureBase64")
        val payloadSha = receipt.getString("payloadSha256")
        require(ReceiptVerifier.verify(
            payloadJson = payloadJson,
            payloadSha256 = payloadSha,
            signatureBase64 = signature,
            keyId = keyId,
            algorithm = algorithm,
            key = key,
            nowMs = nowMs,
        )) { "RECEIPT_SIGNATURE_INVALID" }
        require(payload.getString("operationId") == operation.operationId) { "RECEIPT_OPERATION_MISMATCH" }
        require(payload.getString("messageCommitment") == operation.messageCommitment) { "RECEIPT_COMMITMENT_MISMATCH" }
        require(payload.getString("receiverId") == configuration.receiverId) { "RECEIPT_RECEIVER_MISMATCH" }
        require(payload.getString("scopeType") == operation.scopeType) { "RECEIPT_SCOPE_MISMATCH" }
        require(payload.getString("scopeId") == operation.scopeId) { "RECEIPT_SCOPE_MISMATCH" }
        require(payload.getString("replayNonce") == operation.replayNonce) { "RECEIPT_NONCE_MISMATCH" }
        val outcome = ReceiptVerifier.requireBusinessOutcome(payloadJson)
        return VerifiedReceipt(
            receiptId = "receipt_${payloadSha.take(32)}",
            keyId = keyId,
            algorithm = algorithm,
            payloadJson = payloadJson,
            signatureBase64 = signature,
            payloadSha256 = payloadSha,
            applicationOutcome = outcome,
        )
    }

    private fun fetchKey(
        configuration: ReceiverConfiguration,
        token: String,
        keyId: String,
    ): VerificationKey? {
        val response = request(
            url = "${configuration.endpointUrl.trimEnd('/')}/api/v1/keys",
            method = "GET",
            token = token,
            body = null,
            configuration = configuration,
        )
        if (response.status != 200) return null
        val items = JSONObject(response.body).getJSONArray("items")
        for (index in 0 until items.length()) {
            val item = items.getJSONObject(index)
            if (item.getString("keyId") != keyId) continue
            return VerificationKey(
                keyId = keyId,
                publicKeyDerBase64 = pemToDer(item.getString("publicKeyPem")),
                validFromMs = item.getLong("validFromMs"),
                validUntilMs = item.getLong("validUntilMs"),
                revokedAtMs = if (item.isNull("revokedAtMs")) null else item.getLong("revokedAtMs"),
            )
        }
        return null
    }

    private fun envelopeJson(operation: OperationEntity) = JSONObject()
        .put("protocol", "zungun.operation.v1")
        .put("wireVersion", 1)
        .put("operationId", operation.operationId)
        .put("idempotencyKey", operation.idempotencyKey)
        .put("tenantId", operation.tenantId)
        .put("scopeType", operation.scopeType)
        .put("scopeId", operation.scopeId)
        .put("workOrderId", operation.workOrderId)
        .put("messageId", operation.messageId)
        .put("messageCommitment", operation.messageCommitment)
        .put("payloadBase64", Base64.encodeToString(operation.payload, Base64.NO_WRAP))
        .put("contentType", operation.contentType)
        .put("policy", JSONObject()
            .put("priority", operation.priority)
            .put("createdAtMs", operation.createdAtMs)
            .put("expiresAtMs", operation.expiresAtMs)
            .put("retryBudget", operation.retryBudget)
            .put("cancellationAllowed", operation.cancellationAllowed)
            .put("semanticRevalidationRequired", operation.semanticRevalidationRequired)
            .put("maxPayloadBytes", operation.maxPayloadBytes))
        .put("replayNonce", operation.replayNonce)
        .put("extensions", JSONObject()
            .put("deviceId", operation.deviceId)
            .put("clientVersion", "android-order076"))

    private data class HttpResponse(val status: Int, val body: String)

    private fun request(
        url: String,
        method: String,
        token: String,
        body: String?,
        configuration: ReceiverConfiguration,
    ): HttpResponse {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = configuration.connectTimeoutMs
            connection.readTimeout = configuration.readTimeoutMs
            connection.setRequestProperty("authorization", "Bearer $token")
            connection.setRequestProperty("accept", "application/json")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("content-type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            return HttpResponse(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            connection.disconnect()
        }
    }

    private fun validateEndpoint(configuration: ReceiverConfiguration) {
        val uri = URI(configuration.endpointUrl)
        val loopback = uri.host in setOf("127.0.0.1", "localhost", "10.0.2.2", "::1")
        require(uri.scheme == "https" || configuration.allowCleartextLoopback && loopback) {
            "TLS_REQUIRED"
        }
    }

    private fun pemToDer(value: String): String = value
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replace(Regex("\\s"), "")

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }
}
