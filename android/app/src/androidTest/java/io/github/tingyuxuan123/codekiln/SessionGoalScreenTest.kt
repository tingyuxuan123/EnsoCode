package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopGoal
import io.github.tingyuxuan123.eaves.mirror.DesktopGoalAttempt
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.SessionHeader
import io.github.tingyuxuan123.eaves.ui.SessionScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionGoalScreenTest {
    @get:Rule val compose = createComposeRule()
    private val initial = DesktopSessionState(SessionTimeline("goal-session", status = "idle"), loading = false, goalReady = true)

    @Test fun settingWaitsForAuthorityAndKeepsUncertainDraft() {
        val state = mutableStateOf(initial)
        val actions = mutableListOf<Triple<GoalCommand, DesktopGoal?, String?>>()
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("目标测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onGoal = { command, expected, text -> actions.add(Triple(command, expected, text)) })
        } }
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("设定目标").performClick()
        compose.onNodeWithText("开始").assertIsNotEnabled()
        compose.onNodeWithContentDescription("目标完成条件").performTextReplacement("  相关测试全部通过  ")
        compose.waitForIdle()
        compose.onNodeWithText("开始").assertIsEnabled()
        // The sheet scrolls, and the keyboard can push the button below the fold.
        compose.onNodeWithText("开始").performScrollTo().performClick()
        assertEquals(listOf(Triple(GoalCommand.Set, null, "相关测试全部通过")), actions)
        compose.runOnIdle { state.value = initial.copy(goalAttempt = DesktopGoalAttempt(1, GoalCommand.Set,
            "相关测试全部通过", SessionCommandPhase.Waiting)) }
        compose.onNodeWithText("开始").assertIsNotEnabled()
        compose.onNodeWithContentDescription("查看目标").assertDoesNotExist()
        compose.runOnIdle { state.value = state.value.copy(goalAttempt = state.value.goalAttempt!!.copy(phase = SessionCommandPhase.Unconfirmed)) }
        compose.onNodeWithText("目标操作未确认，请先检查桌面。草稿已保留。").assertIsDisplayed()
        compose.onNodeWithContentDescription("目标完成条件").assertIsDisplayed()
        compose.runOnIdle { state.value = state.value.copy(goal = DesktopGoal("相关测试全部通过", "active", 0),
            goalAttempt = state.value.goalAttempt!!.copy(phase = SessionCommandPhase.Observed)) }
        compose.onNodeWithContentDescription("目标完成条件").assertDoesNotExist()
        compose.onNodeWithText("已自动推进 0 轮").assertIsDisplayed()
    }

    @Test fun statusPanelDoesNotOptimisticallyPauseAndClearRequiresConfirmation() {
        val goal = DesktopGoal("CI 变绿", "active", 4, "准备检查新的 CI 日志。")
        val state = mutableStateOf(initial.copy(goal = goal))
        val actions = mutableListOf<Triple<GoalCommand, DesktopGoal?, String?>>()
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("目标测试"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> },
                onGoal = { command, expected, text -> actions.add(Triple(command, expected, text)) })
        } }
        compose.onNodeWithContentDescription("查看目标").performClick()
        compose.onNodeWithText("已自动推进 4 轮").assertIsDisplayed()
        compose.onNodeWithText("准备检查新的 CI 日志。").assertIsDisplayed()
        compose.onNodeWithText("暂停").performClick()
        assertEquals(Triple(GoalCommand.Pause, goal, null), actions.single())
        compose.onNodeWithText("继续").assertDoesNotExist()
        val paused = goal.copy(status = "paused", note = null)
        compose.runOnIdle { state.value = initial.copy(goal = paused) }
        compose.onNodeWithText("继续").assertIsEnabled()
        compose.onNodeWithText("继续").performClick()
        assertEquals(Triple(GoalCommand.Resume, paused, null), actions.last())
        compose.onNodeWithText("清除目标").performClick()
        assertEquals(2, actions.size)
        compose.onNodeWithText("确认清除").performClick()
        assertEquals(Triple(GoalCommand.Clear, paused, null), actions.last())
    }

    @Test fun editingCannotApplyToAChangedGoalAndReadonlyStillAllowsInspection() {
        val goal = DesktopGoal("先运行测试", "paused", 2)
        val state = mutableStateOf(initial.copy(goal = goal))
        val readOnly = mutableStateOf(false)
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("目标测试"), state.value, LinkPhase.Online, readOnly.value,
                {}, {}, {}, { _, _ -> }, { _, _ -> }, onGoal = { _, _, _ -> error("Stale or readonly write") })
        } }
        compose.onNodeWithContentDescription("查看目标").performClick()
        compose.onNodeWithText("改目标").performClick()
        compose.runOnIdle { state.value = initial.copy(goal = goal.copy(text = "桌面已更换目标")) }
        compose.onNodeWithText("开始").assertIsNotEnabled()
        compose.onNodeWithText("目标已在桌面变化，请关闭后重新打开。").assertIsDisplayed()
        compose.onNodeWithContentDescription("关闭面板").performClick()
        compose.runOnIdle { readOnly.value = true }
        compose.onNodeWithContentDescription("查看目标").performClick()
        compose.onNodeWithText("继续").assertIsNotEnabled()
        compose.onNodeWithText("改目标").assertIsNotEnabled()
        compose.onNodeWithText("清除目标").assertIsNotEnabled()
    }
}
