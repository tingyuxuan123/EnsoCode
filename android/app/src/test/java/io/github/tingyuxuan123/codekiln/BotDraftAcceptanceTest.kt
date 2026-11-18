package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopBotSendAttempt
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.ui.BotMessageDraft
import org.junit.Assert.assertEquals
import org.junit.Test

class BotDraftAcceptanceTest {
    @Test fun `matching deliveryId confirms only the submitted revision not later A B A edits`() {
        val submitted = BotMessageDraft("A").submitted("delivery-a")
        // MemberConversation uses copy(text = next) on every user edit.
        val edited = submitted.copy(text = "B").copy(text = "A")
        val receipt = DesktopBotSendAttempt("delivery-a", "chat-a", "A", SessionCommandPhase.Observed)
        val observed = edited.observe("chat-a", receipt)
        assertEquals("A later draft revision must not be erased even if its text matches", "A", observed.text)
    }
}
