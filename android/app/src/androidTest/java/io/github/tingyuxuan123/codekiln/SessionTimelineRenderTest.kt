package io.github.tingyuxuan123.codekiln

import android.graphics.Bitmap
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.DesktopFilesState
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.pair.SessionMessage
import io.github.tingyuxuan123.codekiln.pair.SessionTimeline
import io.github.tingyuxuan123.codekiln.ui.EnsoTheme
import io.github.tingyuxuan123.codekiln.ui.SessionHeader
import io.github.tingyuxuan123.codekiln.ui.SessionScreen
import io.github.tingyuxuan123.codekiln.ui.TimelineImage
import io.github.tingyuxuan123.codekiln.ui.decodeTimelineImage
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
        if (InstrumentationRegistry.getArguments().getString("codekilnWorklogIconsCapture") == "1") {
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

    @Test fun incompleteWorklogKeepsStepsVisibleLikeDesktopButDetailsStillCollapse() {
        show(SessionMessage(0, "compactionSummary", listOf(text("压缩后保留的信息"))),
            SessionMessage(1, "toolResult", listOf(text("编译诊断：权限不足")), toolName = "bash", isError = true))
        compose.onNodeWithText("上下文已压缩").performClick()
        compose.onNodeWithText("压缩后保留的信息").assertIsDisplayed()
        compose.onNodeWithText("编译诊断：权限不足").assertDoesNotExist()
        compose.onNodeWithText("查看错误详情").performClick()
        compose.onNodeWithText("编译诊断：权限不足").assertIsDisplayed()
    }

    @Test fun longUserBubbleExpandsAndReplyShowsTheModelThatActuallyAnswered() {
        val prompt = (1..13).joinToString("\n") { "第 $it 行用户消息" }
        show(SessionMessage(0, "user", listOf(text(prompt))),
            SessionMessage(1, "assistant", listOf(text("这是一条历史回复。")), model = "historical-model"))
        compose.onNodeWithText("historical-model").assertIsDisplayed()
        compose.onNodeWithContentDescription("展开用户消息").performClick()
        compose.onNodeWithContentDescription("收起用户消息").performClick()
        compose.onNodeWithContentDescription("展开用户消息").assertIsDisplayed()
    }

    @Test fun liveWorkingFooterShowsTheEditedFileAndElapsedTimeOnlyWhileWorking() {
        val messages = listOf(SessionMessage(0, "user", listOf(text("补齐附件下载的边界测试。"))),
            SessionMessage(1, "toolResult", listOf(text("已修改")), toolName = "apply_patch",
                toolFileName = "ConversationDeliveryTest.kt"))
        val running = SessionTimeline("s", messages = messages, status = "running")
        val state = mutableStateOf(DesktopSessionState(running, loading = false))
        compose.setContent { EnsoTheme(dark = false) {
            SessionScreen(SessionHeader("附件下载验收", "CodeKiln"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> })
        } }
        val work = compose.onNodeWithContentDescription("工作状态：确认 ConversationDeliveryTe", substring = true)
        work.assertIsDisplayed()
        val clock = compose.onAllNodesWithText(" 秒", substring = true, useUnmergedTree = true)
        fun clockText() = clock.fetchSemanticsNodes().singleOrNull()?.config?.get(SemanticsProperties.Text)?.single()?.text
        val initial = requireNotNull(clockText()) { "Expected a visible elapsed timer" }
        compose.waitUntil(timeoutMillis = 8_000) { clockText()?.let { it != initial } == true }
        if (InstrumentationRegistry.getArguments().getString("codekilnWorkingCapture") == "1") {
            val instrument = InstrumentationRegistry.getInstrumentation()
            val bitmap = requireNotNull(instrument.uiAutomation.takeScreenshot())
            try {
                File(instrument.targetContext.cacheDir, "working-status.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            } finally { bitmap.recycle() }
        }
        compose.runOnIdle { state.value = state.value.copy(timeline = running.copy(status = "idle")) }
        work.assertDoesNotExist()
        clock.assertCountEquals(0)
    }

    @Test fun desktopStyleReplyKeepsWideImageAndClickableArtifactsInTheReadingColumn() {
        val image = Bitmap.createBitmap(480, 180, Bitmap.Config.ARGB_8888).apply {
            eraseColor(0xffe3efe9.toInt())
            android.graphics.Canvas(this).apply {
                val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
                paint.color = 0xff27463c.toInt()
                paint.textSize = 26f
                drawText("Conversation sync check", 28f, 62f, paint)
                paint.color = 0xff5c947f.toInt()
                drawRect(28f, 92f, 428f, 108f, paint)
                drawRect(28f, 121f, 306f, 137f, paint)
            }
        }
        val bytes = ByteArrayOutputStream().also { image.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        image.recycle()
        val file = DesktopFileEntry("f1", "验收报告.pdf", 24_600, "out/验收报告.pdf")
        val messages = listOf(
            SessionMessage(0, "user", listOf(text("把移动端会话和 PC 对齐，验收后发我截图和报告。")), 1_790_000_000_000),
            SessionMessage(1, "assistant", listOf(buildJsonObject {
                put("type", "thinking"); put("text", "对照 PC 的会话内容和附件入口")
            }), 1_790_000_015_000, model = "example-model"),
            SessionMessage(2, "toolResult", listOf(buildJsonObject {
                put("type", "image"); put("mimeType", "image/png")
                put("data", java.util.Base64.getEncoder().encodeToString(bytes))
            }), toolName = "read"),
            SessionMessage(3, "assistant", listOf(text("## 会话验收\n\n已对齐正文、工作记录和产物。\n\n- 图片保留原比例\n- [查看验收报告](out/验收报告.pdf)"))),
        )
        val state = DesktopSessionState(SessionTimeline("s", messages = messages, status = "idle"),
            loading = false, files = DesktopFilesState(entries = listOf(file)))
        val opened = mutableListOf<String>()
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("会话样式验收", "CodeKiln"), state, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> }, onListFiles = {}, onReadFile = { id, _ -> opened += id })
        } }
        val preview = compose.onNodeWithContentDescription("查看图片 1").assertIsDisplayed().fetchSemanticsNode()
        val bounds = preview.boundsInRoot
        assertTrue("Expected the original panoramic shape, not a square crop", bounds.width / bounds.height > 2.4f)
        compose.onNodeWithText("example-model").assertIsDisplayed()
        compose.onNodeWithText("本轮产物").assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("codekilnConversationCapture") == "1") {
            compose.waitForIdle()
            val instrument = InstrumentationRegistry.getInstrumentation()
            val bitmap = requireNotNull(instrument.uiAutomation.takeScreenshot())
            try {
                File(instrument.targetContext.cacheDir, "conversation-pc-aligned.png").outputStream().use {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
                }
            } finally { bitmap.recycle() }
        }
        compose.onNodeWithText(file.name).performClick()
        assertTrue(opened == listOf("f1"))
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
