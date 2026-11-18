package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopBotSendAttempt
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.ui.BotMessageDraft
import org.junit.Assert.*
import org.junit.Test

class BotMessageDraftTest {
    private fun attempt(phase: SessionCommandPhase, id: String = "new", chat: String = "c1", text: String = "hello") =
        DesktopBotSendAttempt(id, chat, text, phase)

    @Test fun `sending and an uncertain or rejected result keep the exact draft`() {
        val sent = BotMessageDraft("  hello \uFEFF").submitted("new")
        assertEquals("  hello \uFEFF", sent.text)
        for (phase in listOf(SessionCommandPhase.Waiting, SessionCommandPhase.Unconfirmed, SessionCommandPhase.Rejected)) {
            assertEquals(sent, sent.observe("c1", attempt(phase)))
        }
    }

    @Test fun `only the new matching delivery acknowledgement clears an unchanged draft`() {
        val sent = BotMessageDraft("  hello \uFEFF").submitted("new")
        for (value in listOf(attempt(SessionCommandPhase.Observed, id = "old"),
            attempt(SessionCommandPhase.Observed, chat = "c2"), attempt(SessionCommandPhase.Observed, text = "different"))) {
            assertEquals(sent, sent.observe("c1", value))
        }
        val confirmed = sent.observe("c1", attempt(SessionCommandPhase.Observed))
        assertEquals("", confirmed.text)
        assertNull(confirmed.submission)
    }

    @Test fun `a late acknowledgement never erases text edited after submission`() {
        val edited = BotMessageDraft("hello").submitted("new").copy(text = "new draft")
        val observed = edited.observe("c1", attempt(SessionCommandPhase.Observed))
        assertEquals("new draft", observed.text)
        assertNull(observed.submission)
    }

    @Test fun `old acknowledgements and disconnects never clear an unsubmitted draft`() {
        val draft = BotMessageDraft("hello")
        assertEquals(draft, draft.observe("c1", attempt(SessionCommandPhase.Observed)))
        val sent = draft.submitted("old")
        assertEquals(sent, sent.observe("c1", null))
    }
}
