package com.zungun.app

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.net.InetAddress
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Same-device CORS bridge for the Zungun PWA. It binds only to loopback,
 * accepts one pinned web origin and a per-run bearer token, and proxies only
 * SMS Gateway inbox/send endpoints to localhost:8080.
 */
internal class LocalSmsCompanionServer(
    private val bearerToken: String,
    private val gatewayUsername: String,
    private val gatewayPassword: String,
    private val allowedOrigin: String = ALLOWED_ORIGIN,
) : AutoCloseable {
    private val running = AtomicBoolean(false)
    @Volatile private var server: ServerSocket? = null
    private var thread: Thread? = null

    fun start() {
        check(running.compareAndSet(false, true)) { "SMS_COMPANION_ALREADY_RUNNING" }
        val listener = try { ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1")) }
        catch (e: Exception) { running.set(false); throw e }
        server = listener
        thread = Thread({
            try {
                listener.use {
                    while (running.get()) {
                        try {
                            val socket = listener.accept()
                            Thread({ handle(socket) }, "zungun-sms-client").apply { isDaemon = true; start() }
                        } catch (_: Exception) {
                            if (running.get()) { /* accept loop continues */ }
                        }
                    }
                }
            } finally {
                running.set(false)
                server = null
            }
        }, "zungun-sms-companion").apply { isDaemon = true; start() }
    }

    private fun handle(socket: Socket) {
        socket.use { client ->
            client.soTimeout = 5_000
            val input = BufferedInputStream(client.getInputStream())
            val output = BufferedOutputStream(client.getOutputStream())
            try {
                val requestLine = readLine(input, 4096) ?: return
                val request = requestLine.split(' ')
                if (request.size != 3 || !request[2].startsWith("HTTP/1.")) {
                    respond(output, 400, "Bad Request", "invalid request", null); return
                }
                val method = request[0].uppercase()
                val target = request[1]
                val headers = linkedMapOf<String, String>()
                var headerBytes = 0
                while (true) {
                    val line = readLine(input, 8192) ?: throw IllegalArgumentException("SMS_COMPANION_BAD_HEADERS")
                    headerBytes += line.length
                    if (headerBytes > 16_384) throw IllegalArgumentException("SMS_COMPANION_HEADERS_TOO_LARGE")
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon <= 0) throw IllegalArgumentException("SMS_COMPANION_BAD_HEADERS")
                    headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
                }
                val origin = headers["origin"]
                if (origin != allowedOrigin) { respond(output, 403, "Forbidden", "origin denied", null); return }
                if (method == "OPTIONS") {
                    val requestedHeaders = headers["access-control-request-headers"]?.lowercase().orEmpty()
                    if (requestedHeaders.split(',').map { it.trim() }.any { it !in setOf("authorization", "content-type", "accept") }) {
                        respond(output, 403, "Forbidden", "requested headers denied", origin); return
                    }
                    respond(output, 204, "No Content", "", origin, preflight = true); return
                }
                val auth = headers["authorization"].orEmpty()
                if (!MessageDigest.isEqual(auth.toByteArray(Charsets.UTF_8), "Bearer $bearerToken".toByteArray(Charsets.UTF_8))) {
                    respond(output, 401, "Unauthorized", "companion token required", origin); return
                }
                val path = target.substringBefore('?')
                if (!((method == "GET" && path == "/inbox") || (method == "POST" && path == "/messages"))) {
                    respond(output, 404, "Not Found", "route denied", origin); return
                }
                val length = headers["content-length"]?.toIntOrNull() ?: 0
                if (length < 0 || length > 32_768 || (method == "POST" && length == 0)) {
                    respond(output, 413, "Payload Too Large", "body limit exceeded", origin); return
                }
                val body = ByteArray(length)
                var offset = 0
                while (offset < length) {
                    val count = input.read(body, offset, length - offset)
                    if (count < 0) throw IllegalArgumentException("SMS_COMPANION_BODY_TRUNCATED")
                    offset += count
                }
                proxy(method, target, body, output, origin)
            } catch (_: Exception) {
                runCatching { respond(output, 400, "Bad Request", "request failed", null) }
            }
        }
    }

    private fun proxy(method: String, target: String, body: ByteArray, output: BufferedOutputStream, origin: String) {
        val connection = (URL("http://localhost:8080$target").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 4_000
            readTimeout = 12_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Basic " + Base64.getEncoder().encodeToString("$gatewayUsername:$gatewayPassword".toByteArray(Charsets.UTF_8)))
            if (method == "POST") {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setFixedLengthStreamingMode(body.size)
            }
        }
        try {
            if (method == "POST") connection.outputStream.use { it.write(body) }
            val status = connection.responseCode
            val response = (if (status >= 400) connection.errorStream else connection.inputStream)?.use { stream ->
                val out = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                var total = 0
                while (total < MAX_RESPONSE_BYTES) {
                    val count = stream.read(buffer, 0, minOf(buffer.size, MAX_RESPONSE_BYTES - total))
                    if (count < 0) break
                    out.write(buffer, 0, count)
                    total += count
                }
                out.toByteArray()
            } ?: ByteArray(0)
            respond(output, status, reason(status), response.toString(Charsets.UTF_8), origin, contentType = connection.contentType ?: "application/json")
        } finally { connection.disconnect() }
    }

    private fun respond(
        output: BufferedOutputStream,
        status: Int,
        reason: String,
        body: String,
        origin: String?,
        preflight: Boolean = false,
        contentType: String = "application/json; charset=utf-8",
    ) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val headers = StringBuilder()
            .append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n")
            .append("Connection: close\r\n")
            .append("Cache-Control: no-store\r\n")
            .append("Content-Length: ").append(bytes.size).append("\r\n")
            .append("Content-Type: ").append(contentType).append("\r\n")
        if (origin != null) {
            headers.append("Access-Control-Allow-Origin: ").append(origin).append("\r\n")
            headers.append("Vary: Origin\r\n")
            headers.append("Access-Control-Allow-Private-Network: true\r\n")
            if (preflight) {
                headers.append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n")
                headers.append("Access-Control-Allow-Headers: authorization, content-type, accept\r\n")
                headers.append("Access-Control-Max-Age: 300\r\n")
            }
        }
        headers.append("\r\n")
        output.write(headers.toString().toByteArray(Charsets.US_ASCII))
        output.write(bytes)
        output.flush()
    }

    private fun readLine(input: BufferedInputStream, limit: Int): String? {
        val bytes = java.io.ByteArrayOutputStream()
        while (bytes.size() < limit) {
            val value = input.read()
            if (value < 0) return if (bytes.size() == 0) null else bytes.toString("UTF-8")
            if (value == 10) {
                val raw = bytes.toByteArray()
                val size = if (raw.isNotEmpty() && raw.last() == 13.toByte()) raw.size - 1 else raw.size
                return String(raw, 0, size, Charsets.UTF_8)
            }
            bytes.write(value)
        }
        throw IllegalArgumentException("SMS_COMPANION_LINE_TOO_LONG")
    }

    private fun reason(status: Int) = when (status) {
        200 -> "OK"; 201 -> "Created"; 202 -> "Accepted"; 204 -> "No Content"
        400 -> "Bad Request"; 401 -> "Unauthorized"; 403 -> "Forbidden"; 404 -> "Not Found"
        409 -> "Conflict"; 413 -> "Payload Too Large"; 429 -> "Too Many Requests"
        else -> if (status in 500..599) "Upstream Error" else "OK"
    }

    override fun close() {
        running.set(false)
        runCatching { server?.close() }
        thread?.interrupt()
        thread = null
    }

    companion object {
        const val PORT = 8787
        const val ALLOWED_ORIGIN = "https://zungun.simondalmasso44.workers.dev"
        private const val MAX_RESPONSE_BYTES = 1_048_576
    }
}
