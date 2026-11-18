package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

class DesktopLinkTransportTest {
    @Test fun `production websocket authenticates and projects catalog over literal debug loopback`() = runBlocking {
        MockWebServer().use { server ->
            server.start(loopback, 0)
            val key = ByteArray(32) { it.toByte() }
            val host = FrameReplay(key, ReplayRole.Host, announce = true)
            val pins = AtomicInteger()
            val snapshot = CountDownLatch(1)
            val hidden = CountDownLatch(1)
            server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                private var proved = false

                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"host-online"}""")
                    webSocket.send(host.seal(json("""{"type":"host-info","hostname":"Loopback Desktop"}""")).toByteString())
                    webSocket.send(host.seal(json("""{"type":"catalog","entries":[{"id":"work","title":"Example","projectName":"Local","status":"running"}]}""")).toByteString())
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (text == "ping") webSocket.send("pong")
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    val frame = host.open(bytes.toByteArray()) ?: return
                    when (frame.payload["type"].linkString()) {
                        "replay-hello" -> if (!proved) {
                            proved = true
                            webSocket.send(host.seal(json("""{"type":"replay-hello"}""")).toByteString())
                        }
                        "snapshot" -> if (frame.trusted) snapshot.countDown()
                        "presence" -> if (frame.trusted && frame.payload["visible"] == JsonPrimitive(false)) hidden.countDown()
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                }
            }))
            val link = DesktopLink(
                PairCredentials("pair-1", "a&b=+/", key, "Eaves", "http://127.0.0.1:${server.port}/relay/"),
                { pins.incrementAndGet() }, allowLoopbackHttp = true,
            )
            try {
                link.setVisible(true)
                val online = withTimeout(5_000) { link.state.first { it.phase == LinkPhase.Online } }
                assertEquals("Loopback Desktop", online.hostName)
                assertEquals(listOf("work"), online.catalog.map { it.id })
                assertEquals(1, pins.get())
                assertTrue(snapshot.await(5, TimeUnit.SECONDS))
                val upgrade = server.takeRequest(5, TimeUnit.SECONDS)!!.requestUrl!!
                assertEquals("/relay/v1/pair/pair-1", upgrade.encodedPath)
                assertEquals("guest", upgrade.queryParameter("role"))
                assertEquals("a&b=+/", upgrade.queryParameter("token"))
                link.setVisible(false)
                assertTrue(hidden.await(5, TimeUnit.SECONDS))
            } finally {
                link.close()
            }
        }
    }

    @Test fun `redirect response does not move a token bearing request to a second origin`() = runBlocking {
        MockWebServer().use { server ->
            MockWebServer().use { target ->
                server.start(loopback, 0)
                target.start(loopback, 0)
                target.enqueue(MockResponse().setResponseCode(403))
                server.enqueue(MockResponse().setResponseCode(302)
                    .addHeader("Location", "http://127.0.0.1:${target.port}/?token=opaque"))
                val link = DesktopLink(
                    PairCredentials("pair-1", "opaque", ByteArray(32), "Eaves", "http://127.0.0.1:${server.port}"),
                    {}, allowLoopbackHttp = true,
                )
                try {
                    link.setVisible(true)
                    withTimeout(5_000) { link.state.first { it.phase == LinkPhase.Offline } }
                    assertEquals(1, server.requestCount)
                    assertEquals(0, target.requestCount)
                } finally {
                    link.close()
                }
            }
        }
    }

    private companion object {
        val loopback: InetAddress = InetAddress.getByName("127.0.0.1")
        fun json(text: String) = Json.parseToJsonElement(text) as JsonObject
    }
}
