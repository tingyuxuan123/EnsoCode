package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class SessionTimelineBoundaryTest {
    @Test fun `尾窗之前的实时upsert推进游标但不当作历史分页插回正文`() {
        val snapshot = Json.parseToJsonElement("""{
            "type":"session-sync","mode":"snapshot","sessionId":"s1","requestId":"r1",
            "cursor":{"epoch":"e","seq":0},"snapshot":{"type":"snapshot","sessions":[{
              "sessionId":"s1","baseIndex":10,"messages":[{"role":"user","content":[{"type":"text","text":"尾窗"}]}]
            }]}}
        """).jsonObject
        val current = SessionTimelineReducer.sync(SessionTimeline("s1"), snapshot)!!
        val frame = Json.parseToJsonElement("""{
            "type":"agent-event","cursor":{"epoch":"e","seq":1},"event":{
              "type":"message-upsert","sessionId":"s1","index":1,
              "message":{"role":"assistant","content":[{"type":"text","text":"过早消息"}]}
            }}""").jsonObject
        val next = SessionTimelineReducer.event(current, frame)
        assertNotNull(next)
        assertEquals(10L, next!!.baseIndex)
        assertEquals(listOf(10L), next.messages.map { it.index })
        assertEquals(frame["cursor"], next.cursor)
    }
}
