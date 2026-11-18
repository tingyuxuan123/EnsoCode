package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionTasksTest {
    private fun obj(source: String) = Json.parseToJsonElement(source) as JsonObject
    private fun cursor(seq: Long = 0) = obj("""{"epoch":"e","seq":$seq}""")
    private fun sync(fields: JsonObject, seq: Long = 0, mode: String = "snapshot"): JsonObject = obj("""{
      "type":"session-sync","sessionId":"s","requestId":"r","cursor":${cursor(seq)},"mode":"$mode",
      "snapshot":{"type":"snapshot","sessions":[${JsonObject(mapOf(
        "sessionId" to JsonPrimitive("s"),
        "identity" to obj("""{"sessionId":"s","generation":"g"}"""),
        "baseIndex" to JsonPrimitive(0),
        "messages" to JsonArray(emptyList()),
        "status" to JsonPrimitive("running"),
      ) + fields)}]}
    }""")
    private fun event(body: String, seq: Long = 1): JsonObject = obj("""{
      "type":"agent-event","cursor":{"epoch":"e","seq":$seq},
      "event":${JsonObject(mapOf("sessionId" to JsonPrimitive("s")) + obj(body))}
    }""")
    private fun baseline(fields: JsonObject = obj("{}")) =
        requireNotNull(SessionTimelineReducer.sync(SessionTimeline("s"), sync(fields)))

    @Test fun `snapshot keeps bounded subagents and background tasks from real fields`() {
        val view = baseline(obj("""{
          "subagents":[{"id":"a1","description":"调研 IPC","status":"running","steps":3,
            "currentActivity":"grep handlers","agentType":"scout","modelId":"m","startedAt":100}],
          "backgroundTasks":[{"taskId":"t1","command":"pnpm dev","status":"running","tail":"ready",
            "startedAt":200}]
        }"""))
        assertEquals(listOf("a1"), view.subagents.map { it.id })
        assertEquals("调研 IPC", view.subagents.single().description)
        assertEquals(3L, view.subagents.single().steps)
        assertEquals("grep handlers", view.subagents.single().currentActivity)
        assertEquals("scout", view.subagents.single().agentType)
        assertEquals(100L, view.subagents.single().startedAt)
        assertEquals(listOf("t1"), view.backgroundTasks.map { it.taskId })
        assertEquals("pnpm dev", view.backgroundTasks.single().command)
        assertEquals("ready", view.backgroundTasks.single().tail)
        assertEquals(200L, view.backgroundTasks.single().startedAt)
    }

    @Test fun `dirty rows are dropped without erasing the valid neighbours`() {
        val view = baseline(obj("""{
          "subagents":[
            {"id":"ok","description":"good","status":"running","steps":0,"currentActivity":""},
            {"id":"bad","description":"x","status":"unknown","steps":0,"currentActivity":""},
            {"id":"neg","description":"x","status":"done","steps":-1,"currentActivity":""},
            {"id":"","description":"x","status":"done","steps":0,"currentActivity":""},
            {"id":"dup","description":"first","status":"running","steps":0,"currentActivity":""},
            {"id":"dup","description":"second","status":"running","steps":0,"currentActivity":""}
          ],
          "backgroundTasks":[
            {"taskId":"t","command":"c","status":"running","tail":"x"},
            {"taskId":"t2","command":"c","status":"done","tail":"x"},
            {"taskId":"","command":"c","status":"running","tail":"x"}
          ]
        }"""))
        assertEquals(listOf("ok", "dup"), view.subagents.map { it.id })
        assertEquals("second", view.subagents.last().description)
        assertEquals(listOf("t", "t2"), view.backgroundTasks.map { it.taskId })
        val bad = baseline(obj("""{"subagents":"nope","backgroundTasks":false}"""))
        assertTrue(bad.subagents.isEmpty())
        assertTrue(bad.backgroundTasks.isEmpty())
    }

    @Test fun `live subagent update and task events upsert, replace level snapshots and ignore unknown ids`() {
        var view = baseline()
        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"subagent-update","agent":{"id":"a1","description":"review","status":"running","steps":1,
            "currentActivity":"reading"}}""", 1))) ?: view
        assertEquals("a1", view.subagents.single().id)
        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"subagent-update","agent":{"id":"a1","description":"review","status":"done","steps":4,
            "currentActivity":"finished","resultText":"report"}}""", 2))) ?: view
        assertEquals(1, view.subagents.size)
        assertEquals("done", view.subagents.single().status)
        assertEquals("report", view.subagents.single().resultText)

        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"task-started","task":{"taskId":"t1","command":"pnpm dev","status":"running","tail":"start"}}""", 3))) ?: view
        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"task-output","taskId":"t1","tail":"compiled","status":"running"}""", 4))) ?: view
        assertEquals("compiled", view.backgroundTasks.single().tail)
        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"task-ended","taskId":"t1","status":"done","exitCode":0}""", 5))) ?: view
        assertEquals("done", view.backgroundTasks.single().status)
        assertEquals(0L, view.backgroundTasks.single().exitCode)
        // Unknown ids never invent rows.
        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"task-output","taskId":"ghost","tail":"x","status":"running"}""", 6))) ?: view
        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"task-ended","taskId":"ghost","status":"failed"}""", 7))) ?: view
        assertEquals(listOf("t1"), view.backgroundTasks.map { it.taskId })

        view = requireNotNull(SessionTimelineReducer.event(view, event("""{
          "type":"background-tasks-level","tasks":[{"taskId":"t9","command":"vitest","status":"running","tail":""}]}""", 8))) ?: view
        assertEquals(listOf("t9"), view.backgroundTasks.map { it.taskId })
    }

    @Test fun `a new snapshot replaces task projections and malformed arrays request a resync`() {
        var view = baseline(obj("""{"subagents":[{"id":"old","description":"x","status":"running","steps":0,"currentActivity":""}]}"""))
        assertEquals(listOf("old"), view.subagents.map { it.id })
        view = requireNotNull(SessionTimelineReducer.sync(view, sync(obj("{}"), seq = 1))) ?: view
        assertTrue(view.subagents.isEmpty())
        assertNull(SessionTimelineReducer.event(view, event("""{"type":"background-tasks-level","tasks":{}}""", 2)))
    }

    @Test fun `unrelated session tasks and stale frames do not touch the projection`() {
        val view = baseline()
        val other = obj("""{"type":"agent-event","cursor":{"epoch":"e","seq":9},"event":{
          "sessionId":"other","type":"task-started",
          "task":{"taskId":"x","command":"c","status":"running","tail":""}}}""")
        assertNull(SessionTimelineReducer.event(view, other))
        val stale = SessionTimelineReducer.event(view, event("""{
          "type":"task-started","task":{"taskId":"t","command":"c","status":"running","tail":""}}""", 0))
        assertTrue(stale == null || stale.backgroundTasks.isEmpty())
    }
}
