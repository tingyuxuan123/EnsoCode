package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopLinkState
import io.github.tingyuxuan123.eaves.mirror.DesktopModel
import io.github.tingyuxuan123.eaves.mirror.DesktopModelAttempt
import io.github.tingyuxuan123.eaves.mirror.DesktopProvider
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.DesktopTask
import io.github.tingyuxuan123.eaves.mirror.DesktopThinkingAttempt
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.ui.NewTaskUiState
import io.github.tingyuxuan123.eaves.ui.PairUiState
import io.github.tingyuxuan123.eaves.ui.TaskStatus
import io.github.tingyuxuan123.eaves.ui.TaskSummary
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SessionModelScreenTest {
    @get:Rule val compose = createComposeRule()

    private val task = DesktopTask("session", "已有任务", "项目", status = "running", providerId = "p1", modelId = "shared")
    private val providers = listOf(DesktopProvider("p1", "服务一", listOf(DesktopModel("shared", "模型一"))),
        DesktopProvider("p2", "服务二", listOf(DesktopModel("shared", "模型二"))))
    private val session = DesktopSessionState(SessionTimeline(task.id, status = "running"), loading = false, modelReady = true)
    private val link = DesktopLinkState(LinkPhase.Online, catalog = listOf(task), readOnly = false,
        session = session, providers = providers, catalogReady = true)

    @Test fun existingSessionUsesDesktopSelectionAndWaitsForItsCatalogConfirmation() {
        val live = mutableStateOf(link)
        val changes = mutableListOf<Triple<String, String, String>>()
        showSession({ live.value }) { id, provider, model ->
            changes += Triple(id, provider, model)
            live.value = link.copy(session = session.copy(modelAttempt = DesktopModelAttempt(1, provider, model, SessionCommandPhase.Waiting)))
        }
        compose.onNodeWithText("模型一 · 项目").performTouchInput { click() }
        compose.onNodeWithText("模型二").performClick()
        compose.onNodeWithText("等待电脑确认模型切换…").assertIsDisplayed()
        compose.onNodeWithText("模型二").assertIsNotEnabled()
        assertEquals(listOf(Triple(task.id, "p2", "shared")), changes)
        compose.onNodeWithContentDescription("关闭模型选择").performClick()
        compose.onNodeWithText("模型一 · 项目").assertIsDisplayed()
        compose.runOnIdle { live.value = link.copy(catalog = listOf(task.copy(providerId = "p2"))) }
        compose.onNodeWithText("模型二 · 项目").assertIsDisplayed()
    }

    @Test fun readOnlySessionDoesNotExposeAChangeAction() {
        showSession({ link.copy(readOnly = true) }) { _, _, _ -> error("Read-only session sent a model change") }
        compose.onNodeWithText("模型一 · 项目").assertIsDisplayed()
        compose.onNodeWithContentDescription("切换会话模型").assertDoesNotExist()
    }

    @Test fun sessionWaitsForItsOwnModelCatalogBeforeOfferingAChange() {
        val live = mutableStateOf(link.copy(session = session.copy(modelReady = false)))
        showSession({ live.value }) { _, _, _ -> error("Test only opens the picker") }
        compose.onNodeWithContentDescription("切换会话模型").assertDoesNotExist()
        compose.runOnIdle { live.value = link }
        compose.onNodeWithContentDescription("切换会话模型").performClick()
        compose.onNodeWithText("模型二").assertIsDisplayed()
    }

    @Test fun modelPickerAlsoOffersThinkingConfiguration() {
        showSession({ link }) { _, _, _ -> }
        compose.onNodeWithContentDescription("切换会话模型").performClick()
        compose.onNodeWithText("思考").assertIsDisplayed()
        compose.onNodeWithText("思考深度").assertIsDisplayed()
    }

    @Test fun thinkingDepthBecomesEditableAfterDesktopEnablesThinkingAndWaitsForTheNewDepth() {
        val live = mutableStateOf(link.copy(catalog = listOf(task.copy(reasoningEnabled = false, thinkingLevel = TaskThinkingLevel.Low))))
        val changes = mutableListOf<Any>()
        showSession({ live.value }, onReasoning = { id, enabled ->
            assertEquals(task.id, id)
            changes += enabled
            live.value = live.value.copy(session = session.copy(thinkingAttempt = DesktopThinkingAttempt(1, enabled, null, SessionCommandPhase.Waiting)))
        }, onThinking = { id, level ->
            assertEquals(task.id, id)
            changes += level
            live.value = live.value.copy(session = session.copy(thinkingAttempt = DesktopThinkingAttempt(2, null, level, SessionCommandPhase.Waiting)))
        }) { _, _, _ -> error("This test only changes thinking") }
        compose.onNodeWithContentDescription("切换会话模型").performClick()
        val high = compose.onNodeWithContentDescription("思考深度：高")
        val low = compose.onNodeWithContentDescription("思考深度：低")
        high.assertIsNotEnabled()
        compose.onNodeWithContentDescription("开启思考").performClick()
        compose.onNodeWithText("等待电脑确认思考设置…").assertIsDisplayed()
        high.assertIsNotEnabled()
        compose.onNodeWithText("模型二").assertIsNotEnabled()
        compose.runOnIdle {
            live.value = link.copy(catalog = listOf(task.copy(reasoningEnabled = true, thinkingLevel = TaskThinkingLevel.Low)))
        }
        high.performClick()
        low.assertIsSelected()
        compose.runOnIdle {
            live.value = link.copy(catalog = listOf(task.copy(reasoningEnabled = true, thinkingLevel = TaskThinkingLevel.High)))
        }
        high.assertIsSelected()
        assertEquals(listOf(true, TaskThinkingLevel.High), changes)
        compose.onNodeWithContentDescription("关闭模型选择").performClick()
        compose.onNodeWithText("模型一 · 高 · 项目").assertIsDisplayed()
    }

    private fun showSession(live: () -> DesktopLinkState, onReasoning: ((String, Boolean) -> Unit)? = null,
        onThinking: ((String, TaskThinkingLevel) -> Unit)? = null, onSetModel: (String, String, String) -> Unit) {
        compose.setContent {
            EavesApp(initialRoute = EavesRoute.Home, state = NewTaskUiState(online = true, tasks = listOf(
                TaskSummary(task.id, task.title, task.projectName, "刚刚", TaskStatus.Running))),
                pairState = PairUiState(paired = true), live = live(), onSelectSession = {}, onSessionModel = onSetModel,
                onSessionReasoning = onReasoning, onSessionThinking = onThinking)
        }
        compose.onNodeWithText(task.title).performClick()
    }
}
