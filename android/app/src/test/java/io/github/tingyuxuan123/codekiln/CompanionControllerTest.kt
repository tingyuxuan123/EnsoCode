package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopLinkState
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.PairCredentialStore
import io.github.tingyuxuan123.eaves.mirror.PairCredentials
import io.github.tingyuxuan123.eaves.mirror.DesktopTask
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.DesktopBotChat
import io.github.tingyuxuan123.eaves.mirror.DesktopBotsState
import io.github.tingyuxuan123.eaves.mirror.TaskLaunch
import io.github.tingyuxuan123.eaves.mirror.TaskApprovalMode
import io.github.tingyuxuan123.eaves.mirror.DesktopGoal
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.eaves.mirror.maintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.RewindBaseline
import io.github.tingyuxuan123.eaves.mirror.rewindBaseline
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CompanionControllerTest {
    private fun credentials() = PairCredentials("fixture-pair", "fixture-token", ByteArray(32) { 7 },
        "Pixel fixture", "https://relay.example.test", 1)

    private class Store(var saved: PairCredentials? = null) : PairCredentialStore {
        var broken = false
        var clears = 0
        var pins = 0
        override fun load(): PairCredentials? { check(!broken); return saved }
        override fun save(credentials: PairCredentials) { check(!broken); saved = credentials }
        override fun pin(credentials: PairCredentials) { check(saved?.pairId == credentials.pairId); pins++ }
        override fun clear(expectedPairId: String?) {
            if (expectedPairId != null) check(!broken)
            if (expectedPairId == null || saved?.pairId == expectedPairId) { saved = null; clears++ }
        }
    }

    private class Link : CompanionLink {
        override val state = MutableStateFlow(DesktopLinkState())
        var foreground = false
        var closed = false
        var reconnects = 0
        val watchChanges = mutableListOf<Boolean>()
        val selected = mutableListOf<String?>()
        val answers = mutableListOf<Triple<String, String, String>>()
        val launches = mutableListOf<TaskLaunch>()
        val goals = mutableListOf<Triple<GoalCommand, DesktopGoal?, String?>>()
        val maintenance = mutableListOf<Triple<SessionMaintenanceCommand, MaintenanceBaseline, String?>>()
        val rewinds = mutableListOf<Triple<Long, Boolean, RewindBaseline>>()
        val botOpens = mutableListOf<String>()
        override fun setVisible(visible: Boolean) { foreground = visible }
        override fun setBackgroundAllowed(allowed: Boolean) { watchChanges.add(allowed) }
        override fun reconnect() { reconnects++ }
        override fun close() { closed = true }
        override fun selectSession(sessionId: String?) { selected.add(sessionId) }
        override fun respondAsk(sessionId: String, requestId: String, answer: String) { answers.add(Triple(sessionId, requestId, answer)) }
        override fun createTask(request: TaskLaunch) { launches.add(request) }
        override fun openBotDirect(botId: String) { botOpens.add(botId) }
        override fun goalAction(sessionId: String, command: GoalCommand, expected: DesktopGoal?, text: String?) {
            goals.add(Triple(command, expected, text))
        }
        override fun maintain(sessionId: String, command: SessionMaintenanceCommand, baseline: MaintenanceBaseline,
            text: String?) { maintenance.add(Triple(command, baseline, text)) }
        override fun rewind(sessionId: String, userIndexFromEnd: Long, restoreFiles: Boolean, baseline: RewindBaseline) {
            rewinds.add(Triple(userIndexFromEnd, restoreFiles, baseline))
        }
    }

    private fun TestScope.controller(store: Store, link: Link, claims: suspend (String) -> PairCredentials = { credentials() },
        revoke: suspend (PairCredentials) -> Unit = {}, pin: ((() -> Unit) -> Unit)? = null): CompanionController =
        CompanionController(store, claims, revoke, { credentials, onModern ->
            assertNotNull("Saved before opening socket", store.saved)
            assertEquals(credentials.pairId, store.saved!!.pairId)
            pin?.invoke(onModern)
            link
        }, backgroundScope, StandardTestDispatcher(testScheduler))

    @Test fun `启动恢复凭据但只有前台允许连接且UI不含令牌`() = runTest {
        val store = Store(credentials()); val link = Link()
        val controller = controller(store, link)
        runCurrent()
        assertTrue(controller.state.value.paired)
        assertFalse(link.foreground)
        controller.setVisible(true)
        assertTrue(link.foreground)
        controller.setVisible(false)
        assertFalse(link.foreground)
        assertFalse(controller.state.value.toString().contains("fixture-token"))
    }

    @Test fun `配对完成先同步保存再开socket且pin回调落在同一个配对`() = runTest {
        val store = Store(); val link = Link()
        val controller = controller(store, link, pin = { it() })
        runCurrent(); controller.setVisible(true); controller.pair("fixture-link"); runCurrent()
        assertTrue(controller.state.value.paired)
        assertFalse(controller.state.value.busy)
        assertTrue(link.foreground)
        assertEquals(1, store.pins)
    }

    @Test fun `保存失败不打开连接也不伪装配对成功`() = runTest {
        val store = Store(); val link = Link()
        val controller = controller(store, link)
        runCurrent(); store.broken = true; controller.pair("fixture-link"); runCurrent()
        assertFalse(controller.state.value.paired)
        assertEquals(CompanionProblem.Storage, controller.state.value.problem)
        assertFalse(link.foreground)
    }

    @Test fun `请求进行中不重复claim且不会覆盖已保存电脑`() = runTest {
        val store = Store(); val link = Link(); val gate = CompletableDeferred<PairCredentials>(); var calls = 0
        val controller = controller(store, link, claims = { calls++; gate.await() })
        runCurrent(); controller.pair("one"); controller.pair("two"); runCurrent()
        assertEquals(1, calls); assertTrue(controller.state.value.busy)
        gate.complete(credentials()); runCurrent(); controller.pair("three"); runCurrent()
        assertEquals(1, calls)
    }

    @Test fun `解绑失败保留凭据可重试成功后关闭连接并清掉目录`() = runTest {
        val store = Store(credentials()); val link = Link(); var deny = true
        val controller = controller(store, link, revoke = { check(!deny) })
        runCurrent(); controller.setVisible(true); controller.unpair(); runCurrent()
        assertTrue(controller.state.value.paired)
        assertEquals(CompanionProblem.Revoking, controller.state.value.problem)
        assertFalse(link.closed)
        deny = false; controller.unpair(); runCurrent()
        assertFalse(controller.state.value.paired)
        assertTrue(link.closed); assertEquals(1, store.clears)
        assertTrue(controller.state.value.link.catalog.isEmpty())
    }

    @Test fun `被替换只显示状态不抢回被撤销才清除当前凭据`() = runTest {
        val store = Store(credentials()); val link = Link(); val controller = controller(store, link)
        runCurrent(); link.state.value = DesktopLinkState(phase = LinkPhase.Replaced); runCurrent()
        assertEquals(LinkPhase.Replaced, controller.state.value.link.phase)
        assertEquals(0, link.reconnects); assertEquals(0, store.clears)
        controller.reconnect(); assertEquals(1, link.reconnects)
        link.state.value = DesktopLinkState(phase = LinkPhase.Revoked); runCurrent()
        assertFalse(controller.state.value.paired); assertEquals(1, store.clears)
        assertTrue(link.closed); assertEquals(CompanionProblem.Revoked, controller.state.value.problem)
    }

    @Test fun `解绑同时收到撤销只清一次且不在旧请求结束前开放新配对`() = runTest {
        val store = Store(credentials()); val link = Link(); val relay = CompletableDeferred<Unit>()
        val controller = controller(store, link, revoke = { relay.await() })
        runCurrent(); controller.unpair(); runCurrent()
        link.state.value = DesktopLinkState(phase = LinkPhase.Revoked); runCurrent()
        assertTrue(controller.state.value.busy)
        assertEquals(0, store.clears)
        relay.complete(Unit); runCurrent()
        assertEquals(1, store.clears)
        assertFalse(controller.state.value.paired)
        assertFalse(controller.state.value.busy)
    }

    @Test fun `恢复后损坏的凭据可在确认授权已撤销后显式清理而不必清应用数据`() = runTest {
        val store = Store(credentials()); val link = Link(); val controller = controller(store, link)
        runCurrent(); store.broken = true
        link.state.value = DesktopLinkState(phase = LinkPhase.Revoked); runCurrent()
        assertTrue(controller.state.value.paired)
        assertEquals(CompanionProblem.Storage, controller.state.value.problem)
        controller.unpair(); runCurrent()
        assertFalse(controller.state.value.paired)
        assertEquals(1, store.clears)
    }

    @Test fun `只选择真实目录任务且响应只发往已同步的当前会话`() = runTest {
        val store = Store(credentials()); val link = Link(); val controller = controller(store, link)
        runCurrent()
        controller.selectSession("missing")
        assertTrue(link.selected.isEmpty())
        link.state.value = DesktopLinkState(phase = LinkPhase.Online,
            catalog = listOf(DesktopTask("s1", "任务", "Repo", status = "running")))
        runCurrent(); controller.selectSession("s1")
        assertEquals(listOf("s1"), link.selected)
        controller.respondAsk("s1", "request", "回复")
        assertTrue(link.answers.isEmpty())
        link.state.value = link.state.value.copy(readOnly = false,
            session = DesktopSessionState(SessionTimeline("s1"), loading = false))
        runCurrent()
        controller.respondAsk("another", "request", "忽略旧页面")
        controller.respondAsk("s1", "request", "回复")
        assertEquals(listOf(Triple("s1", "request", "回复")), link.answers)
        controller.selectSession(null)
        assertEquals(listOf("s1", null), link.selected)
    }

    @Test fun `成员私聊只订阅桌面目录绑定且关闭成员模式不接受伪造会话`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        val bots = DesktopBotsState(enabled = true, chats = listOf(
            DesktopBotChat("direct", "direct", "", listOf("bot"), null, 0, 0, sessions = mapOf("bot" to "member-session"))))
        runCurrent(); controller.setVisible(true)
        link.state.value = DesktopLinkState(phase = LinkPhase.Online, bots = bots)
        runCurrent()
        controller.selectSession("forged")
        controller.selectSession("member-session")
        assertEquals(listOf("member-session"), link.selected)
        controller.selectSession(null)
        link.state.value = link.state.value.copy(bots = bots.copy(enabled = false))
        runCurrent(); controller.selectSession("member-session")
        assertEquals(listOf("member-session", null), link.selected)
    }

    @Test fun `首次单聊不会跨后台只读或离线转发`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        runCurrent()
        link.state.value = DesktopLinkState(phase = LinkPhase.Online, readOnly = false, bots = DesktopBotsState(enabled = true))
        runCurrent(); controller.openBotDirect("bot")
        assertTrue(link.botOpens.isEmpty())
        controller.setVisible(true); controller.openBotDirect("bot")
        assertEquals(listOf("bot"), link.botOpens)
        link.state.value = link.state.value.copy(readOnly = true)
        runCurrent(); controller.openBotDirect("bot")
        link.state.value = link.state.value.copy(phase = LinkPhase.Offline, readOnly = false)
        runCurrent(); controller.openBotDirect("bot")
        assertEquals(listOf("bot"), link.botOpens)
    }

    @Test fun `创建只从在线可操作且未订阅其他会话的入口转发`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        val request = TaskLaunch("p", "provider", "model", TaskApprovalMode.Supervised, null, "task")
        runCurrent()
        controller.createTask(request)
        assertTrue(link.launches.isEmpty())
        link.state.value = DesktopLinkState(LinkPhase.Online)
        runCurrent(); controller.createTask(request)
        assertTrue(link.launches.isEmpty())
        link.state.value = link.state.value.copy(readOnly = false,
            catalog = listOf(DesktopTask("other", "现有任务", "Repo", status = "idle")))
        runCurrent(); controller.selectSession("other"); controller.createTask(request)
        assertTrue(link.launches.isEmpty())
        controller.selectSession(null); controller.createTask(request)
        assertEquals(listOf(request), link.launches)
    }

    @Test fun `background retention only starts after foreground lease promotion and stale stop cannot win`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        runCurrent()
        assertEquals(null, controller.requestWatch())
        controller.setVisible(true)
        val first = requireNotNull(controller.requestWatch())
        assertTrue(link.watchChanges.isEmpty())
        controller.stopWatch(first)
        assertFalse(controller.activateWatch(first))
        val second = requireNotNull(controller.requestWatch())
        controller.setVisible(false)
        assertTrue(controller.activateWatch(second))
        assertTrue(link.watchChanges.last())
        controller.stopWatch(first)
        assertTrue(controller.canOpenWatch(second))
        controller.stopWatch(second)
        assertFalse(link.watchChanges.last())
        assertFalse(controller.canOpenWatch(second))
    }

    @Test fun `goal actions require foreground current writable goal baseline and preserve expected identity`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        val goal = DesktopGoal("Run regressions", "active", 3)
        runCurrent()
        link.state.value = DesktopLinkState(phase = LinkPhase.Online, readOnly = false,
            catalog = listOf(DesktopTask("s", "Task", "Repo", status = "running")),
            session = DesktopSessionState(SessionTimeline("s"), loading = false, goal = goal, goalReady = true))
        runCurrent(); controller.selectSession("s")
        controller.goalAction("s", GoalCommand.Pause, goal, null)
        assertTrue(link.goals.isEmpty())
        controller.setVisible(true)
        controller.goalAction("other", GoalCommand.Clear, goal, null)
        controller.goalAction("s", GoalCommand.Pause, goal.copy(autoTurns = 2), null)
        assertTrue(link.goals.isEmpty())
        controller.goalAction("s", GoalCommand.Pause, goal, null)
        assertEquals(listOf(Triple(GoalCommand.Pause, goal, null)), link.goals)
        link.state.value = link.state.value.copy(readOnly = true)
        runCurrent(); controller.goalAction("s", GoalCommand.Clear, goal, null)
        assertEquals(1, link.goals.size)
        link.state.value = link.state.value.copy(readOnly = false,
            session = link.state.value.session!!.copy(goalReady = false))
        runCurrent(); controller.goalAction("s", GoalCommand.Set, goal, "Changed")
        assertEquals(1, link.goals.size)
        controller.selectSession(null)
        controller.goalAction("s", GoalCommand.Clear, goal, null)
        assertEquals(1, link.goals.size)
    }

    @Test fun `maintenance forwards only the visible synchronized baseline for the current session`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        val cursor = kotlinx.serialization.json.Json.parseToJsonElement("""{"epoch":"e","seq":1}""")
            as kotlinx.serialization.json.JsonObject
        val session = DesktopSessionState(SessionTimeline("s", cursor = cursor), loading = false)
        val baseline = requireNotNull(session.maintenanceBaseline)
        runCurrent()
        link.state.value = DesktopLinkState(phase = LinkPhase.Online, readOnly = false,
            catalog = listOf(DesktopTask("s", "Task", "Repo", status = "idle")), session = session)
        runCurrent(); controller.selectSession("s")
        controller.maintain("s", SessionMaintenanceCommand.Retry, baseline, null)
        assertTrue(link.maintenance.isEmpty())
        controller.setVisible(true)
        controller.maintain("s", SessionMaintenanceCommand.Retry, baseline.copy(maintenanceId = 4), null)
        assertTrue(link.maintenance.isEmpty())
        controller.maintain("s", SessionMaintenanceCommand.Retry, baseline, null)
        assertEquals(listOf(Triple(SessionMaintenanceCommand.Retry, baseline, null)), link.maintenance)
        link.state.value = link.state.value.copy(readOnly = true)
        runCurrent()
        controller.maintain("s", SessionMaintenanceCommand.Compact, baseline, "keep tests")
        assertEquals(1, link.maintenance.size)
        controller.selectSession(null)
        link.state.value = link.state.value.copy(readOnly = false)
        runCurrent()
        controller.maintain("s", SessionMaintenanceCommand.Compact, baseline, null)
        assertEquals(1, link.maintenance.size)
    }

    @Test fun `rewind is fenced by the visible baseline read-only state and current selection`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        val cursor = kotlinx.serialization.json.Json.parseToJsonElement("""{"epoch":"e","seq":1}""")
            as kotlinx.serialization.json.JsonObject
        val session = DesktopSessionState(SessionTimeline("s", cursor = cursor), loading = false)
        val baseline = requireNotNull(session.rewindBaseline)
        runCurrent()
        link.state.value = DesktopLinkState(phase = LinkPhase.Online, readOnly = false,
            catalog = listOf(DesktopTask("s", "Task", "Repo", status = "idle")), session = session)
        runCurrent(); controller.selectSession("s")
        controller.rewind("s", 2, true, baseline)
        assertTrue(link.rewinds.isEmpty())
        controller.setVisible(true)
        controller.rewind("s", 2, true, baseline.copy(rewindId = 9))
        assertTrue(link.rewinds.isEmpty())
        controller.rewind("s", 2, true, baseline)
        assertEquals(listOf(Triple(2L, true, baseline)), link.rewinds)
        link.state.value = link.state.value.copy(readOnly = true)
        runCurrent()
        controller.rewind("s", 0, false, baseline)
        assertEquals(1, link.rewinds.size)
    }

    @Test fun `terminal replacement clears service lease and disables retention`() = runTest {
        val link = Link(); val controller = controller(Store(credentials()), link)
        runCurrent(); controller.setVisible(true)
        val token = requireNotNull(controller.requestWatch())
        assertTrue(controller.activateWatch(token))
        link.state.value = DesktopLinkState(LinkPhase.Replaced)
        runCurrent()
        assertEquals(WatchPhase.Off, controller.state.value.watch.phase)
        assertFalse(link.watchChanges.last())
        assertFalse(controller.canOpenWatch(token))
    }
}
