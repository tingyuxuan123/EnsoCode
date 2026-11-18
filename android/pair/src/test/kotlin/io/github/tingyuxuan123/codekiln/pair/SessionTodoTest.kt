package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionTodoTest {
    private fun obj(source: String) = Json.parseToJsonElement(source) as JsonObject
    private fun cursor(seq: Long) = obj("""{"epoch":"e","seq":$seq}""")
    private fun todo(content: String = "task", status: String = "pending") = JsonObject(mapOf(
        "content" to JsonPrimitive(content), "status" to JsonPrimitive(status),
    ))
    // Real src/agent/projection.ts shape: todos is top-level, not details or tool input.
    private fun message(todos: JsonElement? = JsonArray(listOf(todo())), role: String = "toolResult",
                        tool: String = "todo", error: JsonElement? = JsonPrimitive(false),
                        text: String = "<background-task-update>raw log</background-task-update>"): JsonObject =
        JsonObject(mapOf(
            "role" to JsonPrimitive(role), "toolName" to JsonPrimitive(tool),
            "toolCallId" to JsonPrimitive("call-1"), "timestamp" to JsonPrimitive(123),
            "content" to JsonArray(listOf(JsonObject(mapOf("type" to JsonPrimitive("text"),
                "text" to JsonPrimitive(text))))),
        ) + (todos?.let { mapOf("todos" to it) } ?: emptyMap()) +
            (error?.let { mapOf("isError" to it) } ?: emptyMap()))

    private fun snapshot(messages: List<JsonElement> = emptyList(), base: Long = 0) = obj("""{
        "type":"session-sync","sessionId":"s","requestId":"r","mode":"snapshot",
        "cursor":${cursor(0)},"snapshot":{"type":"snapshot","sessions":[{
          "sessionId":"s","baseIndex":$base,"messages":${JsonArray(messages)}
        }]}}
    """)
    private fun load(vararg messages: JsonElement, base: Long = 0) = requireNotNull(
        SessionTimelineReducer.sync(SessionTimeline("s"), snapshot(messages.toList(), base)))
    private fun upsert(index: Long, message: JsonObject) = obj("""{
        "type":"message-upsert","sessionId":"s","index":$index,"message":$message
    }""")
    private fun event(previous: SessionTimeline, message: JsonObject, index: Long, seq: Long) = requireNotNull(
        SessionTimelineReducer.event(previous, obj("""{
            "type":"agent-event","cursor":${cursor(seq)},"event":${upsert(index, message)}
        }""")))
    private fun history(previous: SessionTimeline, base: Long, messages: List<JsonElement>) = requireNotNull(
        SessionTimelineReducer.history(previous, obj("""{
            "type":"history","sessionId":"s","baseIndex":$base,"messages":${JsonArray(messages)}
        }""")))

    @Test fun `快照读取TS结构化todo所有状态且保留原始正文角色和顺序`() {
        val incoming = message(JsonArray(listOf(todo("first"), todo("second", "in_progress"),
            todo("third", "completed"))), error = JsonPrimitive(true))
        val actual = load(incoming).messages.single()
        assertEquals(listOf(SessionTodo("first", SessionTodoStatus.Pending),
            SessionTodo("second", SessionTodoStatus.InProgress),
            SessionTodo("third", SessionTodoStatus.Completed)), actual.todos)
        assertTrue(actual.isError)
        assertEquals("toolResult", actual.role)
        assertEquals((incoming["content"] as JsonArray).toList(), actual.content)
        assertEquals("call-1", actual.toolCallId)
        assertEquals(123L, actual.timestamp)
    }

    @Test fun `公开模型旧调用默认无todo且非错误`() {
        val old = SessionMessage(0, "user", emptyList())
        assertNull(old.todos)
        assertFalse(old.isError)
    }

    @Test fun `live整条替换能更新并明确清空清单而旧消息不变`() {
        val previous = load(message())
        val updated = event(previous, message(JsonArray(listOf(todo("done", "completed"))),
            error = JsonPrimitive(true)), 0, 1)
        assertEquals(listOf(SessionTodo("done", SessionTodoStatus.Completed)), updated.messages.single().todos)
        assertTrue(updated.messages.single().isError)
        val cleared = event(updated, message(JsonArray(emptyList())), 0, 2)
        assertEquals(emptyList<SessionTodo>(), cleared.messages.single().todos)
        assertFalse(cleared.messages.single().isError)
        assertEquals("task", previous.messages.single().todos?.single()?.content)
        val legacy = event(cleared, message(todos = null, error = null), 0, 3)
        assertNull(legacy.messages.single().todos)
    }

    @Test fun `replay和history沿相同parser且旧历史不覆盖最新增量`() {
        val previous = load(message(), base = 2)
        val update = message(JsonArray(listOf(todo("live", "in_progress"))), error = JsonPrimitive(true))
        val replay = obj("""{
            "type":"session-sync","sessionId":"s","requestId":"r","mode":"replay",
            "cursor":${cursor(1)},"fromSeq":0,"events":[${upsert(2, update)}]
        }""")
        val live = requireNotNull(SessionTimelineReducer.sync(previous, replay))
        val next = history(live, 0, listOf(message(JsonArray(emptyList())), message(), message()))
        assertEquals(listOf(0L, 1L, 2L), next.messages.map { it.index })
        assertEquals(emptyList<SessionTodo>(), next.messages[0].todos)
        assertEquals(listOf(SessionTodo("task", SessionTodoStatus.Pending)), next.messages[1].todos)
        assertEquals(listOf(SessionTodo("live", SessionTodoStatus.InProgress)), next.messages[2].todos)
        assertTrue(next.messages[2].isError)
        assertEquals(cursor(1), next.cursor)
    }

    @Test fun `显式空列表与缺失空值错误类型和全脏列表严格区分`() {
        assertEquals(emptyList<SessionTodo>(), load(message(JsonArray(emptyList()))).messages.single().todos)
        val invalid = listOf(null, Json.parseToJsonElement("null"), obj("{}"), JsonPrimitive("[]"),
            JsonArray(listOf(obj("{}"), JsonPrimitive(1), todo(status = "unknown"))))
        for (metadata in invalid) {
            val actual = load(message(metadata)).messages.single()
            assertNull("Not an authoritative clear: $metadata", actual.todos)
            assertEquals(1, actual.content.size)
        }
    }

    @Test fun `混合脏条目仅保留合法content和status且不接受title或近似状态`() {
        val rows = JsonArray(listOf(todo(""), todo("one", "in_progress"), obj("""{"title":"fake","status":"pending"}"""),
            obj("""{"content":1,"status":"pending"}"""), todo("bad", "InProgress"),
            todo("bad", " pending"), JsonPrimitive(false), todo("two", "completed")))
        assertEquals(listOf(SessionTodo("", SessionTodoStatus.Pending),
            SessionTodo("one", SessionTodoStatus.InProgress), SessionTodo("two", SessionTodoStatus.Completed)),
            load(message(rows)).messages.single().todos)
    }

    @Test fun `其他工具与非toolResult角色不能伪造todo但工具错误仍可见`() {
        for ((role, tool) in listOf("toolResult" to "bash", "toolResult" to "Todo",
            "assistant" to "todo", "user" to "todo", "future-role" to "todo")) {
            val actual = load(message(role = role, tool = tool, error = JsonPrimitive(true))).messages.single()
            assertNull(actual.todos)
            assertEquals(role == "toolResult", actual.isError)
        }
        val noTool = JsonObject(message() - "toolName")
        assertNull(load(noTool).messages.single().todos)
    }

    @Test fun `isError仅接受真正布尔true且坏optional字段不拒绝消息`() {
        for (value in listOf(null, JsonPrimitive(false), JsonPrimitive("true"), JsonPrimitive(1),
            Json.parseToJsonElement("null"), obj("{}"), JsonArray(emptyList()))) {
            val actual = load(message(error = value)).messages.single()
            assertFalse(actual.isError)
            assertEquals(1, actual.todos?.size)
        }
    }

    @Test fun `每条todo限制4096字符且超长不伪装为空清单`() {
        val edge = "界".repeat(4096)
        assertEquals(edge, load(message(JsonArray(listOf(todo(edge))))).messages.single().todos?.single()?.content)
        val oversized = todo(edge + "x")
        assertNull(load(message(JsonArray(listOf(oversized)))).messages.single().todos)
        assertEquals(listOf(SessionTodo("kept", SessionTodoStatus.Pending)),
            load(message(JsonArray(listOf(oversized, todo("kept"))))).messages.single().todos)
    }

    @Test fun `单消息最多64条超界只丢optional元数据而不丢正文`() {
        val edge = JsonArray(List(64) { todo("task-$it") })
        assertEquals(64, load(message(edge)).messages.single().todos?.size)
        val actual = load(message(JsonArray(edge + todo("too-many")))).messages.single()
        assertNull(actual.todos)
        assertEquals(1, actual.content.size)
    }

    private fun largeMessage() = message(JsonArray(List(64) { todo("x".repeat(4096)) }), text = "small")
    private fun retainedTextWeight(view: SessionTimeline) = view.messages.sumOf { message ->
        message.todos.orEmpty().sumOf { 2L * it.content.length } + message.content.sumOf {
            2L * ((it["text"] as? JsonPrimitive)?.content?.length ?: 0)
        }
    }

    @Test fun `快照尾窗预算也计入todo文字而不是只有正文`() {
        val actual = load(*Array(20) { largeMessage() })
        assertTrue("Must trim todo-heavy messages", actual.baseIndex > 0)
        assertEquals(19L, actual.messages.last().index)
        assertTrue(actual.messages.all { it.todos?.size == 64 })
        assertTrue(retainedTextWeight(actual) <= 4_000_000L)
    }

    @Test fun `大量短todo的条目数量也占用尾窗预算`() {
        val manySmall = message(JsonArray(List(64) { todo("x".repeat(16)) }), text = "small")
        // All 1,000 messages fit both the message count and text-only budgets.
        val actual = load(*Array(1_000) { manySmall })
        assertTrue("Each retained todo row needs a structural charge", actual.baseIndex > 0)
        assertEquals(999L, actual.messages.last().index)
        assertTrue(actual.messages.all { it.todos?.size == 64 })
    }

    @Test fun `长期增量不能靠todo绕过尾窗保留预算`() {
        var actual = load()
        for (index in 0 until 20) actual = event(actual, largeMessage(), index.toLong(), index + 1L)
        assertTrue(actual.baseIndex > 0)
        assertEquals(19L, actual.messages.last().index)
        assertTrue(retainedTextWeight(actual) <= 4_000_000L)
    }

    @Test fun `history合并也执行todo总预算且保留最新尾窗`() {
        val current = load(*Array(4) { largeMessage() }, base = 10)
        val actual = history(current, 0, List(14) { largeMessage() })
        assertTrue(actual.baseIndex > 0)
        assertTrue(actual.baseIndex < 10)
        assertEquals(13L, actual.messages.last().index)
        assertEquals(current.messages, actual.messages.takeLast(4))
        assertTrue(retainedTextWeight(actual) <= 4_000_000L)
    }

    @Test fun `正文已接近单消息预算时只舍弃超额todo不拒绝整个快照`() {
        val actual = load(message(JsonArray(listOf(todo("x".repeat(4096)))),
            text = "b".repeat(1_999_000))).messages.single()
        assertNull(actual.todos)
        assertEquals(1_999_000, (actual.content.single()["text"] as JsonPrimitive).content.length)
    }

    @Test fun `正文占满预算时仍保留不占额外空间的明确清空`() {
        // This text plus the single text part's structural weight fills MAX_CONTENT_WEIGHT exactly.
        val actual = load(message(JsonArray(emptyList()), text = "b".repeat(1_999_924))).messages.single()
        assertEquals(emptyList<SessionTodo>(), actual.todos)
    }
}
