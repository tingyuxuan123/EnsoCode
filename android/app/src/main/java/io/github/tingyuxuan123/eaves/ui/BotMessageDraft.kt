package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.mirror.DesktopBotSendAttempt
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.botMessageText

/** Local, process-memory-only text. Clicking send is not a receipt. */
internal data class BotMessageDraft(val text: String = "", val submission: BotDraftSubmission? = null) {
    fun submitted(deliveryId: String) = copy(submission = BotDraftSubmission(text, deliveryId))

    fun observe(chatId: String, attempt: DesktopBotSendAttempt?): BotMessageDraft {
        val sent = submission ?: return this
        if (attempt == null || attempt.chatId != chatId || attempt.deliveryId != sent.deliveryId ||
            attempt.text != botMessageText(sent.text) || attempt.phase != SessionCommandPhase.Observed) return this
        return copy(text = if (text == sent.text) "" else text, submission = null)
    }
}

internal data class BotDraftSubmission(val text: String, val deliveryId: String)
