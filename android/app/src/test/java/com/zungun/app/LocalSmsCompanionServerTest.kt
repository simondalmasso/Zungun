package com.zungun.app

import java.net.Socket
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalSmsCompanionServerTest {
    private fun request(raw: String): String = Socket("127.0.0.1", LocalSmsCompanionServer.PORT).use { socket ->
        socket.soTimeout = 3_000
        socket.getOutputStream().write(raw.toByteArray(Charsets.US_ASCII))
        socket.getOutputStream().flush()
        socket.getInputStream().readBytes().toString(Charsets.UTF_8)
    }

    @Test fun companionRestrictsOriginAndRequiresBearerToken() {
        val token = "test-token-should-not-be-logged"
        val server = LocalSmsCompanionServer(token, "gateway-user", "gateway-password")
        server.start()
        try {
            val preflight = request(
                "OPTIONS /messages HTTP/1.1\r\n" +
                    "Host: 127.0.0.1:8787\r\n" +
                    "Origin: https://zungun.simondalmasso44.workers.dev\r\n" +
                    "Access-Control-Request-Method: POST\r\n" +
                    "Access-Control-Request-Headers: authorization,content-type\r\n\r\n"
            )
            assertTrue(preflight.startsWith("HTTP/1.1 204"))
            assertTrue(preflight.contains("Access-Control-Allow-Origin: https://zungun.simondalmasso44.workers.dev"))
            assertTrue(preflight.contains("Access-Control-Allow-Private-Network: true"))

            val noToken = request(
                "GET /inbox?type=SMS HTTP/1.1\r\n" +
                    "Host: 127.0.0.1:8787\r\n" +
                    "Origin: https://zungun.simondalmasso44.workers.dev\r\n\r\n"
            )
            assertTrue(noToken.startsWith("HTTP/1.1 401"))
            assertTrue(!noToken.contains(token))

            val wrongOrigin = request(
                "GET /inbox HTTP/1.1\r\nHost: 127.0.0.1:8787\r\n" +
                    "Origin: https://attacker.example\r\nAuthorization: Bearer $token\r\n\r\n"
            )
            assertTrue(wrongOrigin.startsWith("HTTP/1.1 403"))
            assertTrue(!wrongOrigin.contains("Access-Control-Allow-Origin: https://attacker.example"))
        } finally {
            server.close()
        }
    }
}
