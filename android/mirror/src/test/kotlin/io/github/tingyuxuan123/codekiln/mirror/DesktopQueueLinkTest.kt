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
class DesktopQueueLinkTest {
    @Test fun `enqueue sends once without optimistic rows and observes only a new ID with exact text`() = runTest {
        fixture { f ->
            f.ready(rows = """[{"id":"old","text":"same"}]""")
            val before = f.session!!.timeline
            f.link.queueAction("s", QueueCommand.Enqueue, text = "same")
            f.link.queueAction("s", QueueCommand.Enqueue, text = "duplicate")
            runCurrent()
            assertEquals(listOf(json("""{"type":"enqueue","sessionId":"s","text":"same"}""")), f.commands())
            assertEquals(listOf(DesktopQueuedMessage("old", "same")), f.session!!.queued)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            f.catalog("""[{"id":"old","text":"same"}]""")
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            f.catalog("""[{"id":"new","text":"same "},{"id":"old","text":"same"}]""")
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            f.catalog("""[{"id":"new","text":"same"},{"id":"old","text":"same"}]""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.queueAttempt?.phase)
            assertEquals(listOf("new", "old"), f.session!!.queued.map { it.id })
            assertEquals(before, f.session!!.timeline)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `edit preserves image flag and exact draft and cannot be confirmed by another ID or stale catalog`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            val stale = f.host.seal(catalog("""[{"id":"q","text":" exact ","hasImages":true}]"""))
            f.catalog(imageRow) // Newer catalog is the actual send baseline.
            f.link.queueAction("s", QueueCommand.Update, "q", " exact ")
            runCurrent()
            assertEquals(json("""{"type":"queue-update","sessionId":"s","messageId":"q","text":" exact "}"""), f.commands().single())
            assertEquals(listOf(DesktopQueuedMessage("q", "before", true)), f.session!!.queued)
            f.socket.binary(stale)
            runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            f.catalog("""[{"id":"q","text":"exact","hasImages":true},{"id":"other","text":" exact "}]""")
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            f.catalog("""[{"id":"q","text":" exact ","hasImages":true}]""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.queueAttempt?.phase)
            assertTrue(f.session!!.queued.single().hasImages)
            assertEquals(" exact ", f.session!!.queueAttempt?.text)
        }
    }

    @Test fun `remove send and interrupt observe disappearance not delivery and malformed or missing rows prove nothing`() = runTest {
        for (command in listOf(QueueCommand.Remove, QueueCommand.SendNow, QueueCommand.InterruptSend)) fixture { f ->
            f.ready(rows = imageRow)
            f.link.queueAction("s", command, "q")
            runCurrent()
            assertEquals(json("""{"type":"${command.wire}","sessionId":"s","messageId":"q"}"""), f.commands().single())
            assertEquals(listOf(DesktopQueuedMessage("q", "before", true)), f.session!!.queued)
            for (bad in listOf("{}", "null", "[{}]", """[{"id":"q","text":false}]""")) {
                f.catalog(bad)
                assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
                assertEquals("q", f.session!!.queued.single().id)
            }
            f.frame(json("""{"type":"catalog","entries":[]}"""))
            f.frame(json("""{"type":"catalog","entries":[{"id":"s","title":"Slim","status":"running"}]}"""))
            f.catalog("[]", id = "unrelated")
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            // Current full selected row with omitted queued is the desktop's normal empty representation.
            f.frame(json("""{"type":"catalog","entries":[{"id":"s","title":"Task","projectName":"P","status":"running"}]}"""))
            assertEquals(SessionCommandPhase.Observed, f.session!!.queueAttempt?.phase)
            assertTrue(f.session!!.queued.isEmpty())
            assertEquals("running", f.session!!.timeline.status) // Never a delivery/abort claim.
        }
    }

    @Test fun `queue actor requires current synced writable selection running-only intents and authoritative item`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow, status = "idle")
            f.link.queueAction("other", QueueCommand.Remove, "q")
            f.link.queueAction("s", QueueCommand.Remove, "missing")
            f.link.queueAction("s", QueueCommand.Enqueue, text = "not running")
            f.link.queueAction("s", QueueCommand.InterruptSend, "q") // Never downgrade to send-now.
            f.link.queueAction("s", QueueCommand.Update, "q", " ")
            f.link.queueAction("s", QueueCommand.Update, "q", "x".repeat(SESSION_TEXT_LIMIT + 1))
            f.link.queueAction("s", QueueCommand.Remove, "q", "unexpected")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.frame(readOnly)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.frame(hostInfo)
            f.catalog("null")
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.catalog(imageRow)
            f.link.queueAction("s", QueueCommand.SendNow, "q")
            runCurrent()
            assertEquals("queue-send-now", f.commands().single()["type"].linkString())
        }
    }

    @Test fun `selected subscribed catalogs may arrive before baseline but bootstrap and unrelated catalogs cannot seed it`() = runTest {
        fixture { f ->
            f.link.selectSession("s")
            f.begin()
            f.frame(catalog(imageRow)) // Authenticated only after proof, but sent before subscription.
            assertTrue(f.session!!.queued.isEmpty())
            f.prove()
            val subscribe = f.commands().single { it["type"].linkString() == "subscribe" }
            assertTrue(f.session!!.queued.isEmpty())
            f.catalog(imageRow, id = "other")
            assertTrue(f.session!!.queued.isEmpty())
            f.catalog(imageRow)
            assertEquals("q", f.session!!.queued.single().id)
            f.frame(hostInfo)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.sync(subscribe)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertEquals("queue-remove", f.commands().single()["type"].linkString())
            f.link.selectSession(null)
            runCurrent()
            assertNull(f.session)
            f.link.selectSession("s")
            runCurrent()
            assertTrue(f.session!!.queued.isEmpty())
            assertNull(f.session!!.queueAttempt)
        }
    }

    @Test fun `queued caller actions cannot cross same-session selection auth resync or item replacement`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.selectSession(null)
            f.link.selectSession("s")
            f.link.queueAction("s", QueueCommand.Remove, "q") // Captured old selected projection.
            runCurrent()
            val subscribe = f.commands().last { it["type"].linkString() == "subscribe" }
            assertTrue(f.session!!.queued.isEmpty())
            f.sync(subscribe)
            f.catalog(imageRow)
            f.socket.binary(f.host.seal(catalog("""[{"id":"q","text":"changed","hasImages":true}]""")))
            f.link.queueAction("s", QueueCommand.Update, "q", "stale edit")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.socket.text("""{"type":"host-offline"}""")
            f.socket.text("""{"type":"host-online"}""")
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertTrue(f.session!!.queued.isEmpty())
            assertFalse(f.commands().any { it["type"].linkString() == "queue-remove" })
        }
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.retrySession()
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertFalse(f.commands().any { it["type"].linkString() == "queue-remove" })
        }
    }

    @Test fun `retained queue projection observes sent attempts but rejects hidden and stale caller actions`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            f.link.setVisible(true)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertEquals(listOf("presence", "presence"), f.commands().map { it["type"].linkString() })
            f.link.queueAction("s", QueueCommand.Update, "q", "updated")
            runCurrent()
            assertEquals("queue-update", f.commands().single()["type"].linkString())
            val attempt = f.session!!.queueAttempt
            f.link.setVisible(false)
            runCurrent()
            assertEquals("presence", f.commands().single()["type"].linkString())
            assertEquals(attempt, f.session!!.queueAttempt)
            f.catalog("""[{"id":"q","text":"updated","hasImages":true}]""")
            assertEquals(attempt?.id, f.session!!.queueAttempt?.id)
            assertEquals(SessionCommandPhase.Observed, f.session!!.queueAttempt?.phase)
            f.frame(hostInfo)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals("q", f.session!!.queued.single().id)
        }
    }

    @Test fun `timeout reconnect and send failure never retry and preserve unconfirmed draft`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.queueAction("s", QueueCommand.Enqueue, text = " keep draft ")
            runCurrent()
            f.commands()
            advanceTimeBy(10_001)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.queueAttempt?.phase)
            assertEquals(" keep draft ", f.session!!.queueAttempt?.text)
            assertTrue(f.commands().isEmpty())
            f.link.queueAction("s", QueueCommand.Update, "q", "second draft")
            runCurrent()
            f.commands()
            val old = f.socket
            old.failed()
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.queueAttempt?.phase)
            assertTrue(f.session!!.queued.isEmpty())
            advanceTimeBy(1_000)
            runCurrent()
            f.begin(existing = true)
            f.prove()
            val subscribe = f.commands().single { it["type"].linkString() == "subscribe" }
            old.binary(f.host.seal(catalog("[]")))
            f.sync(subscribe)
            f.frame(hostInfo)
            f.catalog(imageRow)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.queueAttempt?.phase)
            assertEquals("second draft", f.session!!.queueAttempt?.text)
            assertTrue(f.commands().isEmpty())
            f.socket.accept = false
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNotEquals(SessionCommandPhase.Observed, f.session!!.queueAttempt?.phase)
        }
    }

    @Test fun `scope rejection matches only current queue command and fences older writable host info`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            val staleWritable = f.host.seal(hostInfo)
            f.link.queueAction("s", QueueCommand.Update, "q", " draft ")
            runCurrent()
            f.commands()
            f.frame(json("""{"type":"command-rejected","command":"queue-remove","error":"read-only"}"""))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            f.frame(json("""{"type":"command-rejected","command":"queue-update","error":"read-only"}"""))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.queueAttempt?.phase)
            f.socket.binary(staleWritable)
            runCurrent()
            assertTrue(f.state.readOnly)
            f.catalog("""[{"id":"q","text":" draft ","hasImages":true}]""")
            assertEquals(SessionCommandPhase.Rejected, f.session!!.queueAttempt?.phase)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `queue and composer writes exclude each other but abort remains independent`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.queueAction("s", QueueCommand.Enqueue, text = "queued")
            f.link.submitText("s", "steer must wait", steer = true)
            f.link.stopSession("s")
            runCurrent()
            assertEquals(listOf("enqueue", "abort"), f.commands().map { it["type"].linkString() })
            assertNull(f.session!!.textAttempt)
        }
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.submitText("s", "steering", steer = true)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            assertEquals(listOf("steer"), f.commands().map { it["type"].linkString() })
            assertNull(f.session!!.queueAttempt)
        }
    }

    @Test fun `same-session sync preserves rows but a new epoch invalidates queue evidence`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            f.commands()
            f.link.retrySession()
            runCurrent()
            advanceTimeBy(1_501)
            runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            assertEquals(listOf(DesktopQueuedMessage("q", "before", true)), f.session!!.queued)
            assertTrue(f.session!!.queueReady)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.queueAttempt?.phase)
            f.link.retrySession()
            runCurrent()
            advanceTimeBy(1_501)
            runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }, epoch = "replacement")
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.queueAttempt?.phase)
            assertFalse(f.session!!.queueReady)
            f.catalog("[]")
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.queueAttempt?.phase)
        }
    }

    @Test fun `queue readiness exposes authoritative valid empty and invalidates on unknown selection or connection`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            assertTrue(f.session!!.queueReady)
            f.catalog("null")
            assertFalse(f.session!!.queueReady)
            assertEquals("q", f.session!!.queued.single().id)
            f.catalog("[]")
            assertTrue(f.session!!.queueReady)
            f.frame(json("""{"type":"catalog","entries":[{"id":"s","title":"Slim","status":"running"}]}"""))
            assertFalse(f.session!!.queueReady)
            f.catalog(imageRow)
            f.socket.failed()
            runCurrent()
            assertFalse(f.session!!.queueReady)
            f.link.selectSession(null)
            f.link.selectSession("s")
            runCurrent()
            assertFalse(f.session!!.queueReady)
        }
    }

    @Test fun `late generic queue denial fails closed even after timeout and without a selected session`() = runTest {
        fixture { f ->
            f.ready(rows = imageRow)
            f.link.queueAction("s", QueueCommand.Remove, "q")
            runCurrent()
            f.commands()
            advanceTimeBy(10_001)
            runCurrent()
            f.frame(json("""{"type":"command-rejected","command":"queue-remove","error":"read-only"}"""))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.session!!.queueAttempt?.phase)
            f.link.selectSession(null)
            runCurrent()
            f.frame(hostInfo)
            assertFalse(f.state.readOnly)
            f.frame(json("""{"type":"command-rejected","command":"enqueue","error":"read-only"}"""))
            assertTrue(f.state.readOnly)
            assertNull(f.session)
        }
    }

    @Test fun `goal set uses only authenticated subscribed writable baseline and does not echo or retry`() = runTest {
        fixture { f ->
            f.ready(rows = "[]", status = "idle")
            assertTrue(f.session!!.goalReady)
            assertNull(f.session!!.goal)
            f.link.goalAction("other", GoalCommand.Set, null, "different session")
            f.link.goalAction("s", GoalCommand.Set, null, "\uFEFF \n")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.link.goalAction("s", GoalCommand.Set, null, "  Check regressions. \n")
            f.link.goalAction("s", GoalCommand.Set, null, "duplicate")
            runCurrent()
            assertEquals(json("""{"type":"goal-set","sessionId":"s","text":"Check regressions."}"""), f.commands().single())
            assertNull(f.session!!.goal)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            f.catalog("[]") // Same goal state is not a receipt.
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            advanceTimeBy(10_001)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `goal has no write authority with a slim catalog background or read-only connection`() = runTest {
        fixture { f ->
            f.ready(rows = "[]", status = "idle")
            f.frame(json("""{"type":"catalog","entries":[{"id":"s","title":"Slim","status":"idle"}]}"""))
            assertFalse(f.session!!.goalReady)
            f.link.goalAction("s", GoalCommand.Set, null, "unknown baseline")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.catalog("[]")
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            f.link.setVisible(true)
            f.link.goalAction("s", GoalCommand.Set, null, "stale visible authority")
            runCurrent()
            assertEquals(listOf("presence", "presence"), f.commands().map { it["type"].linkString() })
            f.frame(readOnly)
            f.link.goalAction("s", GoalCommand.Set, null, "read only")
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    private fun TestScope.fixture(block: (Fixture) -> Unit) {
        val f = Fixture(this)
        try { block(f) } finally { f.link.close(); runCurrent(); advanceTimeBy(1_001); runCurrent() }
    }

    private class Fixture(val scope: TestScope) {
        val key = ByteArray(32)
        val host = FrameReplay(key, ReplayRole.Host, announce = true)
        val sockets = mutableListOf<FakeSocket>()
        val socket get() = sockets.last()
        val link = DesktopLink(PairCredentials("pair-1", "token", key, "Eaves", "https://example.test"),
            {}, false, StandardTestDispatcher(scope.testScheduler), { scope.testScheduler.currentTime }, { 0.5 },
            { request, listener -> FakeSocket(request, listener).also(sockets::add) })
        val state get() = link.state.value
        val session get() = state.session
        fun begin(existing: Boolean = false) {
            if (!existing) link.setVisible(true)
            scope.runCurrent()
            socket.opened(); socket.text("pong"); socket.text("""{"type":"host-online"}""")
            scope.runCurrent()
            host.peerReset()
        }
        fun prove() {
            socket.sent.forEach { host.open(it) }
            socket.sent.clear()
            frame(json("""{"type":"replay-hello"}"""))
            assertEquals(LinkPhase.Online, state.phase)
        }
        fun ready(rows: String, status: String = "running") {
            link.selectSession("s"); begin(); prove()
            sync(commands().single { it["type"].linkString() == "subscribe" }, status)
            frame(hostInfo); catalog(rows)
        }
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun catalog(rows: String, id: String = "s") = frame(DesktopQueueLinkTest.catalog(rows, id))
        fun sync(command: JsonObject, status: String = "running", epoch: String = "e") {
            val requestId = (command["sync"] as JsonObject)["requestId"].linkString()
            frame(json("""{"type":"session-sync","sessionId":"s","requestId":"$requestId","cursor":{"epoch":"$epoch","seq":0},"mode":"snapshot","snapshot":{"type":"snapshot","sessions":[{"sessionId":"s","identity":{"sessionId":"s","generation":"g"},"baseIndex":0,"messages":[],"status":"$status"}]}}"""))
        }
        fun commands(): List<JsonObject> = socket.sent.mapNotNull { host.open(it)?.payload }.also { socket.sent.clear() }
    }

    private class FakeSocket(private val request: Request, private val listener: WebSocketListener) : WebSocket {
        val sent = mutableListOf<ByteArray>()
        var accept = true
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String) = accept
        override fun send(bytes: ByteString): Boolean {
            if (!accept) return false
            sent.add(bytes.toByteArray()); return true
        }
        override fun close(code: Int, reason: String?) = false
        override fun cancel() = Unit
        fun opened() = listener.onOpen(this, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(101).message("Upgrade").build())
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, value.toByteString())
        fun failed() = listener.onFailure(this, IOException(), null)
    }

    private companion object {
        const val imageRow = """[{"id":"q","text":"before","hasImages":true}]"""
        val hostInfo = json("""{"type":"host-info","hostname":"Host"}""")
        val readOnly = json("""{"type":"host-info","hostname":"Host","readOnly":true}""")
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
        fun catalog(rows: String, id: String = "s") = json("""{"type":"catalog","entries":[{"id":"$id","title":"Task","projectName":"Project","status":"running","queued":$rows}]}""")
    }
}
