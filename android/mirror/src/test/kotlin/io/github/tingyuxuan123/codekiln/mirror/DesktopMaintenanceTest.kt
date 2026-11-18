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
class DesktopMaintenanceTest {
    @Test fun `context and usage project only exact validated rows`() = runTest {
        fixture { f ->
            f.ready(context = """{"used":50,"window":200}""",
                usage = """{"inputTokens":100,"outputTokens":20,"cacheHitPercent":63}""")
            assertEquals(DesktopContextUsage(50, 200), f.session!!.context)
            assertEquals(DesktopUsageTotals(100, 20, 63), f.session!!.usage)
            f.catalog(context = """{"used":7}""", usage = """{"inputTokens":0,"outputTokens":0}""")
            assertEquals(DesktopContextUsage(7), f.session!!.context)
            assertEquals(DesktopUsageTotals(0, 0), f.session!!.usage)
            // A subscribed full row without the key proves the desktop has no such data.
            f.catalog()
            assertNull(f.session!!.context)
            assertNull(f.session!!.usage)
            f.catalog(context = """{"used":50,"window":200}""", usage = """{"inputTokens":100,"outputTokens":20}""")
            assertEquals(DesktopContextUsage(50, 200), f.session!!.context)
            for (bad in listOf("""{"used":-1}""", """{"used":1.5}""", """{"used":"5"}""",
                """{"used":9007199254740992}""", """{"used":1,"window":0}""", """{"used":1,"window":-5}""",
                """{"used":1,"window":1.5}""", """{"used":1,"window":"200"}""", """{"used":1,"window":null}""",
                """{"window":200}""", "null", "[]", "5", "true")) {
                f.catalog(context = bad)
                assertNull("invalid context: $bad", f.session!!.context)
                f.catalog(context = """{"used":50,"window":200}""")
                assertEquals(DesktopContextUsage(50, 200), f.session!!.context)
            }
            for (bad in listOf("""{"inputTokens":-1,"outputTokens":20}""", """{"outputTokens":20}""",
                """{"inputTokens":1.5,"outputTokens":20}""", """{"inputTokens":"1","outputTokens":20}""",
                """{"inputTokens":1,"outputTokens":9007199254740992}""", "null", "[]", "false")) {
                f.catalog(usage = bad)
                assertNull("invalid usage: $bad", f.session!!.usage)
                f.catalog(usage = """{"inputTokens":100,"outputTokens":20}""")
                assertEquals(DesktopUsageTotals(100, 20), f.session!!.usage)
            }
            // A dirty cache share only drops itself; the token totals stay usable.
            for (cache in listOf("101", "-1", "50.5", "\"63\"", "null")) {
                f.catalog(usage = """{"inputTokens":100,"outputTokens":20,"cacheHitPercent":$cache}""")
                assertEquals("cache: $cache", DesktopUsageTotals(100, 20), f.session!!.usage)
            }
        }
    }

    @Test fun `slim malformed duplicate and archived rows are not usage evidence`() = runTest {
        fixture { f ->
            f.ready(context = """{"used":50,"window":200}""", usage = """{"inputTokens":100,"outputTokens":20}""")
            val context = DesktopContextUsage(50, 200)
            val usage = DesktopUsageTotals(100, 20)
            for (entries in listOf("""[{"id":"s","title":"Slim","status":"idle"}]""",
                """[null,{}]""",
                """[${f.row(context = """{"used":1}""")},${f.row(context = """{"used":2}""")}]""",
                """[${f.row(context = """{"used":1}""", usage = """{"inputTokens":1,"outputTokens":1}""",
                    archived = true)}]""",
                """[{"id":"s","title":"Bad","projectName":"Project","status":"idle","context":{"used":1},"usageTotals":{"inputTokens":1,"outputTokens":1}},
                    {"id":"s","title":"Bad","projectName":"Project","status":"idle","context":{"used":2},"usageTotals":{"inputTokens":2,"outputTokens":2}}]""")) {
                f.entries(entries)
                assertEquals("context: $entries", context, f.session!!.context)
                assertEquals("usage: $entries", usage, f.session!!.usage)
            }
            // The archived row is still a chat-bearing catalog row, so it may not shadow the drawer either.
            assertEquals(listOf("s"), f.state.catalog.map { it.id })
            f.catalog(context = """{"used":9}""")
            assertEquals(DesktopContextUsage(9), f.session!!.context)
            // The same row carries no totals, which is the desktop proving it has nothing to show.
            assertNull(f.session!!.usage)
        }
    }

    @Test fun `retry is one shot when idle and settles only on a later cursor in the same epoch`() = runTest {
        for (confirm in listOf("status", "turn-retry")) fixture { f ->
            f.ready()
            assertEquals(MaintenanceBaseline("e", null, null), f.session!!.maintenanceBaseline)
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertEquals(listOf(json("""{"type":"retry","sessionId":"s"}""")), f.commands())
            assertEquals(SessionMaintenanceCommand.Retry, f.session!!.maintenance?.command)
            assertNull(f.session!!.maintenance?.text)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.maintenance?.phase)
            // A waiting attempt owns the channel; a second tap can never resend it.
            f.maintain(SessionMaintenanceCommand.Retry)
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals(1L, f.session!!.maintenance?.id)
            if (confirm == "status") f.event("status", 1, """"status":"running"""")
            else f.event("turn-retry", 1, """"attempt":1,"maxAttempts":3""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.maintenance?.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `retry refuses running sessions and times out unconfirmed without replay`() = runTest {
        fixture { f ->
            f.ready(status = "running")
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.maintenance)
        }
        // A failed turn is exactly why retry exists; it must still be one shot and never replayed.
        for (status in listOf("failed", "error")) fixture { f ->
            f.ready(status = status)
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertEquals(listOf(json("""{"type":"retry","sessionId":"s"}""")), f.commands())
            assertEquals(SessionCommandPhase.Waiting, f.session!!.maintenance?.phase)
        }
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent(); f.commands()
            f.event("status", 1, """"status":"running"""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.maintenance?.phase)
        }
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent(); f.commands()
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.maintenance?.phase)
            f.event("status", 1, """"status":"running"""")
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.maintenance?.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `compact instructions are JS trimmed bounded and never silently dropped`() = runTest {
        for ((text, expected) in listOf(null to null, "  summarize \n" to "summarize",
            "x".repeat(8_000) to "x".repeat(8_000))) fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Compact, text)
            runCurrent()
            assertEquals(expected, f.session!!.maintenance?.text)
            assertEquals(listOf(if (expected == null) json("""{"type":"compact","sessionId":"s"}""")
            else json("""{"type":"compact","sessionId":"s","instructions":${JsonPrimitive(expected)}}""")), f.commands())
        }
        fixture { f ->
            f.ready()
            for (text in listOf("", " ", "\uFEFF\u00A0", "\n\t ", "x".repeat(8_001))) {
                f.maintain(SessionMaintenanceCommand.Compact, text)
                runCurrent()
                assertTrue("instructions: ${text.length}", f.commands().isEmpty())
                assertNull(f.session!!.maintenance)
            }
            // A retry takes no instructions at all.
            f.maintain(SessionMaintenanceCommand.Retry, "unexpected")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.maintenance)
        }
    }

    @Test fun `compact runs while busy and projects queued start end error and abandoned`() = runTest {
        fixture { f ->
            f.ready(status = "running")
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent()
            assertEquals(listOf(json("""{"type":"compact","sessionId":"s"}""")), f.commands())
            assertEquals(SessionCommandPhase.Waiting, f.session!!.maintenance?.phase)
            assertNull(f.session!!.compaction)
            f.event("compaction", 1, """"state":"queued"""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.maintenance?.phase)
            assertEquals(DesktopCompaction("queued"), f.session!!.compaction)
            f.event("compaction", 2, """"state":"start"""")
            assertEquals(DesktopCompaction("start"), f.session!!.compaction)
            assertEquals(SessionCommandPhase.Observed, f.session!!.maintenance?.phase)
            f.event("compaction", 3, """"state":"end"""")
            assertEquals(DesktopCompaction("end"), f.session!!.compaction)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Compact, "  summarize ")
            runCurrent(); f.commands()
            f.event("compaction", 1, """"state":"end","error":"Nothing to compact"""")
            assertEquals(SessionCommandPhase.Rejected, f.session!!.maintenance?.phase)
            assertEquals(DesktopCompaction("end", "Nothing to compact"), f.session!!.compaction)
        }
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent(); f.commands()
            f.event("compaction", 1, """"state":"queued"""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.maintenance?.phase)
            // Abandoning the queue is an observation, not a failure and not a completion.
            f.event("compaction", 2, """"state":"end","abandoned":true""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.maintenance?.phase)
            assertNull(f.session!!.compaction)
        }
        fixture { f ->
            f.ready()
            // Compaction progress from the desktop itself needs no phone attempt.
            f.event("compaction", 1, """"state":"start"""")
            assertEquals(DesktopCompaction("start"), f.session!!.compaction)
            assertNull(f.session!!.maintenance)
        }
    }

    @Test fun `maintenance needs a foreground writable synced selected session`() = runTest {
        fixture { f ->
            f.ready()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent(); f.commands()
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.maintenance)
        }
        fixture { f ->
            f.ready()
            f.frame(json("""{"type":"host-info","hostname":"Host","readOnly":true}"""))
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.link.maintain("other", SessionMaintenanceCommand.Retry,
                MaintenanceBaseline("e", null, null))
            f.link.retrySession()
            runCurrent(); f.commands()
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.maintenance)
        }
        fixture { f ->
            f.link.selectSession("s"); f.begin(); f.prove()
            val subscribe = f.commands().single { it["type"].linkString() == "subscribe" }
            assertNull(f.session!!.maintenanceBaseline)
            f.link.maintain("s", SessionMaintenanceCommand.Retry, MaintenanceBaseline("e", null, null))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.sync(subscribe)
            assertEquals(MaintenanceBaseline("e", null, null), f.session!!.maintenanceBaseline)
            f.frame(hostInfo)
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertEquals(listOf(json("""{"type":"retry","sessionId":"s"}""")), f.commands())
        }
    }

    @Test fun `maintain rejects a baseline that no longer matches the actor state`() = runTest {
        fixture { f ->
            f.ready()
            val stale = f.session!!.maintenanceBaseline!!
            f.event("compaction", 1, """"state":"start"""")
            f.link.maintain("s", SessionMaintenanceCommand.Compact, stale)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.maintenance)
            f.link.maintain("s", SessionMaintenanceCommand.Compact, f.session!!.maintenanceBaseline!!)
            runCurrent()
            assertEquals("compact", f.commands().single()["type"].linkString())
            val attemptId = f.session!!.maintenance?.id
            assertNotNull(attemptId)
            // The attempt id belongs to the baseline, so an older one can never match again.
            f.link.maintain("s", SessionMaintenanceCommand.Compact,
                MaintenanceBaseline("e", null, f.session!!.compaction))
            f.link.maintain("s", SessionMaintenanceCommand.Compact,
                MaintenanceBaseline("other", attemptId, f.session!!.compaction))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals(attemptId, f.session!!.maintenance?.id)
        }
    }

    @Test fun `maintenance and work starting writes exclude each other in both directions`() = runTest {
        fixture { f ->
            f.ready(goal = goal("ship"))
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent(); f.commands()
            f.link.submitText("s", "hello", false)
            f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "new goal")
            f.link.goalAction("s", GoalCommand.Resume, f.session!!.goal)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
            assertNull(f.session!!.goalAttempt)
            // Goal pause stays independent of maintenance, and it does not block a later clear by itself.
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent()
            assertEquals(listOf("goal-pause"), f.commands().map { it["type"].linkString() })
        }
        fixture { f ->
            f.ready(status = "running", goal = goal("ship"))
            f.maintain(SessionMaintenanceCommand.Retry)
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent(); f.commands()
            f.link.submitText("s", "steer", true)
            f.link.queueAction("s", QueueCommand.Enqueue, text = "queued")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
            assertNull(f.session!!.queueAttempt)
            // Abort stays independent of maintenance.
            f.link.stopSession("s")
            runCurrent()
            assertEquals(listOf("abort"), f.commands().map { it["type"].linkString() })
        }
        for (waiting in listOf("text", "queue", "goal")) fixture { f ->
            f.ready(status = "running", goal = goal("ship", "active"))
            when (waiting) {
                "text" -> f.link.submitText("s", "steer", true)
                "queue" -> f.link.queueAction("s", QueueCommand.Enqueue, text = "queued")
                else -> f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "new goal")
            }
            runCurrent(); f.commands()
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent()
            assertTrue("compact while $waiting waits", f.commands().isEmpty())
            assertNull(f.session!!.maintenance)
        }
        fixture { f ->
            f.ready(goal = goal("ship", "active"))
            f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "new goal")
            runCurrent(); f.commands()
            f.maintain(SessionMaintenanceCommand.Retry)
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.maintenance)
        }
    }

    @Test fun `scope denial rejects only this generation matching attempt even after timeout`() = runTest {
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent(); f.commands()
            f.frame(denial("compact"))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.maintenance?.phase)
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.maintenance?.phase)
            f.frame(denial("retry"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.maintenance?.phase)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            val older = f.host.seal(denial("retry"))
            f.catalog()
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent(); f.commands()
            f.socket.binary(older); runCurrent()
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.maintenance?.phase)
            f.frame(denial("retry"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.maintenance?.phase)
        }
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent(); f.commands()
            f.link.selectSession(null); runCurrent()
            f.frame(denial("retry"))
            assertTrue(f.state.readOnly)
            assertNull(f.session)
        }
    }

    @Test fun `disconnect and a new epoch retire the attempt without replaying it`() = runTest {
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent(); f.commands()
            f.socket.failed(); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.maintenance?.phase)
            advanceTimeBy(1_000); runCurrent()
            f.begin(existing = true); f.prove()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            f.frame(hostInfo)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.maintenance?.phase)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.maintain(SessionMaintenanceCommand.Compact)
            runCurrent(); f.commands()
            f.link.retrySession(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }, epoch = "replacement")
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.maintenance?.phase)
            assertTrue(f.commands().isEmpty())
        }
        // Compaction progress is not replayed, so a new epoch cannot re-pin it.
        fixture { f ->
            f.ready()
            f.event("compaction", 1, """"state":"start"""")
            assertEquals(DesktopCompaction("start"), f.session!!.compaction)
            f.link.retrySession(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }, epoch = "replacement")
            assertNull(f.session!!.compaction)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `local send failure leaves an unconfirmed attempt instead of an echo`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.accept = false
            f.maintain(SessionMaintenanceCommand.Retry)
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.maintenance?.phase)
            assertEquals(SessionMaintenanceCommand.Retry, f.session!!.maintenance?.command)
            assertEquals(1L, f.session!!.maintenance?.id)
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
        fun ready(status: String = "idle", context: String? = null, usage: String? = null, goal: String? = null) {
            link.selectSession("s"); begin(); prove()
            sync(commands().single { it["type"].linkString() == "subscribe" }, status)
            frame(hostInfo); catalog(context = context, usage = usage, goal = goal)
        }
        fun maintain(command: SessionMaintenanceCommand, text: String? = null) =
            link.maintain("s", command, session!!.maintenanceBaseline!!, text)
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun catalog(context: String? = null, usage: String? = null, goal: String? = null) =
            entries("[${row(context = context, usage = usage, goal = goal)}]")
        fun entries(entries: String) = frame(json("""{"type":"catalog","entries":$entries}"""))
        fun row(context: String? = null, usage: String? = null, goal: String? = null,
                archived: Boolean = false): String =
            """{"id":"s","title":"Task","projectName":"Project","status":"idle"""" +
                (if (archived) ""","archived":true""" else "") +
                (context?.let { ""","context":$it""" } ?: "") +
                (usage?.let { ""","usageTotals":$it""" } ?: "") +
                (goal?.let { ""","goal":$it""" } ?: "") + "}"
        fun event(type: String, seq: Int, fields: String) = frame(json(
            """{"type":"agent-event","cursor":{"epoch":"e","seq":$seq},"event":{"type":"$type",
                "sessionId":"s","identity":{"sessionId":"s","generation":"g"},$fields}}"""))
        fun sync(command: JsonObject, status: String = "idle", epoch: String = "e") {
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
        val hostInfo = json("""{"type":"host-info","hostname":"Host"}""")
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
        fun goal(text: String = "ship", status: String = "active"): String =
            """{"text":${JsonPrimitive(text)},"status":"$status","autoTurns":0}"""
        fun denial(command: String) = json("""{"type":"command-rejected","command":"$command","error":"read-only"}""")
    }
}
