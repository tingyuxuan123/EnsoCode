package io.github.tingyuxuan123.codekiln.ui

import io.github.tingyuxuan123.codekiln.mirror.DesktopCompaction
import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.pair.SessionApproval
import io.github.tingyuxuan123.codekiln.pair.SessionMessage
import io.github.tingyuxuan123.codekiln.pair.SessionTimeline
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionWorkingStatusTest {
    private fun msg(index: Long, role: String, vararg content: String) =
        SessionMessage(index, role, content.map { Json.parseToJsonElement(it).jsonObject })

    private fun running(vararg messages: SessionMessage) = DesktopSessionState(
        SessionTimeline("s", messages = messages.toList(), status = "running"), loading = false,
    )

    @Test fun `successful edit cue follows the newest tool and mentions only the basename`() {
        val toolCall = msg(2, "assistant", """{"type":"toolCall","id":"c","name":"edit","arguments":{"path":"/private/user/project/ConversationDeliveryScreenTest.kt"}}""")
        val result = msg(3, "toolResult", """{"type":"text","text":"Done"}""").copy(toolCallId = "c", toolName = "edit")
        val thinking = msg(4, "assistant", """{"type":"thinking","text":"Internal text"}""")
        val state = running(msg(1, "user"), toolCall, result, thinking)
        val work = requireNotNull(sessionWorkingStatus(state, true))
        assertEquals("确认 ConversationDeliveryScr… 的边界情况", work.phrases.first())
        assertTrue(work.phrases.none { "private" in it || "Internal text" in it })
        assertEquals(thinking, work.lastOutput)
        assertNull(sessionWorkingStatus(state, false))
        assertNull(sessionWorkingStatus(state.copy(timeline = state.timeline.copy(status = "idle")), true))
    }

    @Test fun `new user turns and assistant prose fence off the old cue`() {
        val old = msg(1, "toolResult").copy(toolName = "apply_patch", toolFileName = "old.kt")
        val user = msg(2, "user", """{"type":"text","text":"新问题"}""")
        val writing = msg(3, "assistant", """{"type":"text","text":"正在写"}""").copy(stopReason = "pending")
        assertTrue(requireNotNull(sessionWorkingStatus(running(old, user), true)).phrases.none { "old.kt" in it })
        assertEquals("正在整理回复", requireNotNull(sessionWorkingStatus(running(old, writing), true)).phrases.first())
        val patch = msg(4, "toolResult").copy(toolName = "apply_patch", toolFileName = "deliver.kt")
        val note = msg(5, "user", """{"type":"text","text":"<background-task-update>\n通知\n</background-task-update>"}""")
        assertEquals("确认 deliver.kt 的边界情况", requireNotNull(sessionWorkingStatus(running(user, patch, note), true)).phrases.first())
    }

    @Test fun `blocking requests and compaction override chatter without inventing work`() {
        val state = running()
        assertNull(sessionWorkingStatus(state.copy(loading = true), true))
        assertNull(sessionWorkingStatus(state.copy(error = true), true))
        val compacting = state.copy(compaction = DesktopCompaction("start"))
        assertEquals(listOf("正在压缩上下文"), sessionWorkingStatus(compacting, true)?.phrases)
        val waiting = compacting.copy(timeline = state.timeline.copy(approvals = listOf(SessionApproval("r", "bash", "command", "private args"))))
        val status = requireNotNull(sessionWorkingStatus(waiting, true))
        assertEquals(listOf("等待你批准"), status.phrases)
        assertFalse(status.showElapsed)
        assertEquals("0 秒", formatWorkingElapsed(-5))
        assertEquals("3 秒", formatWorkingElapsed(3_999))
        assertEquals("1 分 12 秒", formatWorkingElapsed(72_000))
    }
}
