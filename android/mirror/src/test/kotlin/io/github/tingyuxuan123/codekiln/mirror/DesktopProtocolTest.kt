package io.github.tingyuxuan123.eaves.mirror

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.*
import org.junit.Test

class DesktopProtocolTest {
    private fun read(text: String) = desktopRead(Json.parseToJsonElement(text) as JsonObject)

    private fun catalog(entries: String) = desktopCatalog(
        Json.parseToJsonElement("""{"type":"catalog","entries":$entries}""") as JsonObject,
    )

    @Test fun `catalog accepts current desktop optional fields and ignores future fields`() {
        val result = catalog("""[{"id":"a","title":"任务","projectName":"Enso","status":"future-status","updatedAt":1730000000000,"pendingApprovalCount":2,"pendingAskCount":3,"pinned":true,"archived":false,"future":{}}]""")
        assertEquals(listOf(DesktopTask("a", "任务", "Enso", 1730000000000, "future-status", 2, 3, true, false)), result)
        assertEquals(listOf(DesktopTask("b", "", "", status = "idle")), catalog("""[{"id":"b","title":"","projectName":"","status":"idle"}]"""))
    }

    @Test fun `dirty catalog entries cannot manufacture identities counts or booleans`() {
        val base = """"id":"ok","title":"ok","projectName":"p","status":"idle""""
        assertEquals(listOf(DesktopTask("ok", "ok", "p", status = "idle")), catalog("""[null,1,{},{$base,"pendingAskCount":-1},{$base,"pendingAskCount":"2"},{$base,"pinned":"true"},{$base,"updatedAt":1.5},{$base},{$base}]"""))
        assertNull(catalog("{}"))
        assertEquals(emptyList<DesktopTask>(), catalog("[]"))
    }

    @Test fun `desktop slim catalog omits project name outside subscription without losing the task`() {
        val rows = catalog("""[{"id":"cold","title":"Cold task","projectId":"p","status":"idle"},{"id":"bad","title":"Bad","projectName":true,"status":"idle"}]""")!!
        assertEquals(listOf("cold"), rows.map { it.id })
        assertEquals("", rows.single().projectName)
        assertEquals("p", rows.single().projectId)
    }

    @Test fun `creation metadata is recognized as desktop reads`() {
        assertNotNull(read("""{"type":"projects","projects":[]}"""))
        assertNotNull(read("""{"type":"providers","providers":[]}"""))
    }

    @Test fun `queue parser retains exact ordered rows and omitted selected queue is empty but slim rows are unknown`() {
        val result = read("""{"type":"catalog","entries":[
            {"id":"s","title":"Selected","projectName":"Project","status":"running","queued":[
                {"id":"second","text":" exact \\n","hasImages":true,"images":[{"path":"/secret"}]},
                {"id":"first","text":""}]},
            {"id":"empty","title":"Empty","projectName":"Project","status":"idle"},
            {"id":"slim","title":"Slim","status":"idle"}]}""") as DesktopRead.Catalog
        assertEquals(listOf(DesktopQueuedMessage("second", " exact \\n", true),
            DesktopQueuedMessage("first", "")), result.queues["s"])
        assertEquals(emptyList<DesktopQueuedMessage>(), result.queues["empty"])
        assertFalse(result.queues.containsKey("slim"))
    }

    @Test fun `malformed duplicate or oversized queues stay unknown instead of manufacturing removals`() {
        val invalid = listOf("null", "{}", "[null]", "[{}]", """[{"id":1,"text":"x"}]""",
            """[{"id":" ","text":"x"}]""", """[{"id":"q","text":false}]""",
            """[{"id":"q","text":"x","hasImages":"true"}]""",
            """[{"id":"q","text":"x"},{"id":"q","text":"different"}]""",
            """[{"id":"${"i".repeat(513)}","text":"x"}]""",
            """[{"id":"q","text":"${"x".repeat(SESSION_TEXT_LIMIT + 1)}"}]""",
            (0..128).joinToString(",", "[", "]") { """{"id":"q$it","text":"x"}""" })
        for (queue in invalid) {
            val result = read("""{"type":"catalog","entries":[{"id":"s","title":"Task","status":"running","queued":$queue}]}""") as DesktopRead.Catalog
            assertEquals("Malformed queue must not discard its task", listOf("s"), result.tasks.map { it.id })
            assertTrue(result.queues.containsKey("s"))
            assertNull("Malformed queue must not mean empty", result.queues["s"])
        }
        val duplicate = read("""{"type":"catalog","entries":[
            {"id":"s","title":"Task","status":"idle","queued":[{"id":"q","text":"keep"}]},
            {"id":"s","title":"Duplicate","status":"idle","queued":[]}]}""") as DesktopRead.Catalog
        assertEquals(1, duplicate.tasks.size)
        assertNull(duplicate.queues["s"])
    }

    @Test fun `creation metadata is typed deduped local and display-only`() {
        val projects = read("""{"type":"projects","projects":[null,{},
            {"id":"local","name":"Folder","alias":"  Alias  ","kind":"local","path":"/secret"},
            {"id":"local","name":"Duplicate","path":"/second"},
            {"id":"legacy","name":"Legacy","alias":" ","path":"/legacy"},
            {"id":"remote","name":"Remote","kind":"ssh","path":"/remote"},
            {"id":"archived","name":"Archived","archived":true,"path":"/archived"},
            {"id":"ambiguous","name":"Ambiguous","archived":"false"},
            {"id":"future","name":"Future","kind":"other"},
            {"id":17,"name":"Bad"},{"id":" ","name":"Bad"},{"id":"bad","name":false}]}
        """.trimIndent()) as DesktopRead.Projects
        assertEquals(listOf(DesktopProject("local", "Alias"), DesktopProject("legacy", "Legacy")), projects.projects)

        val providers = read("""{"type":"providers","providers":[null,{},
            {"id":"a","name":"Provider","apiKey":"secret","models":[{}, {"id":"m","label":"Model"},
                {"id":"m","label":"Duplicate"},{"id":"fallback"},{"id":"blank","label":" "}, {"id":1}]},
            {"id":"a","name":"Duplicate","models":[{"id":"not-enabled"}]},
            {"id":"b","name":"Disabled","models":[]}, {"id":"bad","name":"Bad","models":{}},
            {"id":"${"x".repeat(513)}","name":"Oversized","models":[]}]}
        """.trimIndent()) as DesktopRead.Providers
        assertEquals(listOf(DesktopProvider("a", "Provider", listOf(DesktopModel("m", "Model"),
            DesktopModel("fallback", "fallback"), DesktopModel("blank", "blank"))),
            DesktopProvider("b", "Disabled", emptyList())), providers.providers)
        assertNull(read("""{"type":"providers","providers":{}}"""))
    }

    @Test fun `exponential retry jitter is bounded even for exhausted attempt counters`() {
        assertEquals(700L, linkBackoffMillis(0, 0.0))
        assertEquals(1300L, linkBackoffMillis(0, 1.0))
        assertEquals(2000L, linkBackoffMillis(1, 0.5))
        assertEquals(30000L, linkBackoffMillis(Int.MAX_VALUE, 1.0))
        assertEquals(21000L, linkBackoffMillis(Int.MAX_VALUE, 0.0))
    }
}
