package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionSyncTest {
    private val valid = Json.parseToJsonElement("""{
      "type":"session-sync", "sessionId":"s1", "requestId":"r1",
      "cursor":{"epoch":"epoch1","seq":1}, "mode":"replay", "fromSeq":0,
      "events":[{"type":"future-event","sessionId":"s1","future":true}]
    }""").let { it as JsonObject }

    @Test fun `连续replay通过且保留未知事件和嵌套字段`() {
        assertEquals(valid, SessionSync.parse(valid))
    }

    @Test fun `新增顶层键被拒绝但快照内的可扩展字段保留`() {
        assertNull(SessionSync.parse(JsonObject(valid + ("extra" to JsonPrimitive(true)))))
        val snapshot = Json.parseToJsonElement("""{
          "type":"session-sync","sessionId":"s1","requestId":"r2",
          "cursor":{"epoch":"e","seq":0},"mode":"snapshot",
          "snapshot":{"type":"snapshot","future":1,"sessions":[{
            "sessionId":"s1","messages":[],"baseIndex":0,"future":2
          }]}
        }""")
        assertEquals(snapshot, SessionSync.parse(snapshot))
    }

    @Test fun `重复不连续越界序号与跨会话事件均被拒绝`() {
        assertNull(SessionSync.parse(JsonObject(valid + ("fromSeq" to JsonPrimitive(2)))))
        assertNull(SessionSync.parse(JsonObject(valid + ("events" to JsonArray(emptyList())))))
        val foreign = Json.parseToJsonElement("""[{"type":"status","sessionId":"other"}]""")
        assertNull(SessionSync.parse(JsonObject(valid + ("events" to foreign))))
        val badCursor = Json.parseToJsonElement("""{"epoch":"e","seq":9007199254740992}""")
        assertNull(SessionSync.parse(JsonObject(valid + ("cursor" to badCursor))))
    }

    @Test fun `JSON数值的一和一点零等价但字符串序号不等价`() {
        val decimal = Json.parseToJsonElement("""{"epoch":"e","seq":1.0}""")
        val input = JsonObject(valid + ("cursor" to decimal))
        assertEquals(input, SessionSync.parse(input))
        val text = Json.parseToJsonElement("""{"epoch":"e","seq":"1"}""")
        assertNull(SessionSync.parse(JsonObject(valid + ("cursor" to text))))
    }
}
