package io.github.tingyuxuan123.eaves

import android.graphics.Bitmap
import android.content.Intent
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Debug-only specimen capture waits for Markdown parsing, not an arbitrary startup delay. */
@RunWith(AndroidJUnit4::class)
class SessionDesignCaptureTest {
    @get:Rule val compose = createEmptyComposeRule()
    @Test fun capture() {
        val frame = InstrumentationRegistry.getArguments().getString("eavesDesignFrame")
        assumeTrue(frame in setOf("session", "ask", "new-config", "queue", "members", "group", "bot"))
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = Intent(context, DesignPreviewActivity::class.java).putExtra("frame", frame)
        ActivityScenario.launch<DesignPreviewActivity>(intent).use {
            val marker = when (frame) {
                "new-config" -> "新任务设置"
                "ask" -> "官网 Hero 是白底"
                "queue" -> "排队中 · 3 条"
                "members" -> "5 位成员 · 1 个群聊"
                "group" -> "Firebase 控制台"
                "bot" -> "回归报告.md"
                else -> "根因在 renderer"
            }
            compose.waitUntil(12_000) { compose.onAllNodesWithText(marker, substring = true).fetchSemanticsNodes().isNotEmpty() }
            compose.waitForIdle()
            val bitmap = if (frame in setOf("new-config", "members", "group", "bot")) requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
                else compose.onRoot().captureToImage().asAndroidBitmap()
            try {
                File(context.cacheDir, "design-$frame.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            } finally { bitmap.recycle() }
        }
    }
}
