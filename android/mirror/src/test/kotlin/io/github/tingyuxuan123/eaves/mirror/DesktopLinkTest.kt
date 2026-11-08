package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DesktopLinkTest {
    @Test fun `relay may deliver bootstrap catalog before host online control without losing it`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            socket.binary(host.seal(catalog("early")))
            repeat(4) { socket.binary(host.seal(json("""{"type":"projects"}"""))) }
            socket.binary(host.seal(hostInfo("Early host")))
            runCurrent()
            assertEquals(LinkPhase.AwaitingHost, f.state.phase)
            assertTrue(f.state.catalog.isEmpty())
            assertFalse(f.state.catalogReady)
            host.open(f.hostOnline(socket))
            socket.binary(host.seal(HELLO))
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(listOf("early"), f.state.catalog.map { it.id })
            assertTrue(f.state.catalogReady)
            assertEquals("Early host", f.state.hostName)
        }
    }

    @Test fun `catalog and name sent before proof stay hidden until matching challenge completes`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            val hello = f.hostOnline(socket)
            socket.binary(host.seal(catalog("a")))
            socket.binary(host.seal(hostInfo("Desktop")))
            runCurrent()
            assertEquals(LinkPhase.Authenticating, f.state.phase)
            assertEquals(emptyList<DesktopTask>(), f.state.catalog)
            assertNull(f.state.hostName)
            assertEquals(1, f.pins)
            val beforeReady = socket.drain(host)
            assertEquals(listOf("replay-hello"), beforeReady.map { it.type })

            // Desktop suppresses repeated metadata by fingerprint; no resend follows the snapshot.
            host.open(hello)
            socket.binary(host.seal(HELLO))
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(listOf("a"), f.state.catalog.map { it.id })
            assertEquals("Desktop", f.state.hostName)
            assertEquals(listOf("replay-hello", "snapshot", "presence"), socket.drain(host).map { it.type })
        }
    }

    @Test fun `catalog readiness distinguishes missing malformed and authenticated empty catalogs and resets with the host`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            host.open(f.hostOnline(socket))
            socket.binary(host.seal(HELLO))
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertFalse(f.state.catalogReady)
            socket.binary(host.seal(json("""{"type":"catalog","entries":false}""")))
            runCurrent()
            assertFalse(f.state.catalogReady)
            socket.binary(host.seal(json("""{"type":"catalog","entries":[]}""")))
            runCurrent()
            assertTrue(f.state.catalogReady)
            assertTrue(f.state.catalog.isEmpty())
            socket.text(HOST_OFFLINE)
            runCurrent()
            assertEquals(LinkPhase.AwaitingHost, f.state.phase)
            assertFalse(f.state.catalogReady)
        }
    }

    @Test fun `another prefix or a previous challenge cannot publish staged reads`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            val hello = f.hostOnline(socket)
            socket.binary(f.host().seal(hostInfo("Wrong prefix")))
            socket.binary(host.seal(catalog("previous challenge")))
            runCurrent()
            host.open(hello)
            host.peerReset() // Same sender prefix, different challenge.
            socket.binary(host.seal(HELLO))
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertNull(f.state.hostName)
            assertTrue(f.state.catalog.isEmpty())

            socket.binary(host.seal(catalog("authenticated")))
            runCurrent()
            assertEquals(listOf("authenticated"), f.state.catalog.map { it.id })
            socket.drain(host)
            socket.text(HOST_OFFLINE)
            runCurrent()
            assertEquals(LinkPhase.AwaitingHost, f.state.phase)
            assertTrue(f.state.catalog.isEmpty())
            val freshHello = f.hostOnline(socket)
            socket.binary(host.seal(catalog("old echo")))
            runCurrent()
            assertEquals(LinkPhase.Authenticating, f.state.phase)
            assertTrue(f.state.catalog.isEmpty())
            host.peerReset()
            host.open(freshHello)
            socket.binary(host.seal(catalog("fresh echo")))
            runCurrent()
            assertEquals(listOf("fresh echo"), f.state.catalog.map { it.id })
            assertEquals(1, f.pins)
        }
    }

    @Test fun `untrusted legacy malformed oversized and unknown frames leave catalog alone`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            val hello = f.hostOnline(socket)
            val legacy = FrameReplay(f.key, ReplayRole.Host)
            socket.text("{{bad")
            socket.binary(byteArrayOf(1, 2, 3))
            socket.binary(legacy.seal(catalog("legacy")))
            socket.binary(ByteArray(1_048_577))
            runCurrent()
            assertEquals(LinkPhase.Authenticating, f.state.phase)
            assertEquals(0, f.pins)
            host.open(hello)
            socket.binary(host.seal(json("""{"type":"future-command","entries":["ignored"]}""")))
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertTrue(f.state.catalog.isEmpty())
            val newest = host.seal(catalog("newest"))
            socket.binary(newest)
            socket.binary(newest)
            runCurrent()
            assertEquals(listOf("newest"), f.state.catalog.map { it.id })
        }
    }

    @Test fun `pin failure is terminal even when the first modern frame would be trusted`() = runTest {
        fixture(pin = { throw IllegalStateException("storage failed") }) { f ->
            val socket = f.open()
            val host = f.host()
            host.open(f.hostOnline(socket))
            socket.binary(host.seal(catalog("cannot publish")))
            runCurrent()
            assertEquals(1, f.pins)
            assertEquals(LinkPhase.Failed, f.state.phase)
            assertTrue(f.state.catalog.isEmpty())
            assertTrue(socket.cancelled)
            assertTrue(socket.sent.isEmpty())
            f.link.reconnect()
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(1, f.sockets.size)
        }
    }

    @Test fun `heartbeat measures pong and reconnect rejects callbacks from the dead generation`() = runTest {
        fixture { f ->
            val first = f.open()
            assertEquals(listOf("ping"), first.textSent)
            advanceTimeBy(37)
            first.text("pong")
            runCurrent()
            assertEquals(37L, f.state.rttMillis)
            advanceTimeBy(14_963)
            runCurrent()
            assertEquals(listOf("ping", "ping"), first.textSent)
            advanceTimeBy(8_000)
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertTrue(first.cancelled)
            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(2, f.sockets.size)
            assertEquals(LinkPhase.Connecting, f.state.phase)
            first.text(HOST_ONLINE)
            first.ending(1008, "revoked")
            first.failed()
            runCurrent()
            assertEquals(LinkPhase.Connecting, f.state.phase)
        }
    }

    @Test fun `foreground close sends presence only after proof and never opens while hidden`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            host.open(f.hostOnline(socket))
            socket.binary(host.seal(HELLO))
            runCurrent()
            assertEquals(JsonPrimitive(true), socket.drain(host).single { it.type == "presence" }["visible"])
            f.link.setVisible(false)
            runCurrent()
            assertEquals(LinkPhase.Inactive, f.state.phase)
            assertEquals(JsonPrimitive(false), socket.drain(host).single { it.type == "presence" }["visible"])
            assertEquals(1000, socket.closeCode)
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(1, f.sockets.size)
            assertTrue(socket.cancelled)
            val second = f.open()
            f.hostOnline(second)
            f.link.setVisible(false)
            runCurrent()
            assertTrue(second.sent.isEmpty())
        }
    }

    @Test fun `background retention keeps authenticated transport and flips actual presence without reconnect`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            host.open(f.hostOnline(socket))
            socket.binary(host.seal(HELLO))
            runCurrent()
            socket.drain(host)
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertNull(socket.closeCode)
            assertFalse(socket.cancelled)
            assertEquals(listOf(json("""{"type":"presence","visible":false}""")), socket.drain(host))
            socket.binary(host.seal(catalog("background update")))
            runCurrent()
            assertEquals(listOf("background update"), f.state.catalog.map { it.id })
            f.link.setVisible(true)
            f.link.setVisible(true)
            f.link.setBackgroundAllowed(false) // The visible UI is still an owner.
            runCurrent()
            assertEquals(listOf(json("""{"type":"presence","visible":true}""")), socket.drain(host))
            assertEquals(1, f.sockets.size)
            assertEquals(LinkPhase.Online, f.state.phase)
        }
    }

    @Test fun `background owner can start authenticate and retry while presence remains hidden`() = runTest {
        fixture { f ->
            f.link.setBackgroundAllowed(true)
            runCurrent()
            assertEquals(LinkPhase.Connecting, f.state.phase)
            val socket = f.sockets.single()
            socket.opened()
            runCurrent()
            val host = f.host()
            host.open(f.hostOnline(socket))
            socket.binary(host.seal(HELLO))
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(JsonPrimitive(false), socket.drain(host).single { it.type == "presence" }["visible"])
            socket.failed()
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(2, f.sockets.size)
            assertEquals(LinkPhase.Connecting, f.state.phase)
        }
    }

    @Test fun `hide during proof retains authentication but never publishes foreground presence`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            val hello = f.hostOnline(socket)
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            assertEquals(LinkPhase.Authenticating, f.state.phase)
            assertTrue(socket.sent.isEmpty()) // No presence before proof.
            host.open(hello)
            socket.binary(host.seal(HELLO))
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(JsonPrimitive(false), socket.drain(host).single { it.type == "presence" }["visible"])
        }
    }

    @Test fun `disabling last owner gracefully retires and late owner waits for detach`() = runTest {
        fixture { f ->
            val socket = f.open()
            val host = f.host()
            host.open(f.hostOnline(socket))
            socket.binary(host.seal(HELLO))
            runCurrent()
            socket.drain(host)
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            socket.drain(host)
            f.link.setBackgroundAllowed(false)
            runCurrent()
            assertEquals(LinkPhase.Inactive, f.state.phase)
            assertEquals(1000, socket.closeCode)
            assertFalse(socket.cancelled)
            f.link.setBackgroundAllowed(true)
            runCurrent()
            assertEquals(1, f.sockets.size)
            advanceTimeBy(1_000)
            runCurrent()
            assertTrue(socket.cancelled)
            assertEquals(2, f.sockets.size)
        }
    }

    @Test fun `retained retry survives hiding but losing the last owner cancels it`() = runTest {
        fixture { f ->
            val socket = f.open()
            socket.failed()
            runCurrent()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(2, f.sockets.size)
            f.sockets.last().failed()
            runCurrent()
            f.link.setBackgroundAllowed(false)
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(LinkPhase.Inactive, f.state.phase)
            assertEquals(2, f.sockets.size)
        }
    }

    @Test fun `background toggles do not auto take over replaced revoked or disposed links`() = runTest {
        fixture { f ->
            val socket = f.open()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            socket.ending(1000, "replaced")
            runCurrent()
            f.link.setBackgroundAllowed(false)
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(true)
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(LinkPhase.Replaced, f.state.phase)
            assertEquals(1, f.sockets.size)
            f.link.setVisible(false)
            f.link.reconnect() // Only explicit takeover may reacquire, including while retained.
            runCurrent()
            assertEquals(2, f.sockets.size)
            f.sockets.last().ending(1008, "revoked")
            runCurrent()
            f.link.setBackgroundAllowed(false)
            f.link.setBackgroundAllowed(true)
            f.link.reconnect()
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(LinkPhase.Revoked, f.state.phase)
            assertEquals(2, f.sockets.size)
        }
        fixture { f ->
            val socket = f.open()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            f.link.close()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(true)
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(LinkPhase.Inactive, f.state.phase)
            assertTrue(socket.cancelled)
            assertEquals(1, f.sockets.size)
        }
    }

    @Test fun `replacement pauses automatic reacquisition and revocation never reconnects`() = runTest {
        fixture { f ->
            val socket = f.open()
            socket.ending(1000, "replaced")
            runCurrent()
            assertEquals(LinkPhase.Replaced, f.state.phase)
            f.link.setVisible(false)
            f.link.setVisible(true)
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(1, f.sockets.size)
            f.link.reconnect()
            runCurrent()
            assertEquals(2, f.sockets.size)
            val resumed = f.sockets.last()
            resumed.opened()
            resumed.ending(1008, "revoked")
            runCurrent()
            assertEquals(LinkPhase.Revoked, f.state.phase)
            f.link.reconnect()
            advanceTimeBy(60_000)
            runCurrent()
            assertEquals(2, f.sockets.size)
        }
    }

    @Test fun `relay text revocation also terminates during graceful background shutdown`() = runTest {
        fixture { f ->
            val socket = f.open()
            f.link.setVisible(false)
            runCurrent()
            socket.text("""{"type":"revoked"}""")
            runCurrent()
            assertEquals(LinkPhase.Revoked, f.state.phase)
            f.link.setVisible(true)
            runCurrent()
            assertEquals(1, f.sockets.size)
        }
    }

    @Test fun `revocation observed on the socket wins over a reconnect queued just before it`() = runTest {
        fixture { f ->
            val socket = f.open()
            f.link.reconnect()
            socket.ending(1008, "revoked")
            runCurrent()
            assertEquals(LinkPhase.Revoked, f.state.phase)
            assertEquals(1, f.sockets.size)
        }
    }

    @Test fun `connect timeout and silent proof timeout enter bounded retry`() = runTest {
        fixture { f ->
            f.link.setVisible(true)
            runCurrent()
            val neverOpened = f.sockets.single()
            advanceTimeBy(8_000)
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertTrue(neverOpened.cancelled)
            advanceTimeBy(1_000)
            runCurrent()
            val silentHost = f.sockets.last()
            silentHost.opened()
            silentHost.text("pong")
            runCurrent()
            f.hostOnline(silentHost)
            advanceTimeBy(12_000)
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertTrue(silentHost.cancelled)
            advanceTimeBy(1_999)
            runCurrent()
            assertEquals(2, f.sockets.size)
            advanceTimeBy(1)
            runCurrent()
            assertEquals(3, f.sockets.size)
        }
    }

    @Test fun `replay window exhaustion clears staged reads and fails closed`() = runTest {
        fixture { f ->
            val socket = f.open()
            f.hostOnline(socket)
            repeat(129) {
                socket.binary(f.host().seal(catalog("candidate $it")))
                runCurrent()
            }
            assertEquals(LinkPhase.Failed, f.state.phase)
            assertTrue(f.state.catalog.isEmpty())
            assertTrue(socket.cancelled)
            f.link.reconnect()
            runCurrent()
            assertEquals(1, f.sockets.size)
        }
    }

    private fun TestScope.fixture(pin: () -> Unit = {}, block: (Fixture) -> Unit) {
        val fixture = Fixture(this, pin)
        try { block(fixture) }
        finally {
            fixture.link.close()
            runCurrent()
            advanceTimeBy(1_001)
            runCurrent()
        }
    }

    private class Fixture(private val scope: TestScope, pin: () -> Unit) {
        val key = ByteArray(32) { (it + 7).toByte() }
        var pins = 0
        val sockets = mutableListOf<FakeSocket>()
        val link = DesktopLink(
            PairCredentials("pair-1", "opaque", key, "Eaves", "https://example.test"),
            { pins++; pin() }, false, StandardTestDispatcher(scope.testScheduler),
            { scope.testScheduler.currentTime }, { 0.5 },
            { request, listener -> FakeSocket(request, listener).also(sockets::add) },
        )
        val state get() = link.state.value
        fun host() = FrameReplay(key, ReplayRole.Host, announce = true)
        fun open(): FakeSocket {
            link.setVisible(true)
            scope.runCurrent()
            val socket = sockets.last()
            socket.opened()
            scope.runCurrent()
            assertEquals(LinkPhase.AwaitingHost, state.phase)
            return socket
        }
        fun hostOnline(socket: FakeSocket): ByteArray {
            socket.text(HOST_ONLINE)
            scope.runCurrent()
            assertEquals(LinkPhase.Authenticating, state.phase)
            return socket.sent.removeAt(0)
        }
    }

    private class FakeSocket(private val request: Request, private val listener: WebSocketListener) : WebSocket {
        val sent = mutableListOf<ByteArray>()
        val textSent = mutableListOf<String>()
        var cancelled = false
        var closeCode: Int? = null
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String) = textSent.add(text)
        override fun send(bytes: ByteString) = sent.add(bytes.toByteArray())
        override fun close(code: Int, reason: String?): Boolean { closeCode = code; return true }
        override fun cancel() { cancelled = true }

        fun opened() = listener.onOpen(this, Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
            .code(101).message("Switching Protocols").build())
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, value.toByteString())
        fun ending(code: Int, reason: String) = listener.onClosing(this, code, reason)
        fun failed() = listener.onFailure(this, IOException(), null)
        fun drain(host: FrameReplay) = sent.map { host.open(it)!!.payload }.also { sent.clear() }
    }

    private companion object {
        const val HOST_ONLINE = """{"type":"host-online"}"""
        const val HOST_OFFLINE = """{"type":"host-offline"}"""
        val HELLO = json("""{"type":"replay-hello"}""")
        val JsonObject.type get() = get("type").linkString()
        fun json(text: String) = Json.parseToJsonElement(text) as JsonObject
        fun catalog(id: String) = json("""{"type":"catalog","entries":[{"id":"$id","title":"Task","projectName":"Project","status":"idle"}]}""")
        fun hostInfo(host: String) = json("""{"type":"host-info","hostname":"$host"}""")
    }
}
