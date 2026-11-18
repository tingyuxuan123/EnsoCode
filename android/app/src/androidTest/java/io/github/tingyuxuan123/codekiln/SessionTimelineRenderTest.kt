package io.github.tingyuxuan123.eaves

import android.graphics.Bitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.SessionHeader
import io.github.tingyuxuan123.eaves.ui.SessionScreen
import io.github.tingyuxuan123.eaves.ui.TimelineImage
import io.github.tingyuxuan123.eaves.ui.decodeTimelineImage
import java.io.ByteArrayOutputStream
import java.io.File
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.assertTrue

@RunWith(AndroidJUnit4::class)
class SessionTimelineRenderTest {
    @get:Rule val compose = createComposeRule()

    @Test fun oneWorklogKeepsTheAnswerVisibleAndRevealsInterleavedActivityOnDemand() {
        show(SessionMessage(0, "user", listOf(text("请验证这轮结果"))),
            SessionMessage(1, "assistant", listOf(text("我先检查连接。"))),
            SessionMessage(2, "toolResult", listOf(text("<background-task-update>\n第一条内部通知\n</background-task-update>\n连接失败")),
                toolName = "bash", isError = true),
            SessionMessage(3, "user", listOf(text("<background-task-update>\n第二条内部通知\n</background-task-update>"))),
            SessionMessage(4, "assistant", listOf(JsonObject(mapOf("type" to JsonPrimitive("thinking"), "text" to JsonPrimitive("重试连接"))))),
            SessionMessage(5, "toolResult", listOf(text("读到结果")), toolName = "read"),
            SessionMessage(6, "assistant", listOf(text("现在已经恢复。"))))

        compose.onAllNodesWithText("已工作").assertCountEquals(1)
        compose.onNodeWithText("1 段思考 · 2 次调用").assertIsDisplayed()
        compose.onNodeWithText("1 次调用失败").assertIsDisplayed()
        compose.onNodeWithText("现在已经恢复。").assertIsDisplayed()
        compose.onNodeWithText("我先检查连接。").assertDoesNotExist()
        compose.onAllNodesWithText("后台任务通知").assertCountEquals(0)

        compose.onNodeWithText("已工作").performClick()
        compose.onNodeWithText("我先检查连接。").assertIsDisplayed()
        compose.onAllNodesWithText("后台任务通知").assertCountEquals(2)
        compose.onNodeWithText("查看错误详情").performClick()
        compose.onNodeWithText("连接失败").assertIsDisplayed()
    }

    @Test fun expandedWorklogShowsDistinctToolTypesAndKeepsTheirDetailsAvailable() {
        fun call(name: String, key: String, value: String) = buildJsonObject {
            put("type", "toolCall"); put("id", name); put("name", name)
            putJsonObject("arguments") { put(key, value) }
        }
        show(SessionMessage(0, "assistant", listOf(
            buildJsonObject { put("type", "thinking"); put("text", "对照 PC 端工具图标") },
            call("read", "path", "docs/engineering-guidelines.md"),
            call("code_search", "description", "定位工具摘要行"),
            call("bash", "command", "./gradlew check"),
            call("web_fetch", "description", "读取官方文档"),
            call("task_output", "description", "读取后台任务结果"),
            call("apply_patch", "description", "更新图标映射"),
            text("安卓工作记录已对齐桌面图标。"),
        )))
        compose.onNodeWithText("已工作").performClick()
        for (row in listOf("思考 · 对照 PC 端工具图标", "read · docs/engineering-guidelines.md", "code_search · 定位工具摘要行",
            "bash · ./gradlew check", "web_fetch · 读取官方文档", "task_output · 读取后台任务结果", "apply_patch · 更新图标映射")) {
            compose.onNodeWithText(row).assertIsDisplayed()
        }
        if (InstrumentationRegistry.getArguments().getString("eavesWorklogIconsCapture") == "1") {
            compose.waitForIdle()
            val instrument = InstrumentationRegistry.getInstrumentation()
            val bitmap = requireNotNull(instrument.uiAutomation.takeScreenshot())
            try {
                File(instrument.targetContext.cacheDir, "worklog-icons.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            } finally { bitmap.recycle() }
        }
        compose.onNodeWithText("read · docs/engineering-guidelines.md").performClick()
        compose.onNodeWithText("docs/engineering-guidelines.md").assertIsDisplayed()
    }

    @Test fun todoStatusesAreVisibleAndTheAttachedBackgroundLogIsFoldedSeparately() {
        show(SessionMessage(0, "toolResult", listOf(text(
            "<background-task-update>\n诊断输出\n</background-task-update>\n\n" +
                "Todos (1/3 done):\n[x] 核对同步\n[~] 渲染待办\n[ ] 回归验证"
        )), toolName = "todo"), SessionMessage(1, "assistant", listOf(text("可继续回复。"))))
        compose.onNodeWithText("待办清单").assertIsDisplayed()
        compose.onNodeWithText("1/3").assertIsDisplayed()
        compose.onNodeWithContentDescription("已完成：核对同步").assertIsDisplayed()
        compose.onNodeWithContentDescription("进行中：渲染待办").assertIsDisplayed()
        compose.onNodeWithContentDescription("待处理：回归验证").assertIsDisplayed()
        compose.onNodeWithText("可继续回复。").assertIsDisplayed()
        compose.onNodeWithText("诊断输出").assertDoesNotExist()
        compose.onNodeWithText("已工作").performClick()
        compose.onNodeWithText("后台任务通知").performClick()
        compose.onNodeWithText("诊断输出").assertIsDisplayed()
    }

    @Test fun compactedContextAndFailedToolsShowSeparateCollapsedDetails() {
        show(SessionMessage(0, "compactionSummary", listOf(text("压缩后保留的信息"))),
            SessionMessage(1, "toolResult", listOf(text("编译诊断：权限不足")), toolName = "bash", isError = true))
        compose.onNodeWithText("上下文已压缩").performClick()
        compose.onNodeWithText("压缩后保留的信息").assertIsDisplayed()
        compose.onNodeWithText("编译诊断：权限不足").assertDoesNotExist()
        compose.onNodeWithText("执行记录").performClick()
        compose.onNodeWithText("查看错误详情").performClick()
        compose.onNodeWithText("编译诊断：权限不足").assertIsDisplayed()
    }

    @Test fun resultImagesDoNotDecodeAtUnboundedOriginalResolution() {
        for (width in listOf(2048, 3201)) {
            val source = Bitmap.createBitmap(width, 512, Bitmap.Config.ARGB_8888)
            val bytes = ByteArrayOutputStream().also { source.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
            source.recycle()
            val image = TimelineImage(java.util.Base64.getEncoder().encodeToString(bytes), "image/png")
            val decoded = requireNotNull(decodeTimelineImage(image))
            try { assertTrue("Decoded image exceeded preview bound: ${decoded.width}", decoded.width <= 1600) }
            finally { decoded.recycle() }
        }
    }

    private fun show(vararg messages: SessionMessage) {
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("时间线验收"), DesktopSessionState(SessionTimeline("s", messages = messages.toList()), loading = false),
                LinkPhase.Online, false, onDrawer = {}, onRetry = {}, onHistory = {}, onApproval = { _, _ -> }, onAsk = { _, _ -> })
        } }
    }

    private fun text(value: String) = JsonObject(mapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive(value)))
}
