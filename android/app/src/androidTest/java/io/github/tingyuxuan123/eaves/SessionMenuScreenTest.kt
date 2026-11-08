package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopContextUsage
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.DesktopUsageTotals
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.SessionHeader
import io.github.tingyuxuan123.eaves.ui.SessionScreen
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionMenuScreenTest {
    @get:Rule val compose = createComposeRule()
    private val cursor = Json.parseToJsonElement("""{"epoch":"e1","seq":3}""") as JsonObject
    private val timeline = SessionTimeline("menu-session", cursor = cursor, status = "idle")
    private val baseline = MaintenanceBaseline("e1", null, null)
    private val idle = DesktopSessionState(timeline, loading = false,
        context = DesktopContextUsage(76_000, 200_000), usage = DesktopUsageTotals(1_200_000, 50_000, 81))

    @Test fun menuShowsOnlyDesktopReportedUsageAndNeverInvitesAWindow() {
        val state = mutableStateOf(idle)
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("菜单测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> }, onMaintain = { _, _, _ -> })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("76K / 200K").assertIsDisplayed()
        compose.onNodeWithText("38%").assertIsDisplayed()
        compose.onNodeWithText("1.25M").assertIsDisplayed()
        compose.onNodeWithText("81%").assertIsDisplayed()
        compose.runOnIdle { state.value = idle.copy(context = DesktopContextUsage(4_096), usage = null) }
        compose.onNodeWithText("4K / 未知窗口").assertIsDisplayed()
        compose.onNodeWithText("总用量").assertDoesNotExist()
    }

    @Test fun retryIsOfferedOnlyForIdleSyncedSessionsAndSendsTheVisibleBaseline() {
        val actions = mutableListOf<Triple<SessionMaintenanceCommand, MaintenanceBaseline, String?>>()
        val state = mutableStateOf(idle.copy(timeline = timeline.copy(status = "running")))
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("菜单测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onMaintain = { command, captured, text -> actions.add(Triple(command, captured, text)) })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("重试上一轮").assertIsNotEnabled()
        compose.runOnIdle { state.value = idle }
        compose.onNodeWithText("重试上一轮").assertIsEnabled().performClick()
        assertEquals(listOf(Triple(SessionMaintenanceCommand.Retry, baseline, null)), actions)
    }

    @Test fun compactSendsTrimmedOptionalInstructionsAndReportsDesktopProgress() {
        val actions = mutableListOf<Triple<SessionMaintenanceCommand, MaintenanceBaseline, String?>>()
        val state = mutableStateOf(idle)
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("菜单测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onMaintain = { command, captured, text -> actions.add(Triple(command, captured, text)) })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("压缩上下文").performClick()
        compose.onNodeWithContentDescription("压缩要求（可选）").performTextInput("  只保留测试与结论  ")
        compose.onNodeWithText("开始压缩").performClick()
        assertEquals(listOf(Triple(SessionMaintenanceCommand.Compact, baseline, "只保留测试与结论")), actions)
        compose.runOnIdle { state.value = idle.copy(compaction = io.github.tingyuxuan123.eaves.mirror.DesktopCompaction("queued")) }
        compose.onNodeWithText("桌面已排队，等本轮结束后压缩。").assertIsDisplayed()
        compose.onNodeWithText("开始压缩").assertIsEnabled()
    }

    @Test fun rewindOffersOnlyRealUserMessagesAndSendsTheChosenIndexWithRestoreChoice() {
        val actions = mutableListOf<Triple<Long, Boolean, MaintenanceBaseline>>()
        fun text(index: Long, role: String, body: String) = io.github.tingyuxuan123.eaves.pair.SessionMessage(index, role, listOf(
            buildJsonObject { put("type", "text"); put("text", body) }))
        val history = timeline.copy(messages = listOf(
            text(0, "user", "第一条用户消息"),
            text(1, "assistant", "助手的回答"),
            text(2, "user", "第二条用户消息"),
        ))
        val state = mutableStateOf(idle.copy(timeline = history))
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("菜单测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onRewind = { index, restore, _ -> actions.add(Triple(index, restore, baseline)) })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("回退到某条消息").performClick()
        compose.onNodeWithText("回退到这条消息之前").assertIsDisplayed()
        // Candidate filtering (user-only, index from the end) is covered by RewindCandidatesTest.
        compose.onNodeWithTag("rewind-0").assertIsDisplayed()
        compose.onNodeWithTag("rewind-1").assertIsDisplayed()
        compose.onNodeWithText("回退到这里").assertIsEnabled().performClick()
        assertEquals(0L, actions.single().first)
        assertEquals(false, actions.single().second)
        compose.onNodeWithText("同时恢复文件").performClick()
        compose.onNodeWithText("回退并恢复文件").performClick()
        assertEquals(0L, actions.last().first)
        assertEquals(true, actions.last().second)
    }

    @Test fun tasksPanelListsRealSubagentsAndBackgroundTasksAndConfirmsStopOnce() {
        val actions = mutableListOf<Pair<io.github.tingyuxuan123.eaves.mirror.SessionTaskKind, String>>()
        val running = timeline.copy(
            subagents = listOf(io.github.tingyuxuan123.eaves.pair.SessionSubagent(
                "a1", "调研 IPC 通道注册", "running", 2, "grep handlers", agentType = "scout")),
            backgroundTasks = listOf(io.github.tingyuxuan123.eaves.pair.SessionBackgroundTask(
                "t1", "pnpm dev", "running", "listening on 5173")),
        )
        val state = mutableStateOf(idle.copy(timeline = running))
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("菜单测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onStopTask = { kind, target, _ -> actions.add(kind to target) })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("后台与协作").performClick()
        compose.onNodeWithText("调研 IPC 通道注册").assertIsDisplayed()
        compose.onNodeWithText("pnpm dev").assertIsDisplayed()
        compose.onNodeWithContentDescription("停止 调研 IPC 通道注册").performClick()
        compose.onNodeWithText("确认停止").performClick()
        assertEquals(listOf(io.github.tingyuxuan123.eaves.mirror.SessionTaskKind.Subagent to "a1"), actions)
        compose.runOnIdle { state.value = idle.copy(timeline = running.copy(
            subagents = emptyList(),
            backgroundTasks = listOf(running.backgroundTasks.single().copy(status = "done")))) }
        compose.onNodeWithText("调研 IPC 通道注册").assertDoesNotExist()
        compose.onNodeWithContentDescription("停止 调研 IPC 通道注册").assertDoesNotExist()
    }

    @Test fun artifactBrowserListsHostFilesOpensTextAndPagesThroughChunks() {
        val reads = mutableListOf<Pair<String, Long>>()
        var lists = 0
        val empty = io.github.tingyuxuan123.eaves.mirror.DesktopFilesState()
        val body = "# 檐下\nhello".toByteArray()
        val state = mutableStateOf(idle.copy(files = empty))
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("菜单测试"), state.value, LinkPhase.Online, true,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onListFiles = { lists++ }, onReadFile = { id, offset -> reads.add(id to offset) })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("产物与文件").performClick()
        compose.onNodeWithText("这个会话还没有可浏览的产物。").assertIsDisplayed()
        compose.runOnIdle { state.value = idle.copy(files = empty.copy(entries = listOf(
            io.github.tingyuxuan123.eaves.mirror.DesktopFileEntry("f1", "README.md", 2_048, "README.md"),
            io.github.tingyuxuan123.eaves.mirror.DesktopFileEntry("f2", "logo.png", 900, "assets/logo.png"),
        ))) }
        compose.onNodeWithText("README.md").assertIsDisplayed()
        compose.onNodeWithText("README.md · 2 KB").assertIsDisplayed()
        compose.onNodeWithText("README.md").performClick()
        assertEquals(listOf("f1" to 0L), reads)
        compose.runOnIdle { state.value = idle.copy(files = empty.copy(
            entries = state.value.files!!.entries,
            chunk = io.github.tingyuxuan123.eaves.mirror.DesktopFileChunk(
                "f1", "README.md", 6_000, 0, body))) }
        compose.onNodeWithText("# 檐下\nhello").assertIsDisplayed()
        compose.onNodeWithText("加载更多").performClick()
        assertEquals("f1" to body.size.toLong(), reads.last())
        // Read-only connections may browse; nothing in this sheet writes to the workspace.
        compose.onNodeWithText("返回列表").performClick()
        compose.onNodeWithText("assets/logo.png · 900 B").assertIsDisplayed()
        assertEquals(0, lists)
    }

    @Test fun previewListsPagesOpensWithBoundedViewportAndForwardsTapsKeysAndText() {
        var opened: Triple<String, Int, Int>? = null
        val inputs = mutableListOf<io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput>()
        val actions = mutableListOf<io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction>()
        val png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        val state = mutableStateOf(idle.copy(preview = io.github.tingyuxuan123.eaves.mirror.DesktopPreviewState(
            entries = listOf(io.github.tingyuxuan123.eaves.mirror.DesktopPreviewEntry("e1", "localhost:5173", "server")))))
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("菜单测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onListPreviews = { },
                onOpenPreview = { id, w, h -> opened = Triple(id, w, h) },
                onPreviewAction = { actions.add(it) },
                onPreviewInput = { inputs.add(it) })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("网页预览").performClick()
        compose.onNodeWithText("localhost:5173").performClick()
        val (entryId, width, height) = requireNotNull(opened)
        assertEquals("e1", entryId)
        assertEquals(true, width in 320..1280)
        assertEquals(true, height in 240..1200)
        compose.runOnIdle { state.value = idle.copy(preview = state.value.preview!!.copy(
            previewId = "p1", frame = io.github.tingyuxuan123.eaves.mirror.DesktopPreviewFrame(
                "f1", 100, 100, "data:image/png;base64,$png", "预览页"))) }
        compose.onNodeWithContentDescription("网页预览画面").assertIsDisplayed().performClick()
        val click = inputs.filterIsInstance<io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput.Click>().single()
        assertEquals(true, click.x in 0..100 && click.y in 0..100)
        compose.onNodeWithContentDescription("回车").performClick()
        compose.onNodeWithContentDescription("发到页面的文字").performTextInput("hello")
        compose.onNodeWithContentDescription("发送到页面").performClick()
        assertEquals(io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput.Key("Enter"), inputs[1])
        assertEquals(io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput.Text("hello"), inputs[2])
        compose.onNodeWithContentDescription("刷新预览").performClick()
        assertEquals(io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction.Refresh, actions.single())
    }
}
