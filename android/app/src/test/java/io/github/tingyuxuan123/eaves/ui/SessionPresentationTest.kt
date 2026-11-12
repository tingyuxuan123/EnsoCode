package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.pair.SessionTimelineReducer
import io.github.tingyuxuan123.eaves.pair.SessionTodo
import io.github.tingyuxuan123.eaves.pair.SessionTodoStatus
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
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
        assertEquals(listOf(SessionStep("思考", "内部步骤", kind = SessionStepKind.Thinking), SessionStep("bash", "pnpm test", "通过", "call")), steps)
        assertEquals(SessionBlock.Prose("完成"), turns.single().blocks[1])
    }

    @Test fun `尾窗只有工具结果时仍有折叠详情但不会造出额外用户气泡`() {
        val turns = sessionTurns(listOf(message(50, "toolResult", """{"type":"text","text":"保留结果"}""", call = "older", tool = "read")))
        assertEquals(50L, turns.single().index)
        assertTrue(!turns.single().user)
        assertEquals(listOf(SessionStep("read", null, "保留结果", "older")), (turns.single().blocks.single() as SessionBlock.Steps).steps)
    }

    @Test fun `待办用工具结果而不是参数快照且不把附带日志当工具输出`() {
        val turns = wireTurns("""[
          {"role":"assistant","content":[{"type":"toolCall","id":"t","name":"todo","arguments":{"todos":[{"content":"请求草稿","status":"pending"}]}}]},
          {"role":"toolResult","toolCallId":"t","toolName":"todo","todos":[{"content":"结果已完成","status":"completed"},{"content":"还在执行","status":"in_progress"}],
            "content":[{"type":"text","text":"<background-task-update>\n旧日志\n</background-task-update>\n\nTodos (1/1 done):\n[x] 旧文本快照"}]},
          {"role":"assistant","content":[{"type":"text","text":"正常回复"}]}
        ]""")
        val blocks = turns.single().blocks
        assertEquals(listOf(SessionBlock.Notice(SessionNoticeKind.Background, "旧日志"), SessionBlock.Todos(listOf(
            SessionTodo("结果已完成", SessionTodoStatus.Completed), SessionTodo("还在执行", SessionTodoStatus.InProgress),
        )), SessionBlock.Prose("正常回复")), blocks)
    }

    @Test fun `历史工具结果独立支持旧待办清单但不猜测其它工具`() {
        val turns = wireTurns("""[
          {"role":"toolResult","toolCallId":"missing","toolName":"todo","content":[{"type":"text","text":"Todos (1/2 done):\n[x] 完成\n[ ] 待处理"}]},
          {"role":"toolResult","toolCallId":"not-todo","toolName":"bash","content":[{"type":"text","text":"Todos (1/2 done):\n[x] 完成\n[ ] 待处理"}]},
          {"role":"toolResult","toolName":"todo","isError":true,"content":[{"type":"text","text":"Todo list cleared"}]}
        ]""")
        val blocks = turns.single().blocks
        assertEquals(SessionBlock.Todos(listOf(SessionTodo("完成", SessionTodoStatus.Completed),
            SessionTodo("待处理", SessionTodoStatus.Pending))), blocks.first())
        val steps = (blocks.last() as SessionBlock.Steps).steps
        assertEquals(listOf("bash", "todo"), steps.map { it.name })
        assertEquals(listOf(false, true), steps.map { it.failed })
    }

    @Test fun `工具结果只分离开头的通知且保留真实输出中的标签`() {
        val turns = wireTurns("""[
          {"role":"toolResult","toolName":"bash","isError":true,"content":[{"type":"text","text":"<system-reminder>\n只在外面展示\n</system-reminder>\nexit 1\n<background-task-update>文件正文</background-task-update>"}]}
        ]""")
        val blocks = turns.single().blocks
        assertEquals(SessionBlock.Notice(SessionNoticeKind.Reminder, "只在外面展示"), blocks.first())
        assertEquals("exit 1\n<background-task-update>文件正文</background-task-update>", (blocks[1] as SessionBlock.Steps).steps.single().result)
    }

    @Test fun `后台合成消息不是用户气泡且压缩摘要保留原始顺序`() {
        val turns = wireTurns("""[
          {"role":"assistant","content":[{"type":"text","text":"压缩前"}]},
          {"role":"compactionSummary","content":[{"type":"text","text":"保留的上下文"}]},
          {"role":"user","content":[{"type":"text","text":"<background-task-update>\n完成后台任务\n</background-task-update>"}]},
          {"role":"user","content":[{"type":"text","text":"请解释 <background-task-update> 这个标签"}]}
        ]""")
        assertEquals(listOf(0L, 1L, 2L, 3L), turns.map { it.index })
        assertEquals(listOf(SessionBlock.Prose("压缩前"), SessionBlock.Compaction("保留的上下文"),
            SessionBlock.Notice(SessionNoticeKind.Background, "完成后台任务"),
            SessionBlock.Prose("请解释 <background-task-update> 这个标签")), turns.flatMap { it.blocks })
        assertEquals(listOf(false, false, false, true), turns.map { it.user })
    }

    @Test fun `工具返回的图片也进入时间线且坏图片保留占位`() {
        val turns = wireTurns("""[
          {"role":"assistant","content":[{"type":"toolCall","id":"image","name":"read"}]},
          {"role":"toolResult","toolCallId":"image","toolName":"read","content":[{"type":"image","mimeType":"image/png","data":"aGk="},{"type":"image","mimeType":"image/png","data":"bad!"}]},
          {"role":"assistant","content":[{"type":"text","text":"看到了"}]}
        ]""")
        assertEquals(listOf("Steps", "Images", "ImagePlaceholder", "Prose"), turns.single().blocks.map { it.javaClass.simpleName })
    }

    @Test fun `用户或未来调用不能截走较早的工具结果`() {
        val turns = wireTurns("""[
          {"role":"toolResult","toolName":"read","toolCallId":"same","content":[{"type":"text","text":"较早结果"}]},
          {"role":"user","content":[{"type":"toolCall","id":"same","name":"read"},{"type":"text","text":"继续"}]},
          {"role":"assistant","content":[{"type":"toolCall","id":"same","name":"bash","arguments":{"command":"fixture"}}]},
          {"role":"toolResult","toolName":"read","toolCallId":"same","content":[{"type":"text","text":"其它工具结果"}]}
        ]""")
        assertEquals("较早结果", (turns.first().blocks.single() as SessionBlock.Steps).steps.single().result)
        val steps = (turns.last().blocks.single() as SessionBlock.Steps).steps
        assertEquals(null, steps.first().result)
        assertEquals("其它工具结果", steps.last().result)
    }

    @Test fun `清空待办只在成功结果展示且不一致的旧格式留作普通输出`() {
        for (text in listOf("Todos (2/2 done):\n[x] 完成\n[ ] 未完成", "Todos (1/2 done):\n[x] 缺了一项",
            "文件正文\nTodos (1/1 done):\n[x] 不可当状态")) {
            val message = message(0, "toolResult", """{"type":"text","text":${JsonPrimitive(text)}}""", tool = "todo")
            assertTrue(sessionTurns(listOf(message)).single().blocks.single() is SessionBlock.Steps)
        }
        val cleared = sessionTurns(listOf(message(0, "toolResult", """{"type":"text","text":"Todo list cleared"}""", tool = "todo")))
        assertEquals(listOf(SessionBlock.Todos(emptyList())), cleared.single().blocks)
    }

    @Test fun `完整开头通知逐块分离且未闭合标签不能吞掉输出`() {
        val turns = sessionTurns(listOf(message(0, "toolResult", """{"type":"text","text":${JsonPrimitive(
            "<background-task-update>第一份通知</background-task-update>\n<system-reminder>第二份通知</system-reminder>\n正文"
        )}}""", tool = "read")))
        assertEquals(listOf(SessionBlock.Notice(SessionNoticeKind.Background, "第一份通知"),
            SessionBlock.Notice(SessionNoticeKind.Reminder, "第二份通知"),
            SessionBlock.Steps(listOf(SessionStep("read", null, "正文")))), turns.single().blocks)
        val incomplete = "<system-reminder>未闭合\n真实输出"
        val preserved = sessionTurns(listOf(message(1, "toolResult", """{"type":"text","text":${JsonPrimitive(incomplete)}}""", tool = "read")))
        assertEquals(incomplete, (preserved.single().blocks.single() as SessionBlock.Steps).steps.single().result)
    }

    @Test fun `后台合成通知不拆开同一助手回复的工作日志`() {
        val turns = sessionTurns(listOf(
            message(0, "assistant", """{"type":"text","text":"先检查"}"""),
            message(1, "user", """{"type":"text","text":"<background-task-update>收到回执</background-task-update>"}"""),
            message(2, "assistant", """{"type":"text","text":"最后答复"}"""),
        ))
        assertEquals(1, turns.size)
        assertEquals(listOf(SessionBlock.Prose("先检查"), SessionBlock.Notice(SessionNoticeKind.Background, "收到回执"),
            SessionBlock.Prose("最后答复")), turns.single().blocks)
    }

    @Test fun `工作日志按回复合并且最终答复和最新待办图片始终可见`() {
        val oldTodo = SessionBlock.Todos(emptyList())
        val latest = SessionBlock.Todos(listOf(SessionTodo("复核", SessionTodoStatus.InProgress)))
        val prose = SessionBlock.Prose("正在查看")
        val answer = SessionBlock.Prose("检查完成")
        val notice = SessionBlock.Notice(SessionNoticeKind.Background, "后台完成")
        val steps = SessionBlock.Steps(listOf(SessionStep("read", "README", failed = true),
            SessionStep("思考", "定位", kind = SessionStepKind.Thinking)))
        val image = SessionBlock.Images(listOf(TimelineImage("payload", "image/png")))
        val raw = listOf(prose, steps, oldTodo, notice, latest, image, answer)
        val folded = sessionWorklogBlocks(raw, running = false)
        val work = folded.first() as SessionBlock.Worklog
        assertEquals(listOf(prose, steps, oldTodo, notice), work.entries)
        assertEquals(listOf(latest, image, answer), folded.drop(1))
        assertTrue(work.hasAnswer)
        assertEquals(1, work.thinking)
        assertEquals(2, work.calls)
        assertEquals(1, work.failures)
        val live = sessionWorklogBlocks(raw, running = true)
        assertEquals(listOf(prose, latest, image, answer), live.filterNot { it is SessionBlock.Worklog })
        val incomplete = sessionWorklogBlocks(listOf(prose, steps), running = false)
        assertEquals(prose, incomplete.first())
        assertTrue(!(incomplete.last() as SessionBlock.Worklog).hasAnswer)
    }

    private fun wireTurns(messages: String): List<SessionTurn> {
        val wire = Json.parseToJsonElement("""{
          "type":"session-sync","sessionId":"s","requestId":"r","cursor":{"epoch":"test","seq":0},"mode":"snapshot",
          "snapshot":{"type":"snapshot","sessions":[{"sessionId":"s","identity":{"sessionId":"s","generation":"g"},"baseIndex":0,"messages":$messages}]}
        }""").jsonObject
        return sessionTurns(requireNotNull(SessionTimelineReducer.sync(SessionTimeline("s"), wire)).messages)
    }
}
