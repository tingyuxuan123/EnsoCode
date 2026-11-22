package io.github.tingyuxuan123.codekiln

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.codekiln.ui.EnsoTheme
import io.github.tingyuxuan123.codekiln.ui.LocalConversationLink
import io.github.tingyuxuan123.codekiln.ui.SessionLink
import io.github.tingyuxuan123.codekiln.ui.SessionMarkdown
import io.github.tingyuxuan123.codekiln.ui.SessionHeader
import io.github.tingyuxuan123.codekiln.ui.SessionScreen
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileChunk
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.DesktopFilesState
import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.mirror.SessionImageTarget
import io.github.tingyuxuan123.codekiln.pair.SessionMessage
import io.github.tingyuxuan123.codekiln.pair.SessionTimeline
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ConversationDeliveryScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun closingAndReopeningDownloadPanelDoesNotStopOrRefetchTheFile() {
        val requested = AtomicInteger()
        val release = CompletableDeferred<Unit>()
        val file = DesktopFileEntry("apk-1", "app-debug.apk", 393_220, "out/app-debug.apk")
        val state = DesktopSessionState(SessionTimeline("s", messages = listOf(SessionMessage(1, "assistant",
            listOf(buildJsonObject { put("type", "text"); put("text", "[下载安卓版](out/app-debug.apk)") }))), status = "idle"),
            loading = false, files = DesktopFilesState(entries = listOf(file)))
        val unsolicitedSave = AtomicReference<Intent?>()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action != Intent.ACTION_CREATE_DOCUMENT) return null
                unsolicitedSave.set(intent)
                return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
            }
        }
        instrumentation.addMonitor(monitor)
        try {
            compose.setContent { EnsoTheme {
                SessionScreen(SessionHeader("APK 下载测试"), state, LinkPhase.Online, true, {}, {}, {}, { _, _ -> }, { _, _ -> },
                    onListFiles = {}, fetchFile = { id, offset ->
                        requested.incrementAndGet()
                        if (offset != 0L) release.await()
                        DesktopFileChunk(id, file.name, file.size, offset, ByteArray(if (offset == 0L) 393_216 else 4))
                    })
            } }
            compose.onNodeWithText(file.name).performClick()
            compose.waitUntil(5_000) { requested.get() == 2 }
            compose.onNodeWithContentDescription("关闭面板").performClick()
            compose.onNodeWithText("正在下载 · 99%").assertExists()
            compose.onNodeWithText(file.name).performClick()
            compose.onNodeWithContentDescription("关闭面板").performClick()
            release.complete(Unit)
            compose.waitUntil(5_000) { compose.onAllNodesWithText("已下载").fetchSemanticsNodes().isNotEmpty() }
            assertEquals(null, unsolicitedSave.get())
            compose.onNodeWithText(file.name).performClick()
            compose.onNodeWithText("保存文件").performClick()
            compose.waitUntil(5_000) { unsolicitedSave.get() != null }
            assertEquals(2, requested.get())
        } finally {
            release.complete(Unit)
            instrumentation.removeMonitor(monitor)
        }
    }

    @Test fun bareWebAddressAndMarkdownLocalLinkGoToDifferentOpeners() {
        val web = mutableListOf<String>()
        val local = mutableListOf<SessionLink>()
        val handler = object : UriHandler { override fun openUri(uri: String) { web.add(uri) } }
        compose.setContent {
            EnsoTheme {
                CompositionLocalProvider(LocalUriHandler provides handler,
                    LocalConversationLink provides { local.add(it); true }) {
                    Column {
                        SessionMarkdown("https://example.org/demo")
                        SessionMarkdown("[本地服务](http://localhost:5173/demo)")
                    }
                }
            }
        }
        compose.onNodeWithText("https://example.org/demo", useUnmergedTree = true).performTouchInput { click(Offset(8f, center.y)) }
        compose.onNodeWithText("本地服务", useUnmergedTree = true).performTouchInput { click(Offset(8f, center.y)) }
        compose.runOnIdle {
            assertEquals(listOf("https://example.org/demo"), web)
            assertEquals(listOf(SessionLink.Preview("http://127.0.0.1:5173/demo", "server")), local)
        }
    }

    @Test fun replyPdfIsOpenedAsReadOnlyContentOnlyAfterBothChunks() {
        val opened = AtomicReference<Intent?>()
        val offsets = mutableListOf<Long>()
        val file = DesktopFileEntry("file-1", "report.pdf", 5, "out/report.pdf")
        val reply = SessionMessage(1, "assistant", listOf(buildJsonObject {
            put("type", "text"); put("text", "已完成：[下载报告](out/report.pdf)")
        }))
        val state = DesktopSessionState(SessionTimeline("s", messages = listOf(reply), status = "idle"),
            loading = false, files = DesktopFilesState(entries = listOf(file)))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action != Intent.ACTION_VIEW || intent.type != "application/pdf") return null
                opened.set(intent)
                return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
            }
        }
        instrumentation.addMonitor(monitor)
        try {
            compose.setContent {
                EnsoTheme {
                    SessionScreen(SessionHeader("产物测试"), state, LinkPhase.Online, true, {}, {}, {}, { _, _ -> }, { _, _ -> },
                        onListFiles = {}, fetchFile = { id, offset ->
                            offsets += offset
                            DesktopFileChunk(id, file.name, file.size, offset,
                                if (offset == 0L) byteArrayOf(1, 2) else byteArrayOf(3, 4, 5))
                        })
                }
            }
            compose.onNodeWithText(file.name).performClick()
            compose.onNodeWithText("打开文件").assertExists()
            compose.waitUntil(timeoutMillis = 5_000) { opened.get() != null }
            val intent = requireNotNull(opened.get())
            val bytes = requireNotNull(instrumentation.targetContext.contentResolver.openInputStream(requireNotNull(intent.data)))
                .use { it.readBytes() }
            assertEquals(listOf(0L, 2L), offsets)
            assertEquals("content", intent.data?.scheme)
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION, intent.flags)
            assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), bytes)
        } finally {
            instrumentation.removeMonitor(monitor)
        }
    }

    @Test fun markdownApkLinkDownloadsTheWholeFileWithoutOpeningTheInstallerOrPagedPreview() {
        val save = AtomicReference<Intent?>()
        val offsets = mutableListOf<Long>()
        val previews = mutableListOf<Long>()
        val file = DesktopFileEntry("apk-1", "app-debug.apk", 393_220, "out/app-debug.apk")
        val reply = SessionMessage(1, "assistant", listOf(buildJsonObject {
            put("type", "text"); put("text", "[下载安卓版](out/app-debug.apk)")
        }))
        val state = DesktopSessionState(SessionTimeline("s", messages = listOf(reply), status = "idle"),
            loading = false, files = DesktopFilesState(entries = listOf(file)))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val monitor = object : Instrumentation.ActivityMonitor() {
            override fun onStartActivity(intent: Intent): Instrumentation.ActivityResult? {
                if (intent.action !in setOf(Intent.ACTION_CREATE_DOCUMENT, Intent.ACTION_VIEW)) return null
                save.set(intent)
                return Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
            }
        }
        instrumentation.addMonitor(monitor)
        try {
            compose.setContent { EnsoTheme {
                SessionScreen(SessionHeader("APK 下载测试"), state, LinkPhase.Online, true, {}, {}, {}, { _, _ -> }, { _, _ -> },
                    onListFiles = {}, onReadFile = { _, offset -> previews += offset }, fetchFile = { id, offset ->
                        offsets += offset
                        DesktopFileChunk(id, file.name, file.size, offset, ByteArray(if (offset == 0L) 393_216 else 4))
                    })
            } }
            compose.onNodeWithText("下载安卓版", useUnmergedTree = true).performTouchInput { click(Offset(8f, center.y)) }
            compose.waitUntil(timeoutMillis = 5_000) { save.get() != null }
            val intent = requireNotNull(save.get())
            assertEquals(Intent.ACTION_CREATE_DOCUMENT, intent.action)
            assertEquals("application/vnd.android.package-archive", intent.type)
            assertEquals(file.name, intent.getStringExtra(Intent.EXTRA_TITLE))
            assertEquals(listOf(0L, 393_216L), offsets)
            assertEquals(emptyList<Long>(), previews)
            compose.onNodeWithText("加载更多").assertDoesNotExist()
        } finally {
            instrumentation.removeMonitor(monitor)
        }
    }

    @Test fun restoredToolImageIsShownAndCanBeOpened() {
        val calls = mutableListOf<SessionImageTarget>()
        val read = SessionMessage(0, "assistant", listOf(buildJsonObject {
            put("type", "toolCall"); put("id", "read-1"); put("name", "read")
            put("arguments", JsonObject(mapOf("path" to JsonPrimitive("/tmp/image.png"))))
        }))
        val result = SessionMessage(1, "toolResult", listOf(buildJsonObject {
            put("type", "text"); put("text", "图片已读取")
        }), toolCallId = "read-1", toolName = "read")
        val state = DesktopSessionState(SessionTimeline("s", messages = listOf(read, result), status = "idle"), loading = false)
        val png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("图片测试"), state, LinkPhase.Online, true, {}, {}, {}, { _, _ -> }, { _, _ -> },
                onLoadImage = { target -> calls += target; "data:image/png;base64,$png" })
        } }
        compose.onNodeWithContentDescription("查看图片 1").performClick()
        compose.onNodeWithContentDescription("图片大图").assertExists()
        assertEquals(listOf(SessionImageTarget.Read("read-1")), calls)
    }
}
