package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.mirror.DesktopBotSendAttempt
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.botMessageText

/** Local, process-memory-only text. Clicking send is not a receipt. */
internal data class BotMessageDraft(val text: String = "", val submission: BotDraftSubmission? = null) {
    /**
     * Edit generation. `copy()` produces a fresh instance, so a draft edited back to the submitted text
     * is still a different revision; text equality alone cannot tell A, B, A from an untouched A.
     */
    private val generation: Any = Any()

    fun submitted(deliveryId: String): BotMessageDraft =
        copy(submission = BotDraftSubmission(text, deliveryId)).also { next -> next.submission?.generation = next.generation }

    fun observe(chatId: String, attempt: DesktopBotSendAttempt?): BotMessageDraft {
        val sent = submission ?: return this
        if (attempt == null || attempt.chatId != chatId || attempt.deliveryId != sent.deliveryId ||
            attempt.text != botMessageText(sent.text) || attempt.phase != SessionCommandPhase.Observed) return this
        // A later revision keeps its text even when that text happens to equal what was submitted.
        if (generation !== sent.generation) return copy(submission = null)
        return copy(text = "", submission = null)
    }
}

internal data class BotDraftSubmission(val text: String, val deliveryId: String) {
    /** Generation of the draft instance that carried this submission; not part of equality. */
    internal var generation: Any? = null
}
