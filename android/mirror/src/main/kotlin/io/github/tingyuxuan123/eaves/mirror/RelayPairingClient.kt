package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.PairBox
import io.github.tingyuxuan123.eaves.pair.PairEncoding
import java.io.IOException
import java.net.ProtocolException
import java.net.Proxy
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.EventListener
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

class RelayPairingClient(private val allowLoopbackHttp: Boolean = false) {
    private val transport = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .callTimeout(10, TimeUnit.SECONDS)
        .addNetworkInterceptor { chain ->
            val response = chain.proceed(chain.request())
            // OkHttp can retry 503 with Retry-After: 0 even with retryOnConnectionFailure(false).
            if (response.code == 503) response.newBuilder().removeHeader("Retry-After").build() else response
        }
        .build()

    suspend fun claim(link: String, deviceName: String): PairCredentials {
        currentCoroutineContext().ensureActive()
        val name = deviceName.filterNot(Char::isISOControl).trim().take(PairCredentialRecord.MAX_NAME_LENGTH)
            .trimEnd(Char::isHighSurrogate).ifEmpty { "Android" }
        val contentKey = PairBox.generateContentKey()
        try {
            val claim = prepareClaim(link, name, contentKey)
            val token = exchange(claim.request, idempotent = false) { response ->
                requireSuccess(response)
                val json = readClaim(response)
                if (json.string("state") != "authorized" || json.string("pairId") != claim.pairId) invalidResponse()
                val value = json.string("deviceToken")
                // Both relays generate 24 random bytes as unpadded base64url.
                if (value == null || value.length != 32 || !PairCredentialRecord.isRouteIdentifier(value)) invalidResponse()
                value
            }
            return PairCredentials(claim.pairId, token, contentKey, name, claim.relay.toString())
        } finally {
            contentKey.fill(0)
        }
    }

    suspend fun revoke(credentials: PairCredentials) {
        currentCoroutineContext().ensureActive()
        val request = try {
            require(PairCredentialRecord.isRouteIdentifier(credentials.pairId))
            require(PairCredentialRecord.isRouteIdentifier(credentials.deviceToken))
            val relay = PairRelayUrl.parse(credentials.relayUrl, allowLoopbackHttp)
            val url = PairRelayUrl.endpoint(relay, credentials.pairId).addQueryParameter("token", credentials.deviceToken).build()
            Request.Builder().url(url).delete().build()
        } catch (_: IllegalArgumentException) {
            throw PairException(PairFailure.STORAGE)
        }
        exchange(request, idempotent = true) { response ->
            // The TS and Go relays return 401 when these credentials can no longer join the room.
            if (response.code != 401) requireSuccess(response)
        }
    }

    private class Claim(val relay: HttpUrl, val pairId: String, val request: Request)

    private fun prepareClaim(link: String, name: String, contentKey: ByteArray): Claim {
        try {
            require(link.length <= MAX_LINK_LENGTH)
            val text = link.trim { it.isWhitespace() || it == '\uFEFF' }
            if (!text.startsWith("enso://pair?")) {
                // Shared invite parsing accepts URL origin fallback. Reject repaired or credentialed
                // origins before it can discard their ambiguous authority; QR params are not requested.
                PairRelayUrl.parse(text.substringBefore('#').substringBefore('?'), allowLoopbackHttp)
            }
            val invite = PairEncoding.parsePairUri(text)
            require(invite.publicKey.size == PairCredentialRecord.KEY_LENGTH)
            val relay = PairRelayUrl.parse(invite.relay, allowLoopbackHttp)
            // PairBox also rejects low-order public keys; do not send even a claim for such a QR.
            val box = PairBox.encodeBoxedKey(PairBox.boxContentKey(contentKey, invite.publicKey))
            val publicKey = PairEncoding.toBase64Url(invite.publicKey)
            val pairId = PairEncoding.toBase64Url(MessageDigest.getInstance("SHA-256")
                .digest(publicKey.toByteArray(Charsets.UTF_8)).copyOf(16))
            val body = buildJsonObject {
                put("publicKey", publicKey)
                put("boxedKey", box)
                put("deviceName", name)
            }.toString().toRequestBody(JSON)
            val request = Request.Builder().url(PairRelayUrl.endpoint(relay, "claim").build()).post(body).build()
            return Claim(relay, pairId, request)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw PairException(PairFailure.INVALID_LINK)
        }
    }

    private suspend fun <T> exchange(request: Request, idempotent: Boolean, consume: (Response) -> T): T {
        // Keep this operation's pool origin-local so OkHttp cannot coalesce another HTTPS host's
        // connection and internally resend on 421. Never send debug loopback through a proxy.
        val mayHaveSent = AtomicBoolean()
        val client = transport.newBuilder().connectionPool(ConnectionPool()).eventListener(object : EventListener() {
            override fun requestHeadersStart(call: Call) { mayHaveSent.set(true) }
        }).apply {
            if (!request.url.isHttps) proxy(Proxy.NO_PROXY)
        }.build()
        try {
            for (attempt in 0..1) {
                currentCoroutineContext().ensureActive()
                mayHaveSent.set(false)
                try {
                    return await(client.newCall(request), consume)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: PairException) {
                    // Response.close can add a suppressed exception to a validation failure.
                    throw PairException(error.reason)
                } catch (error: IOException) {
                    currentCoroutineContext().ensureActive()
                    // Claim is a one-shot transition at both relays. Retry only if no request
                    // headers could have been sent; a lost response cannot recover the token.
                    if (!idempotent && mayHaveSent.get()) throw PairException(PairFailure.OUTCOME_UNKNOWN)
                    if (attempt == 1 || error is SSLException || error is ProtocolException) {
                        throw PairException(PairFailure.NETWORK)
                    }
                } catch (_: Exception) {
                    currentCoroutineContext().ensureActive()
                    throw PairException(PairFailure.NETWORK)
                }
            }
            error("Pairing retry exhausted")
        } finally {
            client.connectionPool.evictAll()
        }
    }

    private suspend fun <T> await(call: Call, consume: (Response) -> T): T = suspendCancellableCoroutine { pending ->
        pending.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                pending.resumeWith(Result.failure(e))
            }

            override fun onResponse(call: Call, response: Response) {
                pending.resumeWith(runCatching { response.use(consume) })
            }
        })
    }

    private fun requireSuccess(response: Response) {
        if (!response.isSuccessful) {
            if (response.code in 400..499) throw PairException(PairFailure.DENIED)
            invalidResponse()
        }
    }

    private fun readClaim(response: Response): JsonObject {
        val body = response.body ?: invalidResponse()
        if (body.contentLength() > MAX_RESPONSE_BYTES) invalidResponse()
        val source = body.source()
        if (source.request(MAX_RESPONSE_BYTES + 1)) invalidResponse()
        val text = try {
            Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(source.readByteArray())).toString().removePrefix("\uFEFF")
        } catch (_: CharacterCodingException) {
            invalidResponse()
        }
        boundJsonDepth(text)
        return try {
            Json.parseToJsonElement(text) as? JsonObject ?: invalidResponse()
        } catch (_: SerializationException) {
            invalidResponse()
        }
    }

    private fun boundJsonDepth(text: String) {
        var depth = 0
        var inString = false
        var escaped = false
        for (char in text) {
            if (inString) {
                if (escaped) escaped = false
                else if (char == '\\') escaped = true
                else if (char == '"') inString = false
            } else when (char) {
                '"' -> inString = true
                '{', '[' -> if (++depth > 32) invalidResponse()
                '}', ']' -> if (--depth < 0) invalidResponse()
            }
        }
        if (depth != 0 || inString) invalidResponse()
    }

    private fun JsonObject.string(field: String): String? =
        (get(field) as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun invalidResponse(): Nothing = throw PairException(PairFailure.INVALID_RESPONSE)

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
        const val MAX_RESPONSE_BYTES = 16 * 1024L
        const val MAX_LINK_LENGTH = 32 * 1024
    }
}
