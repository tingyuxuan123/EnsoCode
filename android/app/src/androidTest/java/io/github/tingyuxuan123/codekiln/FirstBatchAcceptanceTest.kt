package io.github.tingyuxuan123.codekiln

import androidx.compose.runtime.mutableStateOf
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import io.github.tingyuxuan123.codekiln.mirror.DesktopQueueAttempt
import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.mirror.QueueCommand
import io.github.tingyuxuan123.codekiln.mirror.SessionCommandPhase
import io.github.tingyuxuan123.codekiln.mirror.SessionTextAttempt
import io.github.tingyuxuan123.codekiln.pair.SessionTimeline
import io.github.tingyuxuan123.codekiln.ui.EnsoTheme
import io.github.tingyuxuan123.codekiln.ui.SessionHeader
import io.github.tingyuxuan123.codekiln.ui.SessionScreen
import org.junit.Assert.assertEquals
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FirstBatchAcceptanceTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @After fun hideKeyboardEvenAfterAContractFailure() {
        compose.activityRule.scenario.onActivity { activity ->
            WindowCompat.getInsetsController(activity.window, activity.window.decorView)
                .hide(WindowInsetsCompat.Type.ime())
        }
    }

    @Test fun codeReceiptMustNotEraseLaterABAEditingRevision() {
        val state = mutableStateOf(DesktopSessionState(SessionTimeline("s1", status = "idle"), loading = false))
        val draft = mutableStateOf("A")
        val sends = mutableListOf<String>()
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("ABA receipt"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> }, draft = draft.value, onDraft = { draft.value = it },
                onText = { text, _ ->
                    sends += text
                    state.value = state.value.copy(textAttempt = SessionTextAttempt(1, text, SessionCommandPhase.Waiting))
                })
        } }
        compose.onNodeWithContentDescription("发送").performClick()
        compose.onNodeWithContentDescription("会话消息").performTextReplacement("B")
        compose.onNodeWithContentDescription("会话消息").performTextReplacement("A")
        compose.runOnIdle { state.value = state.value.copy(textAttempt = state.value.textAttempt!!.copy(phase = SessionCommandPhase.Observed)) }
        compose.waitForIdle()
        assertEquals(listOf("A"), sends)
        assertEquals("Later A revision must survive an earlier A receipt", "A", draft.value)
    }

    @Test fun queueReceiptMustNotEraseLaterABAEditingRevision() {
        val state = mutableStateOf(DesktopSessionState(SessionTimeline("s1", status = "running"), loading = false, queueReady = true))
        val draft = mutableStateOf("A")
        compose.setContent { EnsoTheme {
            SessionScreen(SessionHeader("ABA queue"), state.value, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> }, draft = draft.value, onDraft = { draft.value = it },
                onQueue = { command, _, text ->
                    state.value = state.value.copy(queueAttempt = DesktopQueueAttempt(1, command, null, text, SessionCommandPhase.Waiting))
                })
        } }
        compose.onNodeWithText("加入队列").performClick()
        compose.onNodeWithContentDescription("会话消息").performTextReplacement("B")
        compose.onNodeWithContentDescription("会话消息").performTextReplacement("A")
        compose.runOnIdle {
            assertEquals(QueueCommand.Enqueue, state.value.queueAttempt!!.command)
            state.value = state.value.copy(queueAttempt = state.value.queueAttempt!!.copy(phase = SessionCommandPhase.Observed))
        }
        compose.waitForIdle()
        assertEquals("Later A revision must survive an earlier queue receipt", "A", draft.value)
    }

    @Test fun reenteringAScreenWithAnOldObservedAttemptDoesNotConfirmANewUnsubmittedDraft() {
        val draft = mutableStateOf("")
        val show = mutableStateOf(true)
        val state = DesktopSessionState(SessionTimeline("s1", status = "idle"), loading = false,
            textAttempt = SessionTextAttempt(1, "A", SessionCommandPhase.Observed))
        compose.setContent { EnsoTheme {
            if (show.value) SessionScreen(SessionHeader("Old receipt"), state, LinkPhase.Online, false,
                {}, {}, {}, { _, _ -> }, { _, _ -> }, draft = draft.value, onDraft = { draft.value = it })
        } }
        compose.waitForIdle()
        compose.runOnIdle { show.value = false }
        compose.waitForIdle()
        compose.runOnIdle { draft.value = "A"; show.value = true }
        compose.waitForIdle()
        assertEquals("A new draft was never submitted in this screen", "A", draft.value)
    }
}
