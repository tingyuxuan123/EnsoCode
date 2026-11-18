package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.PairBox
import io.github.tingyuxuan123.eaves.pair.PairEncoding
import java.net.InetAddress
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class RelayPairingClientTest {
    private val server = MockWebServer()
    private val client = RelayPairingClient(allowLoopbackHttp = true)
    // RFC 7748 Alice X25519 keypair.
    private val secret = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
    private val publicKey = hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a")
    private val pk = PairEncoding.toBase64Url(publicKey)
    private val pairId = PairEncoding.toBase64Url(MessageDigest.getInstance("SHA-256").digest(pk.toByteArray()).copyOf(16))
    private val deviceToken = PairEncoding.toBase64Url(ByteArray(24) { 42 })
    private val validBody = """{"pairId":"$pairId","state":"authorized","deviceToken":"$deviceToken"}"""

    @Before fun start() = server.start(InetAddress.getByName("127.0.0.1"), 0)
    @After fun stop() = server.shutdown()

    @Test fun `claim sends only the boxed content key and prefixes the relay endpoints`() = runBlocking {
        server.enqueue(MockResponse().setBody(validBody))
        val pair = client.claim(link(path = "/reverse/proxy/"), "Native Android")
        val claim = checkNotNull(server.takeRequest(1, TimeUnit.SECONDS))
        val body = Json.parseToJsonElement(claim.body.readUtf8()).jsonObject
        assertEquals("POST", claim.method)
        assertEquals("/reverse/proxy/v1/pair/claim", claim.path)
        assertEquals(setOf("publicKey", "boxedKey", "deviceName"), body.keys)
        assertEquals(pk, body.getValue("publicKey").jsonPrimitive.content)
        assertEquals("Native Android", body.getValue("deviceName").jsonPrimitive.content)
        val boxed = PairBox.decodeBoxedKey(body.getValue("boxedKey").jsonPrimitive.content)
        assertArrayEquals(pair.contentKey, PairBox.openBoxedContentKey(boxed, secret))
        assertEquals(pairId, pair.pairId)
        assertEquals(deviceToken, pair.deviceToken)
        assertNull(pair.replayVersion)

        server.enqueue(MockResponse().setResponseCode(401)) // An already-revoked pair is gone at the relay.
        client.revoke(pair)
        val revoke = checkNotNull(server.takeRequest(1, TimeUnit.SECONDS))
        assertEquals("DELETE", revoke.method)
        assertEquals("/reverse/proxy/v1/pair/$pairId?token=$deviceToken", revoke.path)
    }

    @Test fun `invalid QR public keys fail before any network traffic`() = runBlocking {
        for (key in listOf(ByteArray(31), ByteArray(32))) {
            val error = failure { client.claim(link(key), "Phone") }
            assertEquals(PairFailure.INVALID_LINK, error.reason)
        }
        assertEquals(0, server.requestCount)
    }

    @Test fun `a lost claim response is uncertain and must not repeat the one shot claim`() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        // This is how the real relay behaves after authorizing the first request.
        server.enqueue(MockResponse().setResponseCode(409))
        val error = failure { client.claim(link(), "Phone") }
        assertEquals("OUTCOME_UNKNOWN", error.reason.name)
        checkNotNull(server.takeRequest(1, TimeUnit.SECONDS))
        assertNull(server.takeRequest(200, TimeUnit.MILLISECONDS))
        assertEquals(1, server.requestCount)
    }

    @Test fun `redirect HTTP denial and server error never trigger a followup`() = runBlocking {
        server.enqueue(MockResponse().setResponseCode(307).addHeader("Location", "${relay()}/leak"))
        assertEquals(PairFailure.INVALID_RESPONSE, failure { client.claim(link(), "Phone") }.reason)
        server.enqueue(MockResponse().setResponseCode(409).setBody(deviceToken))
        val denied = failure { client.claim(link(), "Phone") }
        assertEquals(PairFailure.DENIED, denied.reason)
        assertFalse(denied.toString().contains(deviceToken))
        assertNull(denied.cause)
        server.enqueue(MockResponse().setResponseCode(503).addHeader("Retry-After", "0"))
        assertEquals(PairFailure.INVALID_RESPONSE, failure { client.claim(link(), "Phone") }.reason)
        assertEquals(3, server.requestCount)
    }

    @Test fun `revoke fails on a relay server error rather than silently unlinking`() = runBlocking {
        val pair = PairCredentials(pairId, deviceToken, ByteArray(32), "Phone", relay())
        server.enqueue(MockResponse().setResponseCode(500).setBody(deviceToken))
        val error = failure { client.revoke(pair) }
        assertEquals(PairFailure.INVALID_RESPONSE, error.reason)
        assertFalse(error.toString().contains(relay()))
        assertEquals(1, server.requestCount)
    }

    @Test fun `malformed wrong-room and oversized success bodies fail without retry`() = runBlocking {
        for (body in listOf(
            """{"pairId":"$pairId","state":"authorized","deviceToken":123}""",
            validBody.replace(pairId, "A".repeat(22)), validBody.replace(deviceToken, "wrong/token"),
            validBody.replace("authorized", "requested"), validBody + " ".repeat(64 * 1024)
        )) {
            server.enqueue(MockResponse().setChunkedBody(body, 100))
            val error = failure { client.claim(link(), "Phone") }
            assertEquals(PairFailure.INVALID_RESPONSE, error.reason)
            assertFalse(error.toString().contains(deviceToken))
            assertNull(error.cause)
        }
        assertEquals(5, server.requestCount)
    }

    @Test fun `cancelled claim cancels the call without retry or redacted wrapping`() = runBlocking {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        val job = launch(start = CoroutineStart.UNDISPATCHED) { client.claim(link(), "Phone") }
        withContext(Dispatchers.IO) { checkNotNull(server.takeRequest(2, TimeUnit.SECONDS)) }
        job.cancelAndJoin()
        assertTrue(job.isCancelled)
        assertEquals(1, server.requestCount)
    }

    private fun relay(path: String = "") = "http://127.0.0.1:${server.port}$path"
    private fun link(key: ByteArray = publicKey, path: String = "") =
        "enso://pair?relay=${relay(path)}&pk=${PairEncoding.toBase64Url(key)}"

    private suspend fun failure(block: suspend () -> Unit): PairException {
        try {
            block()
        } catch (error: PairException) {
            return error
        }
        fail("Expected a redacted pairing failure")
        error("unreachable")
    }

    private fun hex(text: String) = text.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
