package io.github.tingyuxuan123.codekiln

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.Lifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.codekiln.mirror.AndroidPairCredentialStore
import io.github.tingyuxuan123.codekiln.mirror.AndroidTextDraftStore
import io.github.tingyuxuan123.codekiln.mirror.DraftKey
import io.github.tingyuxuan123.codekiln.mirror.DraftKind
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in only: the original desktop-smoke driver owns the isolated profile, relay and pairing. */
@RunWith(AndroidJUnit4::class)
class FirstBatchLoopbackTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val args get() = InstrumentationRegistry.getArguments()
    private val codeText = "Independent_Code_Draft_未发送_1487"
    private val newText = "Independent_New_Task_未创建_1487"

    private fun guard(): Pair<String, String> {
        val expected = args.getString("codekilnDesktopExpectedId")
        val taskId = args.getString("codekilnDesktopTaskId")
        assumeTrue("Only disposable loopback desktop acceptance", BuildConfig.DEBUG && expected != null && taskId != null)
        val credentials = requireNotNull(AndroidPairCredentialStore(context, allowLoopbackHttp = true).load())
        require(credentials.pairId == expected && credentials.relayUrl.startsWith("http://127.0.0.1:"))
        return requireNotNull(expected) to requireNotNull(taskId)
    }

    private fun openTask(taskId: String) {
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.waitUntil(45_000) { compose.onAllNodes(hasTestTag("task-$taskId")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("task-$taskId").performScrollTo().performClick()
    }

    @Test fun verifyPairedSettingsAndSaveUnsentDrafts() {
        val (pairId, taskId) = guard()
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithContentDescription("设置").performClick()
        compose.onNodeWithText("设备与通知").assertIsDisplayed()
        compose.waitUntil(45_000) {
            (compose.activity.application as CodeKilnApplication).companion.state.value.link.hostName != null
        }
        val hostname = requireNotNull((compose.activity.application as CodeKilnApplication).companion.state.value.link.hostName)
        compose.onNodeWithText(hostname).assertIsDisplayed()
        compose.onNodeWithText("可操作").assertIsDisplayed()
        compose.onNodeWithText("解绑这台手机").performScrollTo().performClick()
        compose.onNodeWithText("取消").performClick()
        assertEquals(pairId, AndroidPairCredentialStore(context, allowLoopbackHttp = true).load()?.pairId)
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithTag("task-$taskId").performScrollTo().performClick()
        compose.onNodeWithContentDescription("会话消息").performTextReplacement(codeText)
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithTag("task-$taskId").performScrollTo().performClick()
        compose.onNodeWithText(codeText).assertIsDisplayed()
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithContentDescription("关闭").performClick()
        compose.onNodeWithContentDescription("任务描述").performTextReplacement(newText)
        // Triggers the actual MainActivity.onStop flush, without waiting for the 250ms debounce.
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        val saved = AndroidTextDraftStore(context).load(pairId)
        assertEquals(codeText, saved[DraftKey(DraftKind.Session, taskId)])
        assertEquals(newText, saved[DraftKey(DraftKind.NewTask, "new-task")])
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
    }

    @Test fun verifyUnsentDraftsAfterProcessRestartAndClearThemWithoutSending() {
        val (_, taskId) = guard()
        compose.waitUntil(45_000) {
            (compose.activity.application as CodeKilnApplication).drafts.text(DraftKey(DraftKind.NewTask, "new-task")) == newText
        }
        compose.onNodeWithText(newText).assertIsDisplayed()
        compose.onNodeWithContentDescription("任务描述").performTextReplacement("")
        openTask(taskId)
        compose.onNodeWithText(codeText).assertIsDisplayed()
        compose.onNodeWithContentDescription("会话消息").performTextReplacement("")
    }
}
