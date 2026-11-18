package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionTimelineTest {
    private fun obj(source: String) = Json.parseToJsonElement(source) as JsonObject
    private fun cursor(seq: Long = 0, epoch: String = "epoch") = obj("""{"epoch":"$epoch","seq":$seq}""")
    private fun message(text: String = "hello", role: String = "assistant") = JsonObject(mapOf(
        "role" to JsonPrimitive(role),
        "content" to JsonArray(listOf(obj("""{"type":"text","text":${JsonPrimitive(text)}}"""))),
        "timestamp" to JsonPrimitive(123),
    ))
    private fun snapshot(
        base: Long = 0,
        messages: List<JsonElement> = listOf(message()),
        seq: Long = 0,
        epoch: String = "epoch",
        fields: JsonObject = obj("{}"),
    ): JsonObject = obj("""{
      "type":"session-sync","sessionId":"s1","requestId":"r1",
      "cursor":${cursor(seq, epoch)},"mode":"snapshot",
      "snapshot":{"type":"snapshot","sessions":[${JsonObject(mapOf(
          "sessionId" to JsonPrimitive("s1"), "identity" to obj("""{"sessionId":"s1","generation":"g1"}"""),
          "baseIndex" to JsonPrimitive(base), "messages" to JsonArray(messages),
      ) + fields)}]}
    }""")
    private fun baseline(base: Long = 0, count: Int = 1, seq: Long = 0): SessionTimeline {
        val view = SessionTimelineReducer.sync(SessionTimeline("s1"),
            snapshot(base, (0 until count).map { message("message-$it") }, seq))
        assertNotNull("A valid TS snapshot must establish the baseline", view)
        return requireNotNull(view)
    }
    private fun event(body: JsonObject, seq: Long = 1, epoch: String = "epoch"): JsonObject = JsonObject(mapOf(
        "type" to JsonPrimitive("agent-event"),
        "cursor" to cursor(seq, epoch),
        "event" to JsonObject(mapOf("sessionId" to JsonPrimitive("s1")) + body),
    ))
    private fun replay(from: Long, events: List<JsonObject>, epoch: String = "epoch"): JsonObject = obj("""{
      "type":"session-sync","sessionId":"s1","requestId":"r2","mode":"replay",
      "cursor":${cursor(from + events.size, epoch)},"fromSeq":$from,"events":${JsonArray(events)}
    }""")
    private fun history(base: Long, messages: List<JsonElement>): JsonObject = JsonObject(mapOf(
        "type" to JsonPrimitive("history"), "sessionId" to JsonPrimitive("s1"),
        "baseIndex" to JsonPrimitive(base), "messages" to JsonArray(messages),
    ))
    private fun body(type: String, vararg fields: Pair<String, JsonElement>) = JsonObject(mapOf(
        "type" to JsonPrimitive(type), "sessionId" to JsonPrimitive("s1"), *fields,
    ))
    private fun upsert(index: Long, text: String = "updated") = body("message-upsert",
        "index" to JsonPrimitive(index), "message" to message(text))
    private fun text(message: SessionMessage) = (message.content.first()["text"] as JsonPrimitive).content

    @Test fun `公开模型缺省值与请求接口可供UI直接使用`() {
        val empty = SessionTimeline("s1")
        assertNull(empty.cursor)
        assertEquals(0L, empty.baseIndex)
        assertTrue(empty.messages.isEmpty())
        assertNull(empty.status)
        assertNull(empty.error)
        assertTrue(empty.approvals.isEmpty())
        assertTrue(empty.asks.isEmpty())
        assertFalse(SessionApproval("r", "bash", "command", "run").reviewing)
        assertFalse(SessionApproval("r", "bash", "command", "run").protected)
        assertEquals(emptyList<String>(), SessionAsk("q", "?").options)
        assertNull(SessionMessage(0, "user", emptyList()).timestamp)
    }

    @Test fun `TS fake host尾窗快照按绝对index读取且原子替换状态`() {
        val old = baseline(0, 3).copy(status = "failed", error = "old", approvals = listOf(
            SessionApproval("old", "bash", "command", "old")))
        val result = requireNotNull(SessionTimelineReducer.sync(old, snapshot(20, listOf(message("new")),
            seq = 8, epoch = "restarted", fields = obj("""{"status":"running"}"""))))
        assertEquals(20L, result.baseIndex)
        assertEquals(listOf(20L), result.messages.map { it.index })
        assertEquals("new", text(result.messages.single()))
        assertEquals(123L, result.messages.single().timestamp)
        assertEquals(cursor(8, "restarted"), result.cursor)
        assertEquals("running", result.status)
        assertNull(result.error)
        assertTrue(result.approvals.isEmpty())
        assertEquals(3, old.messages.size)
    }

    @Test fun `空快照清掉正文而不是保留缓存且缺省状态idle`() {
        val next = requireNotNull(SessionTimelineReducer.sync(baseline(), snapshot(messages = emptyList())))
        assertTrue(next.messages.isEmpty())
        assertEquals("idle", next.status)
        assertEquals(0L, next.baseIndex)
    }

    @Test fun `未知role和内容块完整保留包括嵌套future数据`() {
        val incoming = obj("""{"role":"future-role","content":[
          {"type":"future-part","nested":{"values":[1,true,null]},"text":"untouched"},
          {"type":"toolCall","id":"t","name":"bash","arguments":{"command":"echo fixture"}}
        ],"toolCallId":"t","toolName":"bash"}""")
        val next = requireNotNull(SessionTimelineReducer.sync(SessionTimeline("s1"), snapshot(messages = listOf(incoming))))
        assertEquals("future-role", next.messages.single().role)
        assertEquals((incoming["content"] as JsonArray).toList(), next.messages.single().content)
        assertEquals("t", next.messages.single().toolCallId)
        assertEquals("bash", next.messages.single().toolName)
    }

    @Test fun `快照拒绝跨会话identity多会话和坏正文且不部分接受`() {
        val previous = baseline()
        val session = (snapshot()["snapshot"] as JsonObject)["sessions"] as JsonArray
        val badBodies = listOf(
            JsonObject((session.single() as JsonObject) + ("sessionId" to JsonPrimitive("other"))),
            JsonObject((session.single() as JsonObject) + ("identity" to obj("""{"sessionId":"other"}"""))),
            JsonObject((session.single() as JsonObject) + ("messages" to JsonArray(listOf(message(), obj("""{"role":"user","content":[1]}"""))))),
        )
        for (bad in badBodies) {
            val frame = JsonObject(snapshot() + ("snapshot" to obj("""{"type":"snapshot","sessions":[$bad]}""")))
            assertNull(SessionTimelineReducer.sync(previous, frame))
        }
        assertNull(SessionTimelineReducer.sync(previous,
            JsonObject(snapshot() + ("snapshot" to obj("""{"type":"snapshot","sessions":${JsonArray(session + session)}}""")))))
        assertEquals("message-0", text(previous.messages.single()))
    }

    @Test fun `游标和绝对index遵守JS安全整数及严格信封边界`() {
        val previous = baseline()
        for (invalid in listOf("-1", "1.5", "9007199254740992", "\"1\"", "null", "true")) {
            val bad = JsonObject(snapshot() + ("cursor" to obj("""{"epoch":"epoch","seq":$invalid}""")))
            assertNull(SessionTimelineReducer.sync(previous, bad))
            assertNull(SessionTimelineReducer.event(previous, event(body("message-upsert",
                "index" to Json.parseToJsonElement(invalid), "message" to message()))))
        }
        assertNull(SessionTimelineReducer.sync(previous, JsonObject(snapshot() + ("extra" to JsonPrimitive(1)))))
        val maxIndex = 9_007_199_254_740_991L
        assertNull(SessionTimelineReducer.sync(previous, snapshot(maxIndex, listOf(message(), message()))))
        val edge = requireNotNull(SessionTimelineReducer.sync(previous, snapshot(maxIndex)))
        assertEquals(maxIndex, edge.messages.single().index)
        assertNull(SessionTimelineReducer.history(edge, history(maxIndex, listOf(message(), message()))))
        val decimal = obj("""{"epoch":"epoch","seq":1e0}""")
        assertNotNull(SessionTimelineReducer.event(previous,
            JsonObject(event(body("future-event")) + ("cursor" to decimal))))
    }

    @Test fun `live必须先有快照且不接受无cursor事件`() {
        assertNull(SessionTimelineReducer.event(SessionTimeline("s1"), event(upsert(0))))
        assertNull(SessionTimelineReducer.event(baseline(), JsonObject(event(upsert(0)) - "cursor")))
        assertNull(SessionTimelineReducer.sync(SessionTimeline("s1"), replay(0, emptyList())))
    }

    @Test fun `live连续推进pair游标并整条替换同index而不按worker seq判定`() {
        val previous = baseline(5, 2, seq = 10)
        val incoming = JsonObject(upsert(5) + ("seq" to JsonPrimitive(700)))
        val next = requireNotNull(SessionTimelineReducer.event(previous, event(incoming, seq = 11)))
        assertEquals(listOf(5L, 6L), next.messages.map { it.index })
        assertEquals("updated", text(next.messages.first()))
        assertEquals("message-0", text(previous.messages.first()))
        assertEquals(cursor(11), next.cursor)
    }

    @Test fun `重复过期live返回同一对象而epoch变化和序号缺口要求重订阅`() {
        val previous = baseline(seq = 5)
        assertSame(previous, SessionTimelineReducer.event(previous, event(upsert(0), seq = 5)))
        assertSame(previous, SessionTimelineReducer.event(previous, event(upsert(0), seq = 2)))
        assertNull(SessionTimelineReducer.event(previous, event(upsert(0), seq = 7)))
        assertNull(SessionTimelineReducer.event(previous, event(upsert(0), seq = 6, epoch = "other")))
    }

    @Test fun `live与replay均拒绝identity归属冲突`() {
        val previous = baseline()
        val foreign = JsonObject(upsert(0) + ("identity" to obj("""{"sessionId":"other","generation":"g"}""")))
        assertNull(SessionTimelineReducer.event(previous, event(foreign)))
        assertNull(SessionTimelineReducer.sync(previous, replay(0, listOf(foreign))))
        assertNull(SessionTimelineReducer.event(previous, event(JsonObject(upsert(0) + ("sessionId" to JsonPrimitive("other"))))))
    }

    @Test fun `未知事件安全跳过但仍推进连续游标`() {
        val previous = baseline()
        val next = requireNotNull(SessionTimelineReducer.event(previous,
            event(body("future-event", "payload" to obj("""{"a":[true,null]}""")))))
        assertEquals(previous.copy(cursor = cursor(1)), next)
        assertNull(SessionTimelineReducer.event(previous, event(body("session-invalidated"))))
        assertNull(SessionTimelineReducer.event(previous, event(body("worker-exited"))))
    }

    @Test fun `replay要求同epoch且fromSeq精确匹配快照游标`() {
        val previous = baseline(seq = 5)
        assertNull(SessionTimelineReducer.sync(previous, replay(4, listOf(body("future-event")))))
        assertNull(SessionTimelineReducer.sync(previous, replay(5, emptyList(), epoch = "other")))
        val empty = requireNotNull(SessionTimelineReducer.sync(previous, replay(5, emptyList())))
        assertEquals(previous, empty)
    }

    @Test fun `replay按顺序归并且任一坏事件使整包失败不留半包正文`() {
        val previous = baseline()
        val events = listOf(upsert(1, "one"), body("future-event"), upsert(1, "two"))
        val next = requireNotNull(SessionTimelineReducer.sync(previous, replay(0, events)))
        assertEquals(listOf("message-0", "two"), next.messages.map(::text))
        assertEquals(cursor(3), next.cursor)
        assertNull(SessionTimelineReducer.sync(previous, replay(0, events + body("message-upsert"))))
        assertEquals(listOf("message-0"), previous.messages.map(::text))
        assertNull(SessionTimelineReducer.sync(previous, JsonObject(replay(0, events) + ("cursor" to cursor(9)))))
    }

    @Test fun `messages truncated按绝对length裁尾并允许index重用`() {
        val previous = baseline(10, 3)
        val truncated = requireNotNull(SessionTimelineReducer.event(previous,
            event(body("messages-truncated", "length" to JsonPrimitive(11)))))
        assertEquals(listOf(10L), truncated.messages.map { it.index })
        val rewritten = requireNotNull(SessionTimelineReducer.event(truncated, event(upsert(11, "rebuilt"), seq = 2)))
        assertEquals(listOf(10L, 11L), rewritten.messages.map { it.index })
        assertEquals("rebuilt", text(rewritten.messages.last()))
        val empty = requireNotNull(SessionTimelineReducer.event(rewritten,
            event(body("messages-truncated", "length" to JsonPrimitive(0)), seq = 3)))
        assertTrue(empty.messages.isEmpty())
        assertEquals(0L, empty.baseIndex)
    }

    @Test fun `截断早于保留尾窗时不能声称已有完整基线`() {
        val previous = baseline(10, 2)
        assertNull(SessionTimelineReducer.event(previous, event(body("messages-truncated", "length" to JsonPrimitive(10)))))
        assertNull(SessionTimelineReducer.sync(previous, replay(0,
            listOf(body("messages-truncated", "length" to JsonPrimitive(5))))))
    }

    @Test fun `审批读取权威phase和protected类别并按requestId原位替换和解决`() {
        val previous = baseline()
        val request = obj("""{"requestId":"r1","tool":"bash","kind":"command","summary":"echo fixture",
          "toolCallId":"t1","phase":"reviewing","protected":"delete","expiresAt":12345}""")
        val pending = requireNotNull(SessionTimelineReducer.event(previous,
            event(body("approval-request", "request" to request))))
        assertEquals(SessionApproval("r1", "bash", "command", "echo fixture", "t1", true, true, 12345), pending.approvals.single())
        val fallback = requireNotNull(SessionTimelineReducer.event(pending, event(body("approval-request",
            "request" to JsonObject(request - "phase" - "protected")), seq = 2)))
        assertEquals(1, fallback.approvals.size)
        assertFalse(fallback.approvals.single().reviewing)
        assertFalse(fallback.approvals.single().protected)
        assertTrue(pending.approvals.single().reviewing)
        val resolved = requireNotNull(SessionTimelineReducer.event(fallback,
            event(body("approval-resolved", "requestId" to JsonPrimitive("r1")), seq = 3)))
        assertTrue(resolved.approvals.isEmpty())
    }

    @Test fun `提问读取ask而非request支持selectionOnly去重和解决`() {
        val ask = obj("""{"requestId":"q1","question":"Which format?","options":["Short","Detailed"],"selectionOnly":true,"expiresAt":999}""")
        val previous = baseline()
        val pending = requireNotNull(SessionTimelineReducer.event(previous, event(body("ask-request", "ask" to ask))))
        assertEquals(SessionAsk("q1", "Which format?", listOf("Short", "Detailed"), true, 999), pending.asks.single())
        val repeat = requireNotNull(SessionTimelineReducer.event(pending, event(body("ask-request", "ask" to ask), seq = 2)))
        assertEquals(1, repeat.asks.size)
        val resolved = requireNotNull(SessionTimelineReducer.event(repeat,
            event(body("ask-resolved", "requestId" to JsonPrimitive("q1")), seq = 3)))
        assertTrue(resolved.asks.isEmpty())
        assertNull(SessionTimelineReducer.event(previous,
            event(body("ask-request", "ask" to JsonObject(ask + ("options" to obj("{}")))))))
    }

    @Test fun `快照pending列表与旧式平铺请求同样可解析`() {
        val approval = obj("""{"requestId":"r","tool":"edit","kind":"file-edit","summary":"path"}""")
        val ask = obj("""{"requestId":"q","question":"Continue?"}""")
        val next = requireNotNull(SessionTimelineReducer.sync(SessionTimeline("s1"), snapshot(fields = obj("""{
          "pendingApprovals":[$approval],"pendingAsks":[$ask]
        }"""))))
        assertEquals("r", next.approvals.single().requestId)
        assertEquals("q", next.asks.single().requestId)
        val flatApproval = JsonObject(body("approval-request") + approval)
        val flatAsk = JsonObject(body("ask-request") + ask)
        assertNotNull(SessionTimelineReducer.event(next, event(flatApproval)))
        assertNotNull(SessionTimelineReducer.event(next, event(flatAsk)))
    }

    @Test fun `status和回合完成失败更新可见error且坏字段不推进游标`() {
        val previous = baseline()
        val failed = requireNotNull(SessionTimelineReducer.event(previous,
            event(body("turn-failed", "error" to JsonPrimitive("fixture failure")))))
        assertEquals("failed", failed.status)
        assertEquals("fixture failure", failed.error)
        val running = requireNotNull(SessionTimelineReducer.event(failed,
            event(body("status", "status" to JsonPrimitive("running")), seq = 2)))
        assertEquals("running", running.status)
        assertNull(running.error)
        val done = requireNotNull(SessionTimelineReducer.event(failed, event(body("turn-completed"), seq = 2)))
        assertEquals("idle", done.status)
        assertNull(done.error)
        assertNull(SessionTimelineReducer.event(previous, event(body("status", "status" to JsonPrimitive(1)))))
        assertNull(SessionTimelineReducer.event(previous, event(body("turn-failed", "error" to JsonPrimitive(false)))))
    }

    @Test fun `history只补前缀不覆盖较新的live upsert或状态审批cursor`() {
        val current = baseline(10, 2).copy(status = "running", error = "kept", approvals = listOf(
            SessionApproval("r", "bash", "command", "run")))
        val updated = requireNotNull(SessionTimelineReducer.event(current, event(upsert(10, "latest"))))
        val next = requireNotNull(SessionTimelineReducer.history(updated,
            history(8, listOf(message("eight"), message("nine"), message("stale-ten"), message("stale-eleven")))))
        assertEquals(listOf(8L, 9L, 10L, 11L), next.messages.map { it.index })
        assertEquals(listOf("eight", "nine", "latest", "message-1"), next.messages.map(::text))
        assertEquals(8L, next.baseIndex)
        assertEquals(updated.copy(baseIndex = next.baseIndex, messages = next.messages), next)
    }

    @Test fun `history空页和纯重叠幂等返回原对象不允许断开的旧页`() {
        val previous = baseline(10, 2)
        assertSame(previous, SessionTimelineReducer.history(previous, history(0, emptyList())))
        assertSame(previous, SessionTimelineReducer.history(previous, history(10, listOf(message("stale")))))
        assertNull(SessionTimelineReducer.history(previous, history(5, listOf(message("gap")))))
        assertNull(SessionTimelineReducer.history(previous,
            JsonObject(history(9, listOf(message())) + ("sessionId" to JsonPrimitive("other")))))
        assertNull(SessionTimelineReducer.history(previous, history(-1, listOf(message()))))
        assertNull(SessionTimelineReducer.history(previous, history(9, listOf(obj("""{"content":[]}""")))))
    }

    @Test fun `大量消息只保留有界尾窗丢弃区的upsert仍推进cursor`() {
        val incoming = (0 until 1_010).map { message("m-$it") }
        val previous = requireNotNull(SessionTimelineReducer.sync(SessionTimeline("s1"), snapshot(messages = incoming)))
        assertEquals(1_000, previous.messages.size)
        assertEquals(10L, previous.baseIndex)
        assertEquals(1_009L, previous.messages.last().index)
        val updated = requireNotNull(SessionTimelineReducer.event(previous, event(upsert(0))))
        assertEquals(previous.copy(cursor = cursor(1)), updated)
        val next = requireNotNull(SessionTimelineReducer.event(updated, event(upsert(1_010), seq = 2)))
        assertEquals(1_000, next.messages.size)
        assertEquals(11L, next.baseIndex)
    }

    @Test fun `长期大正文流限制总保留量而非仅限制消息条数`() {
        var timeline = baseline(count = 0)
        val large = "x".repeat(200_000)
        for (i in 0 until 30) timeline = requireNotNull(SessionTimelineReducer.event(timeline,
            event(upsert(i.toLong(), large), seq = i + 1L)))
        assertTrue(timeline.messages.sumOf { text(it).length.toLong() } <= 4_000_000L)
        assertEquals(29L, timeline.messages.last().index)
        assertTrue(timeline.baseIndex > 0)
    }

    @Test fun `坏请求列表和非法可选字段拒绝而不悄悄开放操作`() {
        val previous = baseline()
        for (fields in listOf(
            obj("""{"pendingApprovals":[{"requestId":"r","tool":"bash","kind":"command"}]}"""),
            obj("""{"pendingAsks":[{"requestId":"q","question":"?","selectionOnly":true,"options":[]}]}"""),
            obj("""{"pendingAsks":[{"requestId":"q","question":"?","selectionOnly":true,"options":["x","x"]}]}"""),
            obj("""{"status":42}"""),
        )) assertNull(SessionTimelineReducer.sync(previous, snapshot(fields = fields)))
        for (fields in listOf("\"timestamp\":\"123\"", "\"toolCallId\":true", "\"toolName\":[]")) {
            assertNull(SessionTimelineReducer.sync(previous,
                snapshot(messages = listOf(obj("""{"role":"toolResult","content":[],$fields}""")))))
        }
    }
}
