package io.github.tingyuxuan123.codekiln

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.codekiln.mirror.CreationPhase
import io.github.tingyuxuan123.codekiln.mirror.DesktopCreation
import io.github.tingyuxuan123.codekiln.mirror.DesktopLinkState
import io.github.tingyuxuan123.codekiln.mirror.DesktopModel
import io.github.tingyuxuan123.codekiln.mirror.DesktopProject
import io.github.tingyuxuan123.codekiln.mirror.DesktopProvider
import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.mirror.DesktopTask
import io.github.tingyuxuan123.codekiln.mirror.DraftKey
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.mirror.SessionCommandPhase
import io.github.tingyuxuan123.codekiln.mirror.SessionTextAttempt
import io.github.tingyuxuan123.codekiln.mirror.TaskApprovalMode
import io.github.tingyuxuan123.codekiln.mirror.TaskLaunch
import io.github.tingyuxuan123.codekiln.mirror.TaskThinkingLevel
import io.github.tingyuxuan123.codekiln.pair.SessionTimeline
import io.github.tingyuxuan123.codekiln.ui.EnsoTheme
import io.github.tingyuxuan123.codekiln.ui.NewTaskConfigSheet
import io.github.tingyuxuan123.codekiln.ui.NewTaskUiState
import io.github.tingyuxuan123.codekiln.ui.PairUiState
import io.github.tingyuxuan123.codekiln.ui.TaskConfiguration
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NewTaskConfigTest {
    @get:Rule val compose = createComposeRule()
    private val projects = listOf(DesktopProject("p", "真实项目"))
    private val providers = listOf(DesktopProvider("provider", "真实服务", listOf(
        DesktopModel("m1", "模型一"), DesktopModel("m2", "模型二"))))

    /** Stand-in for DraftBook in the app: keeps composer text for the test and answers by key. */
    private class DraftHost {
        val state = mutableStateOf<Map<DraftKey, String>>(emptyMap())
        fun edit(key: DraftKey, text: String) {
            state.value = if (text.isBlank()) state.value - key else state.value + (key to text)
        }
    }

    @Test fun tappingHeaderModelOpensSettingsAndUsesChosenModelForNewTask() {
        val live = DesktopLinkState(LinkPhase.Online, readOnly = false, projects = projects, providers = providers)
        val drafts = DraftHost()
        var sent: TaskLaunch? = null
        compose.setContent { CodeKilnApp(state = NewTaskUiState(online = true), pairState = PairUiState(paired = true),
            live = live, drafts = drafts.state.value, onDraftEdit = drafts::edit, onCreateTask = { sent = it }) }
        compose.onNodeWithText("模型一 · 高").performTouchInput { click() }
        compose.onNodeWithText("新任务设置").assertIsDisplayed()
        compose.onNodeWithText("模型二").performClick()
        compose.onNodeWithContentDescription("关闭新任务设置").performClick()
        compose.onNodeWithText("模型二 · 高").assertIsDisplayed()
        compose.onNodeWithContentDescription("任务描述").performTextInput("使用所选模型")
        compose.onNodeWithContentDescription("发送").performClick()
        assertEquals("m2", sent?.modelId)
    }

    @Test fun choicesApplyImmediatelyAndDoNotAdvertiseUnknownPresets() {
        val config = mutableStateOf(TaskConfiguration())
        compose.setContent { EnsoTheme {
            NewTaskConfigSheet(projects, providers, config.value, true, { config.value = it }, {})
        } }
        compose.onNodeWithText("模型二").performClick()
        compose.onNodeWithText("中").performClick()
        compose.onNodeWithText("自动接受编辑").performClick()
        compose.onNodeWithText("桌面默认预设").assertIsNotEnabled()
        compose.runOnIdle {
            assertEquals("provider", config.value.providerId)
            assertEquals("m2", config.value.modelId)
            assertEquals(TaskThinkingLevel.Medium, config.value.thinkingLevel)
            assertEquals(TaskApprovalMode.AutoEdits, config.value.approvalMode)
        }
    }

    @Test fun vanishedChosenModelDisablesCreationWithoutDiscardingDescription() {
        val live = mutableStateOf(DesktopLinkState(LinkPhase.Online, readOnly = false, projects = projects, providers = providers))
        val drafts = DraftHost()
        compose.setContent { CodeKilnApp(state = NewTaskUiState(online = true), pairState = PairUiState(paired = true),
            live = live.value, drafts = drafts.state.value, onDraftEdit = drafts::edit,
            onCreateTask = { error("Unavailable model must not create") }) }
        compose.onNodeWithContentDescription("打开新任务设置").performClick()
        compose.onNodeWithText("模型二").performClick()
        compose.onNodeWithContentDescription("关闭新任务设置").performClick()
        compose.onNodeWithContentDescription("任务描述").performTextInput("保留描述")
        compose.onNodeWithContentDescription("发送").assertIsEnabled()
        compose.runOnIdle { live.value = live.value.copy(providers = providers.map { it.copy(models = it.models.take(1)) }) }
        compose.onNodeWithContentDescription("发送").assertIsNotEnabled()
        compose.onNodeWithContentDescription("任务描述").assertTextContains("保留描述")
    }

    @Test fun confirmedCreationMovesDraftIntoSessionAndOnlyAuthorityClearsIt() {
        val live = mutableStateOf(DesktopLinkState(LinkPhase.Online, readOnly = false, projects = projects, providers = providers))
        val drafts = DraftHost()
        var sent: TaskLaunch? = null
        compose.setContent { CodeKilnApp(state = NewTaskUiState(online = true), pairState = PairUiState(paired = true),
            live = live.value, drafts = drafts.state.value, onDraftEdit = drafts::edit,
            onSelectSession = {}, onCreateTask = { sent = it }) }
        compose.onNodeWithContentDescription("任务描述").performTextInput("首条任务")
        compose.onNodeWithContentDescription("发送").performClick()
        assertEquals("首条任务", sent?.text)
        compose.runOnIdle {
            live.value = live.value.copy(creation = DesktopCreation("new", CreationPhase.Created),
                catalog = listOf(DesktopTask("new", "已创建", "真实项目", status = "idle")),
                session = DesktopSessionState(SessionTimeline("new", status = "idle"), loading = false))
        }
        compose.onNodeWithText("已创建").assertIsDisplayed()
        compose.onNodeWithContentDescription("会话消息").assertTextContains("首条任务")
        compose.runOnIdle {
            live.value = live.value.copy(session = live.value.session!!.copy(
                textAttempt = SessionTextAttempt(1, "首条任务", SessionCommandPhase.Observed)))
        }
        compose.onNodeWithContentDescription("会话消息").assertTextContains("")
        compose.onNodeWithContentDescription("发送").assertIsNotEnabled()
    }
}
