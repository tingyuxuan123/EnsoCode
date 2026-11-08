package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.pair.SessionMessage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionPresentationTest {
    private fun message(index: Long, role: String, vararg parts: String, call: String? = null, tool: String? = null) =
        SessionMessage(index, role, parts.map { Json.parseToJsonElement(it).jsonObject }, toolCallId = call, toolName = tool)

    @Test fun `用户和助手分别成轮且未知内容不会伪造正文`() {
        val turns = sessionTurns(listOf(
            message(4, "user", """{"type":"text","text":"查看结果"}"""),
            message(5, "assistant", """{"type":"future","text":"不能当正文"}""", """{"type":"text","text":"结果"}"""),
            message(6, "user", """{"type":"image","data":"opaque"}"""),
        ))
        assertEquals(listOf(4L, 5L, 6L), turns.map { it.index })
        assertEquals(listOf(true, false, true), turns.map { it.user })
        assertEquals(listOf(SessionBlock.Prose("结果")), turns[1].blocks)
        assertEquals(listOf(SessionBlock.ImagePlaceholder), turns[2].blocks)
    }

    @Test fun `思考和连续工具折成一步组且工具结果按调用ID关联`() {
        val turns = sessionTurns(listOf(
            message(7, "assistant", """{"type":"thinking","text":"内部步骤"}""",
                """{"type":"toolCall","id":"call","name":"bash","arguments":{"command":"pnpm test"}}"""),
            message(8, "toolResult", """{"type":"text","text":"通过"}""", call = "call", tool = "bash"),
            message(9, "assistant", """{"type":"text","text":"完成"}"""),
        ))
        assertEquals(1, turns.size)
        val steps = (turns.single().blocks[0] as SessionBlock.Steps).steps
        assertEquals(listOf(SessionStep("思考", "内部步骤"), SessionStep("bash", "pnpm test", "通过", "call")), steps)
        assertEquals(SessionBlock.Prose("完成"), turns.single().blocks[1])
    }

    @Test fun `尾窗只有工具结果时仍有折叠详情但不会造出额外用户气泡`() {
        val turns = sessionTurns(listOf(message(50, "toolResult", """{"type":"text","text":"保留结果"}""", call = "older", tool = "read")))
        assertEquals(50L, turns.single().index)
        assertTrue(!turns.single().user)
        assertEquals(listOf(SessionStep("read", null, "保留结果", "older")), (turns.single().blocks.single() as SessionBlock.Steps).steps)
    }
}
