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
class DesktopTaskStopTest {
    @Test fun `task stop sends the exact command for both kinds`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            val baseline = f.session!!.taskStopBaseline(SessionTaskKind.Background)!!
            assertEquals(TaskStopBaseline("e", null, listOf("t1")), baseline)
            f.link.stopTask("s", SessionTaskKind.Background, "t1", baseline)
            runCurrent()
            assertEquals(listOf("""{"type":"task-stop","sessionId":"s","taskId":"t1"}"""), f.sent())
            assertEquals(1L, f.session!!.taskStop?.id)
            assertEquals(SessionTaskKind.Background, f.session!!.taskStop?.kind)
            assertEquals("t1", f.session!!.taskStop?.targetId)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
            assertEquals(1L, f.session!!.taskStopBaseline(SessionTaskKind.Background)?.attemptId)
            assertTrue(f.session!!.taskStopBaseline(SessionTaskKind.Subagent)!!.runningIds.isEmpty())
        }
        fixture { f ->
            f.ready(agents = "[${agent()}]")
            val baseline = f.session!!.taskStopBaseline(SessionTaskKind.Subagent)!!
            assertEquals(TaskStopBaseline("e", null, listOf("a1")), baseline)
            f.link.stopTask("s", SessionTaskKind.Subagent, "a1", baseline)
            runCurrent()
            assertEquals(listOf("""{"type":"subagent-stop","sessionId":"s","agentId":"a1"}"""), f.sent())
            assertEquals(1L, f.session!!.taskStop?.id)
            assertEquals(SessionTaskKind.Subagent, f.session!!.taskStop?.kind)
            assertEquals("a1", f.session!!.taskStop?.targetId)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
            assertTrue(f.session!!.taskStopBaseline(SessionTaskKind.Background)!!.runningIds.isEmpty())
        }
    }

    @Test fun `only a running id of the same kind may be stopped`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]", agents = "[${agent()}]")
            val tasks = f.session!!.taskStopBaseline(SessionTaskKind.Background)!!
            val agents = f.session!!.taskStopBaseline(SessionTaskKind.Subagent)!!
            assertEquals(listOf("a1"), agents.runningIds)
            // Unknown id, blank id, oversized id and the other kind's id are all refused.
            f.link.stopTask("s", SessionTaskKind.Background, "t9", tasks)
            f.link.stopTask("s", SessionTaskKind.Background, "", tasks)
            f.link.stopTask("s", SessionTaskKind.Background, "   ", tasks)
            f.link.stopTask("s", SessionTaskKind.Background, "t".repeat(513), tasks)
            f.link.stopTask("s", SessionTaskKind.Background, "a1", agents)
            f.link.stopTask("s", SessionTaskKind.Subagent, "t1", tasks)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.taskStop)
        }
        // Without a sync cursor there is no epoch and therefore no baseline at all.
        fixture { f ->
            f.link.selectSession("s"); f.begin(); f.prove()
            val subscribe = f.commands().single { it["type"].linkString() == "subscribe" }
            assertNull(f.session!!.taskStopBaseline(SessionTaskKind.Background))
            f.link.stopTask("s", SessionTaskKind.Background, "t1", TaskStopBaseline("e", null, listOf("t1")))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.taskStop)
            f.sync(subscribe)
            assertEquals(TaskStopBaseline("e", null, emptyList()), f.session!!.taskStopBaseline(SessionTaskKind.Background))
        }
    }

    @Test fun `a running turn other session and hidden or read-only screen refuse the stop`() = runTest {
        // Stopping a task never requires an idle session.
        fixture { f ->
            f.ready(status = "running", tasks = "[${task()}]")
            f.stopBackground()
            runCurrent()
            assertEquals(listOf("""{"type":"task-stop","sessionId":"s","taskId":"t1"}"""), f.sent())
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
        }
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.link.stopTask("other", SessionTaskKind.Background, "t1",
                f.session!!.taskStopBaseline(SessionTaskKind.Background)!!)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.taskStop)
        }
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.frame(json("""{"type":"host-info","hostname":"Host","readOnly":true}"""))
            assertTrue(f.state.readOnly)
            f.stopBackground()
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.taskStop)
        }
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            f.commands() // The hidden presence frame is not a stop.
            f.stopBackground()
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.taskStop)
        }
    }

    @Test fun `stale epoch attempt id or running ids can never resend`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.link.stopTask("s", SessionTaskKind.Background, "t1", TaskStopBaseline("other", null, listOf("t1")))
            f.link.stopTask("s", SessionTaskKind.Background, "t1", TaskStopBaseline("e", 7L, listOf("t1")))
            f.link.stopTask("s", SessionTaskKind.Background, "t1", TaskStopBaseline("e", null, emptyList()))
            f.link.stopTask("s", SessionTaskKind.Background, "t1", TaskStopBaseline("e", null, listOf("t1", "t2")))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.taskStop)
        }
        // ABA: the screen still shows the pre-attempt baseline after the attempt became unconfirmed.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            val stale = f.session!!.taskStopBaseline(SessionTaskKind.Background)!!
            f.stopBackground()
            runCurrent(); f.commands()
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            f.link.stopTask("s", SessionTaskKind.Background, "t1", stale)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals(1L, f.session!!.taskStop?.id)
            f.stopBackground()
            runCurrent()
            assertEquals(listOf("""{"type":"task-stop","sessionId":"s","taskId":"t1"}"""), f.sent())
            assertEquals(2L, f.session!!.taskStop?.id)
        }
        // A newly started task moves the running set, so the old screen cannot claim the new baseline.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            val stale = f.session!!.taskStopBaseline(SessionTaskKind.Background)!!
            f.event(1, "task-started", """"task":${task(id = "t2")}""")
            assertEquals(listOf("t1", "t2"), f.session!!.taskStopBaseline(SessionTaskKind.Background)!!.runningIds)
            f.link.stopTask("s", SessionTaskKind.Background, "t1", stale)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.taskStop)
        }
    }

    @Test fun `local send failure leaves an unconfirmed attempt instead of an echo`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.socket.accept = false
            f.stopBackground()
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            assertEquals(1L, f.session!!.taskStop?.id)
            assertEquals("t1", f.session!!.taskStop?.targetId)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `timeout keeps the attempt unconfirmed and never replays it`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            advanceTimeBy(9_000); runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
            advanceTimeBy(1_100); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            assertEquals(1L, f.session!!.taskStop?.id)
            // Settlement requires a waiting attempt; a late frame can no longer confirm it.
            f.event(1, "task-ended", """"taskId":"t1","status":"done","exitCode":0""")
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            assertEquals("done", f.session!!.timeline.backgroundTasks.single().status)
            f.stopBackground()
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a later frame that no longer reports the target running observes the stop`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.event(1, "task-ended", """"taskId":"t1","status":"done","exitCode":0""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.taskStop?.phase)
            assertEquals(1L, f.session!!.taskStop?.id)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            // A level frame proves the desktop no longer reports the task at all.
            f.event(1, "background-tasks-level", """"tasks":[${task(id = "t2")}]""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.taskStop?.phase)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.event(1, "task-output", """"taskId":"t1","status":"failed","tail":"boom"""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.taskStop?.phase)
        }
        fixture { f ->
            f.ready(agents = "[${agent()}]")
            f.stopAgent()
            runCurrent(); f.commands()
            f.event(1, "subagent-update", """"agent":${agent(status = "done")}""")
            assertEquals(SessionCommandPhase.Observed, f.session!!.taskStop?.phase)
            assertEquals(SessionTaskKind.Subagent, f.session!!.taskStop?.kind)
        }
        // A frame that leaves the target running proves nothing, even for another attempt id.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.event(1, "task-output", """"taskId":"t1","status":"running","tail":"more"""")
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
        }
    }

    @Test fun `another session an older frame or a new epoch cannot confirm the stop`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.frame(json("""{"type":"agent-event","cursor":{"epoch":"e","seq":1},"event":{"type":"task-ended",
                "sessionId":"other","identity":{"sessionId":"other","generation":"g"},
                "taskId":"t1","status":"done","exitCode":0}}"""))
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
        }
        // A frame sealed before the write keeps its old sequence even when it arrives late.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            val older = f.host.seal(f.eventFrame(1, "task-ended", """"taskId":"t1","status":"done","exitCode":0"""))
            f.catalog()
            f.stopBackground()
            runCurrent(); f.commands()
            f.socket.binary(older); runCurrent()
            assertEquals("done", f.session!!.timeline.backgroundTasks.single().status)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
        }
        // A frame from another epoch is a resync, and a resync retires the attempt.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.frame(json("""{"type":"agent-event","cursor":{"epoch":"next","seq":1},"event":{"type":"task-ended",
                "sessionId":"s","identity":{"sessionId":"s","generation":"g"},
                "taskId":"t1","status":"done","exitCode":0}}"""))
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            assertTrue(f.commands().none { it["type"].linkString() == "task-stop" })
        }
        // An explicit resync retires the attempt and never replays it, even when the target is gone.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.link.retrySession(); runCurrent(); advanceTimeBy(1_501); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" }, tasks = "[${task(status = "done")}]")
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            assertEquals("done", f.session!!.timeline.backgroundTasks.single().status)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `task stop scope denial fails closed and rejects the matching attempt even after timeout`() = runTest {
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.frame(denial("task-stop"))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.session!!.taskStop?.phase)
            assertEquals(1L, f.session!!.taskStop?.id)
            assertTrue(f.commands().isEmpty())
        }
        // A denial naming the sibling command fences the scope but cannot settle this attempt.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.frame(denial("subagent-stop"))
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
            advanceTimeBy(10_001); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.session!!.taskStop?.phase)
            // A late denial still names the attempt that was sent, never a newer one.
            f.frame(denial("task-stop"))
            assertEquals(SessionCommandPhase.Rejected, f.session!!.taskStop?.phase)
            assertTrue(f.commands().isEmpty())
        }
        // A denial older than the write cannot name it.
        fixture { f ->
            f.ready(tasks = "[${task()}]")
            val older = f.host.seal(denial("task-stop"))
            f.catalog()
            f.stopBackground()
            runCurrent(); f.commands()
            f.socket.binary(older); runCurrent()
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.session!!.taskStop?.phase)
        }
    }

    @Test fun `task stop and other waiting writes exclude each other while abort and goal pause stay free`() = runTest {
        fixture { f ->
            f.ready(status = "running", goal = goal("ship", "active"), tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.link.submitText("s", "steer", true)
            f.link.queueAction("s", QueueCommand.Enqueue, text = "queued")
            f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "next")
            f.maintain(SessionMaintenanceCommand.Compact)
            f.rewind(0, false)
            f.stopBackground()
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.textAttempt)
            assertNull(f.session!!.queueAttempt)
            assertNull(f.session!!.goalAttempt)
            assertNull(f.session!!.maintenance)
            assertNull(f.session!!.rewind)
            assertEquals(1L, f.session!!.taskStop?.id)
        }
        // Abort and goal pause/clear start no queued work, so a waiting stop never blocks them.
        for (free in listOf("goal-pause", "goal-clear")) fixture { f ->
            f.ready(status = "running", goal = goal("ship", "active"), tasks = "[${task()}]")
            f.stopBackground()
            runCurrent(); f.commands()
            f.link.stopSession("s")
            f.link.goalAction("s", if (free == "goal-clear") GoalCommand.Clear else GoalCommand.Pause,
                f.session!!.goal)
            runCurrent()
            assertEquals(listOf("abort", free), f.commands().map { it["type"].linkString() })
            assertEquals(1L, f.session!!.taskStop?.id)
        }
        // A goal pause owns no work, so it never blocks a stop.
        fixture { f ->
            f.ready(goal = goal("ship", "active"), tasks = "[${task()}]")
            f.link.goalAction("s", GoalCommand.Pause, f.session!!.goal)
            runCurrent(); f.commands()
            f.stopBackground()
            runCurrent()
            assertEquals(listOf("""{"type":"task-stop","sessionId":"s","taskId":"t1"}"""), f.sent())
        }
        for (waiting in listOf("text", "queue", "goal", "maintenance", "rewind")) fixture { f ->
            f.ready(status = if (waiting == "queue") "running" else "idle",
                goal = goal("ship", "active"), tasks = "[${task()}]")
            when (waiting) {
                "text" -> f.link.submitText("s", "hello", false)
                "queue" -> f.link.queueAction("s", QueueCommand.Enqueue, text = "queued")
                "goal" -> f.link.goalAction("s", GoalCommand.Set, f.session!!.goal, "next")
                "maintenance" -> f.maintain(SessionMaintenanceCommand.Compact)
                else -> f.rewind(0, false)
            }
            runCurrent(); f.commands()
            f.stopBackground()
            runCurrent()
            assertTrue("task stop while $waiting waits", f.commands().isEmpty())
            assertNull("task stop while $waiting waits", f.session!!.taskStop)
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
        fun ready(status: String = "idle", goal: String? = null, agents: String? = null, tasks: String? = null) {
            link.selectSession("s"); begin(); prove()
            sync(commands().single { it["type"].linkString() == "subscribe" }, status, agents, tasks)
            frame(hostInfo); catalog(goal)
        }
        fun stopBackground() = link.stopTask("s", SessionTaskKind.Background, "t1",
            session!!.taskStopBaseline(SessionTaskKind.Background)!!)
        fun stopAgent() = link.stopTask("s", SessionTaskKind.Subagent, "a1",
            session!!.taskStopBaseline(SessionTaskKind.Subagent)!!)
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
        fun eventFrame(seq: Int, type: String, fields: String, epoch: String = "e") = json(
            """{"type":"agent-event","cursor":{"epoch":"$epoch","seq":$seq},"event":{"type":"$type",
                "sessionId":"s","identity":{"sessionId":"s","generation":"g"},$fields}}""")
        fun event(seq: Int, type: String, fields: String) = frame(eventFrame(seq, type, fields))
        fun sync(command: JsonObject, status: String = "idle", agents: String? = null, tasks: String? = null,
                 epoch: String = "e") {
            val requestId = (command["sync"] as JsonObject)["requestId"].linkString()
            val rows = agents?.let { ""","subagents":$it""" }.orEmpty() +
                tasks?.let { ""","backgroundTasks":$it""" }.orEmpty()
            frame(json("""{"type":"session-sync","sessionId":"s","requestId":"$requestId","cursor":{"epoch":"$epoch","seq":0},"mode":"snapshot","snapshot":{"type":"snapshot","sessions":[{"sessionId":"s","identity":{"sessionId":"s","generation":"g"},"baseIndex":0,"messages":[],"status":"$status"$rows}]}}"""))
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
        fun agent(id: String = "a1", status: String = "running") =
            """{"id":"$id","description":"scout","status":"$status","steps":1,"currentActivity":"grep"}"""
        fun task(id: String = "t1", status: String = "running", tail: String = "ready") =
            """{"taskId":"$id","command":"pnpm dev","status":"$status","tail":${JsonPrimitive(tail)}}"""
        fun goal(text: String = "ship", status: String = "active"): String =
            """{"text":${JsonPrimitive(text)},"status":"$status","autoTurns":0}"""
        fun denial(command: String) = json("""{"type":"command-rejected","command":"$command","error":"read-only"}""")
    }
}
