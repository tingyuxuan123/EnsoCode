package io.github.tingyuxuan123.eaves

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopTask
import io.github.tingyuxuan123.eaves.ui.BoardScreen
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Calendar

@RunWith(AndroidJUnit4::class)
class BoardScreenTest {
    @get:Rule val compose = createComposeRule()
    private val now = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 12); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis
    private val minute = 60_000L

    @Test fun waitingRunningAndDoneTasksAreGroupedFromRealCatalogFields() {
        var opened: String? = null
        val tasks = listOf(
            DesktopTask("wait", "会话恢复后时间线为空", "Eaves", now - 5 * minute, "running",
                pendingApprovalCount = 2, projectId = "p1"),
            DesktopTask("run", "首页 Hero 用哪张截图", "Eaves", now - 40 * minute, "running", projectId = "p1"),
            DesktopTask("done", "解释 apply_patch 的格式", "Eaves", now - 90 * minute, "idle", projectId = "p1"),
            DesktopTask("old", "昨天的任务", "Eaves", now - 26 * 60 * minute, "idle", projectId = "p1"),
            DesktopTask("archived", "归档任务", "Eaves", now - minute, "running", archived = true, projectId = "p1"),
        )
        compose.setContent { EnsoTheme { BoardScreen(tasks, now, onBack = {}, onTask = { opened = it }) } }
        compose.onNodeWithText("等你处理").assertIsDisplayed()
        compose.onNodeWithText("会话恢复后时间线为空").assertIsDisplayed()
        compose.onNodeWithText("2 个操作待审批").assertIsDisplayed()
        compose.onNodeWithText("运行中").assertIsDisplayed()
        compose.onNodeWithText("首页 Hero 用哪张截图").assertIsDisplayed()
        compose.onNodeWithText("今天完成").assertIsDisplayed()
        compose.onNodeWithText("解释 apply_patch 的格式").assertIsDisplayed()
        compose.onNodeWithText("昨天的任务").assertDoesNotExist()
        compose.onNodeWithText("归档任务").assertDoesNotExist()
        compose.onNodeWithText("会话恢复后时间线为空").performClick()
        assertEquals("wait", opened)
        compose.onNodeWithContentDescription("返回新任务").performClick()
    }

    @Test fun emptyCatalogKeepsHonestPlaceholdersInsteadOfFakeProgress() {
        compose.setContent { EnsoTheme { BoardScreen(emptyList(), now, onBack = {}, onTask = {}) } }
        compose.onNodeWithText("没有被卡住的请求").assertIsDisplayed()
        compose.onNodeWithText("没有正在运行的任务").assertIsDisplayed()
        compose.onNodeWithText("今天还没有完成的任务").assertIsDisplayed()
        compose.onNodeWithText("子代理与后台任务需在会话内查看（尚未接入）。").assertIsDisplayed()
    }
}
