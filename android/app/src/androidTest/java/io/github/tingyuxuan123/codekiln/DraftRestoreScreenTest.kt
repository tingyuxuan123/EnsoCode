package io.github.tingyuxuan123.codekiln

import androidx.activity.compose.setContent
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.codekiln.mirror.DesktopLinkState
import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.mirror.DraftKey
import io.github.tingyuxuan123.codekiln.mirror.DraftKind
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.pair.SessionTimeline
import io.github.tingyuxuan123.codekiln.ui.EnsoTheme
import io.github.tingyuxuan123.codekiln.ui.NewTaskUiState
import io.github.tingyuxuan123.codekiln.ui.TaskStatus
import io.github.tingyuxuan123.codekiln.ui.TaskSummary
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** A session's composer text comes back when the same session is opened again in the same process. */
@RunWith(AndroidJUnit4::class)
class DraftRestoreScreenTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private val key = DraftKey(DraftKind.Session, "s1")
    private val cursor = Json.parseToJsonElement("""{"epoch":"e1","seq":1}""") as JsonObject
    private val timeline = SessionTimeline("s1", cursor = cursor, status = "idle")

    @Test fun draftIsRestoredForItsSessionAndEditsAreReportedForThatSessionOnly() {
        val drafts = mutableStateOf(mapOf<DraftKey, String>(key to "恢复的草稿"))
        val edits = mutableListOf<Pair<DraftKey, String>>()
        compose.activityRule.scenario.onActivity { activity ->
            activity.setContent { EnsoTheme {
                CodeKilnApp(initialRoute = CodeKilnRoute.Home,
                    state = NewTaskUiState(online = true, tasks = listOf(
                        TaskSummary("s1", "任务一", null, "刚刚", TaskStatus.Idle))),
                    live = DesktopLinkState(LinkPhase.Online, "书房电脑", readOnly = false,
                        session = DesktopSessionState(timeline, loading = false)),
                    drafts = drafts.value,
                    onDraftEdit = { target, text ->
                        edits += target to text
                        drafts.value = drafts.value + (target to text)
                    },
                    onSelectSession = {})
            } }
        }
        compose.onNodeWithTag("task-s1").performClick()
        compose.onNodeWithText("恢复的草稿").assertIsDisplayed()
        compose.onNodeWithContentDescription("会话消息").performTextReplacement("改成新的说明")
        compose.runOnIdle { assertEquals(key to "改成新的说明", edits.last()) }
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithTag("task-s1").assertIsDisplayed()
        compose.onNodeWithTag("task-s1").performClick()
        compose.onNodeWithText("改成新的说明").assertIsDisplayed()
        // Leave no IME behind: a lingering keyboard would shift the layout of later tests in the same run.
        compose.activityRule.scenario.onActivity { activity ->
            WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                .hide(WindowInsetsCompat.Type.ime())
        }
    }
}
