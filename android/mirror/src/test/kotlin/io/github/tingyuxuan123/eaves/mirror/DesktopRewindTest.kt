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
class DesktopRewindTest {
    @Test fun `rewind sends the exact command and only names restoreFiles when true`() = runTest {
        fixture { f ->
            f.ready()
            assertEquals(RewindBaseline("e", null), f.session!!.rewindBaseline)
            f.link.rewind("s", 1, false, f.session!!.rewindBaseline!!)
            runCurrent()
            assertEquals(listOf("""{"type":"rewind","sessionId":"s","userIndexFromEnd":1}"""), f.sent())
            assertEquals(1L, f.session!!.rewind?.id)
            assertEquals(1L, f.session!!.rewind?.userIndexFromEnd)
            assertEquals(false, f.session!!.rewind?.restoreFiles)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.editorText)
            assertEquals(0, f.session!!.rewind?.editorImageCount)
            assertNull(f.session!!.rewind?.filesRestored)
            assertEquals(RewindBaseline("e", 1L), f.session!!.rewindBaseline)
        }
        fixture { f ->
            f.ready()
            f.link.rewind("s", 0, true, f.session!!.rewindBaseline!!)
            runCurrent()
            assertEquals(listOf("""{"type":"rewind","sessionId":"s","userIndexFromEnd":0,"restoreFiles":true}"""),
                f.sent())
            assertEquals(true, f.session!!.rewind?.restoreFiles)
        }
    }

    @Test fun `rewind refuses running unsynced hidden read-only unselected and unusable input`() = runTest {
        fixture { f ->
            f.ready(status = "running")
            f.link.rewind("s", 0, true, f.session!!.rewindBaseline!!)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.rewind)
        }
        // The desktop re-orders history for a running turn, so this cannot even be attempted.
        fixture { f ->
            f.ready()
            for (index in listOf(-1L, 9_007_199_254_740_992L, Long.MAX_VALUE)) {
                f.link.rewind("s", index, false, f.session!!.rewindBaseline!!)
                runCurrent()
                assertTrue("index: $index", f.commands().isEmpty())
                assertNull(f.session!!.rewind)
            }
        }
        fixture { f ->
            f.ready()
            f.link.rewind("other", 0, false, f.session!!.rewindBaseline!!)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.rewind)
        }
        fixture { f ->
            f.ready()
            f.frame(json("""{"type":"host-info","hostname":"Host","readOnly":true}"""))
            f.link.rewind("s", 0, false, RewindBaseline("e", null))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.rewind)
        }
        fixture { f ->
            f.link.selectSession("s"); f.begin(); f.prove()
            val subscribe = f.commands().single { it["type"].linkString() == "subscribe" }
            assertNull(f.session!!.rewindBaseline)
            f.link.rewind("s", 0, false, RewindBaseline("e", null))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.rewind)
            f.sync(subscribe)
            assertEquals(RewindBaseline("e", null), f.session!!.rewindBaseline)
            f.frame(hostInfo)
            f.rewind(0, false)
            runCurrent()
            assertEquals(listOf("""{"type":"rewind","sessionId":"s","userIndexFromEnd":0}"""), f.sent())
        }
    }

    @Test fun `stale epoch or stale attempt id baseline can never resend`() = runTest {
        fixture { f ->
            f.ready()
            f.link.rewind("s", 0, true, RewindBaseline("other", null))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.rewind)
        }
        // ABA: the screen still shows the pre-attempt baseline after the attempt became unconfirmed.
        fixture { f ->
            f.ready()
            val stale = f.session!!.rewindBaseline!!
            f.rewind(1, false)
            runCurrent(); f.commands()
            advanceTimeBy(15_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            f.link.rewind("s", 2, false, stale)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals(1L, f.session!!.rewind?.id)
            f.link.rewind("s", 2, false, f.session!!.rewindBaseline!!)
            runCurrent()
            assertEquals(listOf("""{"type":"rewind","sessionId":"s","userIndexFromEnd":2}"""), f.sent())
            assertEquals(2L, f.session!!.rewind?.id)
        }
    }

    @Test fun `rewind is one shot and settles on the matching rewind-done receipt`() = runTest {
        fixture { f ->
            f.ready()
            f.rewind(1, true)
            runCurrent(); f.commands()
            f.rewind(0, false)
            f.link.submitText("s", "hello", false)
            f.link.goalAction("s", GoalCommand.Set, null, "ship")
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
            assertNull(f.session!!.goalAttempt)
            assertNull(f.session!!.maintenance)
            assertEquals(1L, f.session!!.rewind?.id)
            f.rewindDone(1, """"editorText":"resend"""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertEquals("resend", f.session!!.rewind?.editorText)
            assertEquals(0, f.session!!.rewind?.editorImageCount)
            assertEquals(1L, f.session!!.rewind?.id)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `rewind-done is observed with and without an epoch change`() = runTest {
        for (epoch in listOf("e", "replacement")) fixture { f ->
            f.ready()
            f.rewind(2, false)
            runCurrent(); f.commands()
            f.rewindDone(1, """"editorText":"again"""", epoch = epoch)
            assertEquals("epoch: $epoch", SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertEquals("again", f.session!!.rewind?.editorText)
        }
        fixture { f ->
            f.ready()
            // A receipt from a frame older than the write, or from another connection, proves nothing.
            val older = f.host.seal(f.rewindDoneFrame(1, """"editorText":"older""""))
            f.catalog()
            f.rewind(0, false)
            runCurrent(); f.commands()
            f.socket.binary(older); runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.editorText)
        }
    }

    @Test fun `editor payload is bounded and images are only counted`() = runTest {
        fixture { f ->
            f.ready(); f.rewind(0, true); runCurrent(); f.commands()
            f.rewindDone(1, """"editorText":${JsonPrimitive("x".repeat(SESSION_TEXT_LIMIT + 1))}""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.editorText)
        }
        fixture { f ->
            f.ready(); f.rewind(0, true); runCurrent(); f.commands()
            f.rewindDone(1, """"editorText":5""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.editorText)
        }
        fixture { f ->
            f.ready(); f.rewind(0, true); runCurrent(); f.commands()
            f.rewindDone(1, """"editorText":${JsonPrimitive("y".repeat(SESSION_TEXT_LIMIT))}""")
            assertEquals(SESSION_TEXT_LIMIT, f.session!!.rewind?.editorText?.length)
        }
        fixture { f ->
            f.ready(); f.rewind(0, true); runCurrent(); f.commands()
            f.rewindDone(1, """"editorImages":[{"data":"AAAA","mimeType":"image/png"},
                {"data":"BBBB","mimeType":"image/jpeg"}]""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.editorText)
            assertEquals(2, f.session!!.rewind?.editorImageCount)
        }
    }

    @Test fun `filesRestored follows the draft without changing the observed phase`() = runTest {
        fixture { f ->
            f.ready(); f.rewind(1, true); runCurrent(); f.commands()
            f.rewindDone(1, """"editorText":"back"""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.filesRestored)
            f.rewindDone(2, """"filesRestored":true""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertEquals(true, f.session!!.rewind?.filesRestored)
            assertEquals("back", f.session!!.rewind?.editorText)
            assertEquals(1L, f.session!!.rewind?.id)
        }
        // A cancelled navigation reports the restore receipt instead of a draft.
        fixture { f ->
            f.ready(); f.rewind(1, true); runCurrent(); f.commands()
            f.rewindDone(1, """"filesRestored":false""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.rewind?.phase)
            assertEquals(false, f.session!!.rewind?.filesRestored)
        }
    }

    @Test fun `messages-truncated is never a rewind receipt`() = runTest {
        fixture { f ->
            f.ready(); f.rewind(1, false); runCurrent(); f.commands()
            f.event("messages-truncated", 1, """"length":0""")
            assertEquals(SessionCommandPhase.Waiting, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.editorText)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `rewind timeout keeps the attempt unconfirmed and never replays it`() = runTest {
        fixture { f ->
            f.ready(); f.rewind(1, false); runCurrent(); f.commands()
            advanceTimeBy(14_000); runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.session!!.rewind?.phase)
            advanceTimeBy(1_100); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            assertEquals(1L, f.session!!.rewind?.id)
            f.rewindDone(1, """"editorText":"late"""")
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            assertNull(f.session!!.rewind?.editorText)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `local send failure leaves an unconfirmed attempt instead of an echo`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.accept = false
            f.rewind(1, false)
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            assertEquals(1L, f.session!!.rewind?.id)
            assertEquals(1L, f.session!!.rewind?.userIndexFromEnd)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `rewind scope denial fails closed and rejects the matching attempt even after timeout`() = runTest {
        fixture { f ->
            f.ready(); f.rewind(0, true); runCurrent(); f.commands()
            f.frame(denial("rewind"))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.session!!.rewind?.phase)
            assertTrue(f.commands().isEmpty())
        }
        // A denial for another command fences the scope but cannot settle this attempt.
        fixture { f ->
            f.ready(); f.rewind(0, true); runCurrent(); f.commands()
            f.frame(denial("compact"))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.rewind?.phase)
            advanceTimeBy(15_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            // A late denial still names the attempt that was sent, never a newer one.
            f.frame(denial("rewind"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.rewind?.phase)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            val older = f.host.seal(denial("rewind"))
            f.catalog()
            f.rewind(0, true)
            runCurrent(); f.commands()
            f.socket.binary(older); runCurrent()
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.rewind?.phase)
            f.frame(denial("rewind"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.rewind?.phase)
        }
    }

    @Test fun `rewind and other waiting writes exclude each other while abort and goal pause stay free`() = runTest {
        fixture { f ->
            f.ready(goal = goal("ship", "active"))
            f.rewind(1, false)
            runCurrent(); f.commands()
            f.event("status", 1, """"status":"running"""")
            assertTrue(f.session!!.running)
            f.link.submitText("s", "steer", true)
            f.link.queueAction("s", QueueCommand.Enqueue, text = "queued")
            f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "next")
            f.maintain(SessionMaintenanceCommand.Compact)
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
            assertNull(f.session!!.queueAttempt)
            assertNull(f.session!!.goalAttempt)
            assertNull(f.session!!.maintenance)
            f.link.stopSession("s")
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent()
            assertEquals(listOf("abort", "goal-pause"), f.commands().map { it["type"].linkString() })
        }
        for (waiting in listOf("text", "queue", "goal", "maintenance")) fixture { f ->
            f.ready(status = if (waiting == "queue") "running" else "idle", goal = goal("ship", "active"))
            when (waiting) {
                "text" -> f.link.submitText("s", "hello", false)
                "queue" -> f.link.queueAction("s", QueueCommand.Enqueue, text = "queued")
                "goal" -> f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "next")
                else -> f.maintain(SessionMaintenanceCommand.Compact)
            }
            runCurrent(); f.commands()
            f.rewind(1, false)
            runCurrent()
            assertTrue("rewind while $waiting waits", f.commands().isEmpty())
            assertNull(f.session!!.rewind)
        }
    }

    @Test fun `background read-only disconnect session switch and resync retire the attempt without replay`() = runTest {
        fixture { f ->
            f.ready(); f.rewind(1, false); runCurrent(); f.commands()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            f.commands()
            f.link.rewind("s", 0, false, f.session!!.rewindBaseline!!)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals(1L, f.session!!.rewind?.id)
        }
        fixture { f ->
            f.ready(); f.rewind(1, false); runCurrent(); f.commands()
            f.frame(json("""{"type":"host-info","hostname":"Host","readOnly":true}"""))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready(); f.rewind(1, false); runCurrent(); f.commands()
            f.socket.failed(); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            advanceTimeBy(1_000); runCurrent()
            f.begin(existing = true); f.prove()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            f.frame(hostInfo)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready(); f.rewind(1, false); runCurrent(); f.commands()
            f.link.selectSession(null); runCurrent()
            assertNull(f.session)
            assertTrue(f.commands().none { it["type"].linkString() == "rewind" })
        }
        fixture { f ->
            f.ready(); f.rewind(1, false); runCurrent(); f.commands()
            f.link.retrySession(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.rewind?.phase)
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
            scope.runCurrent(); host.peerReset()
        }
        fun prove() {
            socket.sent.forEach { host.open(it) }; socket.sent.clear()
            frame(json("""{"type":"replay-hello"}"""))
            assertEquals(LinkPhase.Online, state.phase)
        }
        fun ready(status: String = "idle", goal: String? = null) {
            link.selectSession("s"); begin(); prove()
            sync(commands().single { it["type"].linkString() == "subscribe" }, status)
            frame(hostInfo); catalog(goal)
        }
        fun rewind(userIndexFromEnd: Long, restoreFiles: Boolean) =
            link.rewind("s", userIndexFromEnd, restoreFiles, session!!.rewindBaseline!!)
        fun maintain(command: SessionMaintenanceCommand) =
            link.maintain("s", command, session!!.maintenanceBaseline!!)
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun catalog(goal: String? = null) = entries("[${row(goal)}]")
        fun entries(entries: String) = frame(json("""{"type":"catalog","entries":$entries}"""))
        fun row(goal: String? = null): String =
            """{"id":"s","title":"Task","projectName":"Project","status":"idle"""" +
                (goal?.let { ""","goal":$it""" } ?: "") + "}"
        fun rewindDoneFrame(seq: Int, fields: String, epoch: String = "e") = json(
            """{"type":"agent-event","cursor":{"epoch":"$epoch","seq":$seq},"event":{"type":"rewind-done",
                "sessionId":"s","identity":{"sessionId":"s","generation":"g"},$fields}}""")
        fun rewindDone(seq: Int, fields: String, epoch: String = "e") = frame(rewindDoneFrame(seq, fields, epoch))
        fun event(type: String, seq: Int, fields: String) = frame(json(
            """{"type":"agent-event","cursor":{"epoch":"e","seq":$seq},"event":{"type":"$type",
                "sessionId":"s","identity":{"sessionId":"s","generation":"g"},$fields}}"""))
        fun sync(command: JsonObject, status: String = "idle", epoch: String = "e") {
            val requestId = (command["sync"] as JsonObject)["requestId"].linkString()
            frame(json("""{"type":"session-sync","sessionId":"s","requestId":"$requestId","cursor":{"epoch":"$epoch","seq":0},"mode":"snapshot","snapshot":{"type":"snapshot","sessions":[{"sessionId":"s","identity":{"sessionId":"s","generation":"g"},"baseIndex":0,"messages":[],"status":"$status"}]}}"""))
        }
        fun commands(): List<JsonObject> = socket.sent.mapNotNull { host.open(it)?.payload }.also { socket.sent.clear() }
        fun sent(): List<String> = socket.sent.mapNotNull { host.open(it)?.payload?.toString() }.also { socket.sent.clear() }
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
        val hostInfo = json("""{"type":"host-info","hostname":"Host"}""")
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
        fun goal(text: String = "ship", status: String = "active"): String =
            """{"text":${JsonPrimitive(text)},"status":"$status","autoTurns":0}"""
        fun denial(command: String) = json("""{"type":"command-rejected","command":"$command","error":"read-only"}""")
    }
}
