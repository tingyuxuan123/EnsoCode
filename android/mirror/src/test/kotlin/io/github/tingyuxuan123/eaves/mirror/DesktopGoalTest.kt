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
class DesktopGoalTest {
    @Test fun `goal text normalization is exactly JS trim and bounds raw as well as normalized input`() {
        val whitespace = "\u0009\u000A\u000B\u000C\u000D \u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF"
        assertEquals("goal", sessionGoalText(whitespace + "goal" + whitespace))
        assertEquals("\u0085goal\u0085", sessionGoalText("\u0085goal\u0085"))
        assertEquals("a\uFEFF b", sessionGoalText(" a\uFEFF b "))
        assertNull(sessionGoalText(whitespace))
        assertNull(sessionGoalText(""))
        assertEquals("x".repeat(SESSION_TEXT_LIMIT), sessionGoalText("x".repeat(SESSION_TEXT_LIMIT)))
        assertNull(sessionGoalText(" " + "x".repeat(SESSION_TEXT_LIMIT)))
        assertNull(sessionGoalText("x".repeat(SESSION_TEXT_LIMIT + 1)))
    }

    @Test fun `subscribed goals project exact validated data while dirty slim absent duplicate rows prove nothing`() = runTest {
        fixture { f ->
            f.ready(goal = goal("old", "blocked", 9, "why"))
            val original = DesktopGoal("old", "blocked", 9, "why")
            assertEquals(original, f.session!!.goal)
            assertTrue(f.session!!.goalReady)
            val badGoals = listOf("null", "{}", "false", goal("\uFEFF "), goal(status = "future"),
                """{"text":"x","status":"active","autoTurns":-1}""",
                """{"text":"x","status":"active","autoTurns":1.5}""",
                """{"text":"x","status":"active","autoTurns":9007199254740992}""",
                """{"text":"x","status":"active","autoTurns":"1"}""",
                """{"text":"x","status":"active","autoTurns":0,"note":null}""",
                """{"text":"x","status":"active","autoTurns":0,"note":false}""",
                goal(note = "n".repeat(SESSION_TEXT_LIMIT + 1)), goal("x".repeat(SESSION_TEXT_LIMIT + 1)))
            for (bad in badGoals) {
                f.catalog(bad)
                assertFalse("Malformed goal: $bad", f.session!!.goalReady)
                assertEquals(original, f.session!!.goal)
                f.link.goalAction("s", GoalCommand.Clear, original)
                runCurrent(); assertTrue(f.commands().isEmpty())
            }
            for (entries in listOf("[]", "[null,{}]", """[{"id":"s","title":"Slim","status":"idle"}]""",
                """[{"id":"s","title":"Bad","projectName":false,"status":"idle"}]""",
                "[${row(goal())},${row(null)}]", "[${row(goal())},{\"id\":\"s\"}]")) {
                f.frame(json("""{"type":"catalog","entries":$entries}"""))
                assertFalse(f.session!!.goalReady)
                assertEquals(original, f.session!!.goal)
            }
            // Presence of goal is itself a chat-bearing marker even without projectName.
            f.frame(json("""{"type":"catalog","entries":[{"id":"s","title":"Goal","status":"idle","goal":${goal("exact", "waiting", 9007199254740991)}}]}"""))
            assertEquals(DesktopGoal("exact", "waiting", 9007199254740991), f.session!!.goal)
            assertTrue(f.session!!.goalReady)
            f.catalog(null)
            assertTrue(f.session!!.goalReady)
            assertNull(f.session!!.goal)
        }
    }

    @Test fun `set pause resume clear are one shot observations with no optimistic echo or delivery receipt`() = runTest {
        fixture { f ->
            f.ready()
            val timeline = f.session!!.timeline
            f.link.goalAction("s", GoalCommand.Set, null, "\uFEFF  ship \n")
            f.link.goalAction("s", GoalCommand.Set, null, "duplicate")
            runCurrent()
            assertEquals(listOf(json("""{"type":"goal-set","sessionId":"s","text":"ship"}""")), f.commands())
            assertNull(f.session!!.goal)
            assertEquals("ship", f.session!!.goalAttempt?.text)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            f.catalog(goal("ship "))
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            f.catalog(goal("ship", "paused"))
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            f.catalog(goal("ship"))
            assertEquals(SessionCommandPhase.Observed, f.session!!.goalAttempt?.phase)
            for ((command, status) in listOf(GoalCommand.Pause to "paused", GoalCommand.Resume to "active")) {
                val before = f.session!!.goal
                f.link.goalAction("s", command, before)
                runCurrent()
                assertEquals("goal-${command.name.lowercase()}", f.commands().single()["type"].linkString())
                assertEquals(before, f.session!!.goal)
                f.catalog(goal("wrong", status))
                assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
                f.catalog(goal("ship", status))
                assertEquals(SessionCommandPhase.Observed, f.session!!.goalAttempt?.phase)
            }
            f.link.goalAction("s", GoalCommand.Clear, f.session!!.goal)
            runCurrent(); assertEquals("goal-clear", f.commands().single()["type"].linkString())
            assertNotNull(f.session!!.goal)
            f.catalog("null")
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            f.catalog(null)
            assertEquals(SessionCommandPhase.Observed, f.session!!.goalAttempt?.phase)
            assertNull(f.session!!.goal)
            assertEquals(timeline, f.session!!.timeline)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `stale authenticated catalog cannot project or confirm and late timeout state is projection only`() = runTest {
        fixture { f ->
            f.ready()
            val stale = f.host.seal(catalog(goal("ship")))
            f.catalog(null)
            f.link.goalAction("s", GoalCommand.Set, null, "ship")
            runCurrent(); f.commands()
            f.socket.binary(stale); runCurrent()
            assertNull(f.session!!.goal)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
            f.catalog(goal("ship"))
            assertEquals(DesktopGoal("ship", "active", 0), f.session!!.goal)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `malformed catalog fences older full rows without clearing the last visible goal`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            val older = f.host.seal(catalog(null))
            f.frame(json("""{"type":"catalog","entries":null}"""))
            assertFalse(f.session!!.goalReady)
            f.socket.binary(older); runCurrent()
            assertFalse(f.session!!.goalReady)
            assertEquals(DesktopGoal("ship", "active", 0), f.session!!.goal)
            f.catalog(null)
            assertTrue(f.session!!.goalReady)
            assertNull(f.session!!.goal)
        }
    }

    @Test fun `archived selected task cannot seed goal authority or launch goals without altering queue authority`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            val original = f.session!!.goal
            for (extra in listOf(",\"goal\":${goal(status = "paused")}", "")) {
                f.frame(json("""{"type":"catalog","entries":[{"id":"s","title":"Archived","projectName":"P","status":"idle","archived":true,"queued":[]$extra}]}"""))
                assertFalse(f.session!!.goalReady)
                assertEquals(original, f.session!!.goal)
                assertTrue(f.session!!.queueReady)
                f.link.goalAction("s", GoalCommand.Set, original, "must not start")
                runCurrent(); assertTrue(f.commands().isEmpty())
            }
        }
    }

    @Test fun `caller goal baseline and actor baseline both reject stale edits including caller ABA`() = runTest {
        fixture { f ->
            f.ready(goal = goal("A"))
            val a = f.session!!.goal
            f.socket.binary(f.host.seal(catalog(goal("B"))))
            f.link.goalAction("s", GoalCommand.Set, a, "stale")
            runCurrent(); assertTrue(f.commands().isEmpty())
            // At invocation UI already sees B; an old A argument must not regain authority
            // merely because an A catalog is queued ahead of this action.
            f.socket.binary(f.host.seal(catalog(goal("A"))))
            f.link.goalAction("s", GoalCommand.Clear, a)
            runCurrent(); assertTrue(f.commands().isEmpty())
            f.link.goalAction("s", GoalCommand.Clear, f.session!!.goal)
            runCurrent(); assertEquals("goal-clear", f.commands().single()["type"].linkString())
        }
    }

    @Test fun `expected goal compares status turns note and null not merely goal text`() = runTest {
        for (changed in listOf(goal(status = "paused"), goal(turns = 1), goal(note = "new note"), null)) fixture { f ->
            f.ready(goal = goal())
            val original = f.session!!.goal
            f.socket.binary(f.host.seal(catalog(changed)))
            f.link.goalAction("s", GoalCommand.Set, original, "edit")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.goalAttempt)
        }
    }

    @Test fun `only one goal mutation may be pending regardless of command kind`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            val original = f.session!!.goal
            f.link.goalAction("s", GoalCommand.Set, original, "new")
            f.link.goalAction("s", GoalCommand.Pause, original)
            f.link.goalAction("s", GoalCommand.Clear, original)
            runCurrent()
            assertEquals(listOf("goal-set"), f.commands().map { it["type"].linkString() })
            assertEquals(GoalCommand.Set, f.session!!.goalAttempt?.command)
            assertEquals(original, f.session!!.goal)
        }
    }

    @Test fun `same value operations invalid arguments and missing goal are noops`() = runTest {
        fixture { f ->
            f.ready(goal = goal("ship"))
            f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, " ship ")
            f.link.goalAction("s", GoalCommand.Resume, f.session!!.goal)
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal, "unexpected")
            f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, " ")
            f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "x".repeat(SESSION_TEXT_LIMIT + 1))
            runCurrent(); assertTrue(f.commands().isEmpty()); assertNull(f.session!!.goalAttempt)
            f.catalog(goal("ship", "paused"))
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); assertTrue(f.commands().isEmpty())
            f.catalog(goal("ship", "completed"))
            f.link.goalAction("s", GoalCommand.Resume, f.session!!.goal)
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); assertTrue(f.commands().isEmpty())
            f.catalog(null)
            for (command in listOf(GoalCommand.Pause, GoalCommand.Resume, GoalCommand.Clear)) f.link.goalAction("s", command, null)
            runCurrent(); assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `desktop permits resume from paused blocked and waiting goals`() = runTest {
        for (status in listOf("paused", "blocked", "waiting")) fixture { f ->
            f.ready(goal = goal(status = status))
            f.link.goalAction("s", GoalCommand.Resume, f.session!!.goal)
            runCurrent()
            assertEquals(json("""{"type":"goal-resume","sessionId":"s"}"""), f.commands().single())
            assertEquals(status, f.session!!.goal?.status)
            f.catalog(goal())
            assertEquals(SessionCommandPhase.Observed, f.session!!.goalAttempt?.phase)
        }
    }

    @Test fun `bootstrap cannot seed goals but current subscribed catalog before sync may project without write authority`() = runTest {
        fixture { f ->
            f.link.selectSession("s"); f.begin()
            f.frame(catalog(goal()))
            assertFalse(f.session!!.goalReady)
            f.prove()
            val subscribe = f.commands().single { it["type"].linkString() == "subscribe" }
            assertFalse(f.session!!.goalReady)
            f.catalog(goal())
            assertTrue(f.session!!.goalReady)
            f.frame(hostInfo)
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); assertTrue(f.commands().isEmpty())
            f.sync(subscribe)
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); assertEquals("goal-pause", f.commands().single()["type"].linkString())
        }
    }

    @Test fun `selected visible writable generation is required and retained background can observe prior writes`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            f.link.goalAction("other", GoalCommand.Pause, f.session!!.goal)
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); f.link.setVisible(true)
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); assertEquals(listOf("presence", "presence"), f.commands().map { it["type"].linkString() })
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); f.commands()
            f.link.setVisible(false); runCurrent(); f.commands()
            f.catalog(goal(status = "paused"))
            assertEquals(SessionCommandPhase.Observed, f.session!!.goalAttempt?.phase)
            f.link.goalAction("s", GoalCommand.Clear, f.session!!.goal)
            runCurrent(); assertTrue(f.commands().isEmpty())
            f.link.setVisible(true); runCurrent(); f.commands()
            f.link.selectSession(null); f.link.selectSession("s")
            f.link.goalAction("s", GoalCommand.Clear, f.session!!.goal)
            runCurrent()
            assertFalse(f.session!!.goalReady); assertNull(f.session!!.goalAttempt)
            assertFalse(f.commands().any { it["type"].linkString() == "goal-clear" })
        }
    }

    @Test fun `queued writes cannot cross read only writable authority ABA or peer reauthentication`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            f.socket.binary(f.host.seal(json("""{"type":"host-info","readOnly":true}""")))
            f.socket.binary(f.host.seal(hostInfo))
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.socket.text("""{"type":"host-offline"}""")
            f.socket.text("""{"type":"host-online"}""")
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent()
            assertFalse(f.session!!.goalReady)
            assertFalse(f.commands().any { it["type"].linkString() == "goal-pause" })
        }
    }

    @Test fun `goal scope denials fail closed match commands fence stale host info even after timeout or deselection`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            val staleWritable = f.host.seal(hostInfo)
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); f.commands()
            f.frame(denial("goal-clear"))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            advanceTimeBy(10_001); runCurrent()
            f.frame(denial("goal-pause"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.goalAttempt?.phase)
            f.socket.binary(staleWritable); runCurrent()
            assertTrue(f.state.readOnly)
            f.catalog(goal(status = "paused"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.goalAttempt?.phase)
            f.link.selectSession(null); runCurrent()
            f.frame(hostInfo); assertFalse(f.state.readOnly)
            f.frame(denial("goal-set")); assertTrue(f.state.readOnly)
        }
    }

    @Test fun `older matching scope denial fails closed without rejecting a newer attempt`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            val older = f.host.seal(denial("goal-pause"))
            f.catalog(goal())
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); f.commands()
            f.socket.binary(older); runCurrent()
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            f.frame(denial("goal-pause"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.goalAttempt?.phase)
        }
    }

    @Test fun `same epoch sync retains goal and pending evidence new epoch invalidates authority not visible goal`() = runTest {
        fixture { f ->
            f.ready(goal = goal())
            val original = f.session!!.goal
            f.link.goalAction("s", GoalCommand.Pause, original)
            runCurrent(); f.commands()
            f.link.retrySession(); f.link.goalAction("s", GoalCommand.Clear, original)
            runCurrent(); advanceTimeBy(1_501); runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            assertEquals(original, f.session!!.goal); assertTrue(f.session!!.goalReady)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.goalAttempt?.phase)
            f.link.retrySession(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            val oldEpochCatalog = f.host.seal(catalog(goal(status = "paused")))
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }, "replacement")
            assertEquals(original, f.session!!.goal); assertFalse(f.session!!.goalReady)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
            f.socket.binary(oldEpochCatalog); runCurrent()
            assertEquals(original, f.session!!.goal); assertFalse(f.session!!.goalReady)
            f.catalog(goal(status = "paused"))
            assertTrue(f.session!!.goalReady)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
        }
    }

    @Test fun `disconnect and send failure preserve unconfirmed set draft without automatic retry`() = runTest {
        fixture { f ->
            f.ready()
            f.link.goalAction("s", GoalCommand.Set, null, " keep draft ")
            runCurrent(); f.commands()
            val old = f.socket
            old.failed(); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
            assertEquals("keep draft", f.session!!.goalAttempt?.text)
            assertFalse(f.session!!.goalReady)
            advanceTimeBy(1_000); runCurrent()
            f.begin(existing = true); f.prove()
            val subscribe = f.commands().single { it["type"].linkString() == "subscribe" }
            old.binary(f.host.seal(catalog(goal("keep draft")))); runCurrent()
            f.sync(subscribe); f.frame(hostInfo); f.catalog(null)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
            assertTrue(f.commands().isEmpty())
            f.socket.accept = false
            f.link.goalAction("s", GoalCommand.Set, null, "new draft")
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertEquals("new draft", f.session!!.goalAttempt?.text)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.goalAttempt?.phase)
        }
    }

    @Test fun `set resume exclude waiting composer queue stop and reverse while pause clear abort remain independent`() = runTest {
        for (command in listOf(GoalCommand.Set, GoalCommand.Resume)) {
            fixture { f ->
                f.ready(goal = goal(status = "paused"), status = "running")
                f.link.goalAction("s", command, f.session!!.goal, if (command == GoalCommand.Set) "new" else null)
                f.link.submitText("s", "steer", true)
                f.link.queueAction("s", QueueCommand.Enqueue, text = "queue")
                f.link.stopSession("s")
                runCurrent()
                assertEquals(listOf("goal-${command.name.lowercase()}", "abort"), f.commands().map { it["type"].linkString() })
                assertNull(f.session!!.textAttempt); assertNull(f.session!!.queueAttempt)
            }
            for (waiting in listOf("text", "queue", "stop")) fixture { f ->
                f.ready(goal = goal(status = "paused"), status = "running")
                when (waiting) {
                    "text" -> f.link.submitText("s", "steer", true)
                    "queue" -> f.link.queueAction("s", QueueCommand.Enqueue, text = "queue")
                    else -> f.link.stopSession("s")
                }
                f.link.goalAction("s", command, f.session!!.goal, if (command == GoalCommand.Set) "new" else null)
                runCurrent(); assertEquals(1, f.commands().size); assertNull(f.session!!.goalAttempt)
                f.link.goalAction("s", GoalCommand.Clear, f.session!!.goal)
                runCurrent(); assertEquals("goal-clear", f.commands().single()["type"].linkString())
            }
        }
        fixture { f ->
            f.ready(goal = goal(), status = "running")
            f.link.submitText("s", "steer", true)
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); assertEquals(listOf("steer", "goal-pause"), f.commands().map { it["type"].linkString() })
        }
        fixture { f ->
            f.ready()
            f.link.goalAction("s", GoalCommand.Set, null, "ship")
            f.link.submitText("s", "prompt", false)
            runCurrent(); assertEquals(listOf("goal-set"), f.commands().map { it["type"].linkString() })
            assertNull(f.session!!.textAttempt)
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
        fun ready(goal: String? = null, status: String = "idle") {
            link.selectSession("s"); begin(); prove()
            sync(commands().single { it["type"].linkString() == "subscribe" }, status = status)
            frame(hostInfo); catalog(goal)
        }
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun catalog(goal: String?) = frame(DesktopGoalTest.catalog(goal))
        fun sync(command: JsonObject, epoch: String = "e", status: String = "idle") {
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
        fun goal(text: String = "ship", status: String = "active", turns: Long = 0, note: String? = null): String =
            """{"text":${JsonPrimitive(text)},"status":"$status","autoTurns":$turns${note?.let { ",\"note\":${JsonPrimitive(it)}" } ?: ""}}"""
        fun row(goal: String?) = """{"id":"s","title":"Task","projectName":"P","status":"idle"${goal?.let { ",\"goal\":$it" } ?: ""}}"""
        fun catalog(goal: String?) = json("""{"type":"catalog","entries":[${row(goal)}]}""")
        fun denial(command: String) = json("""{"type":"command-rejected","command":"$command","error":"read-only"}""")
    }
}
