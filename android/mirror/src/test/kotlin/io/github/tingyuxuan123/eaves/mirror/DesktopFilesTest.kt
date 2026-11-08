package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DesktopFilesTest {
    @Test fun `list sends the exact command and accepts the matching result`() = runTest {
        fixture { f ->
            f.ready()
            assertNull(f.session!!.files)
            f.list()
            runCurrent()
            val raw = f.sent().single()
            val requestId = listCommand.matchEntire(raw)?.groupValues?.get(1)
            assertNotNull("sent: $raw", requestId)
            assertTrue(f.session!!.files!!.listing)
            assertNull(f.session!!.files!!.listError)
            assertTrue(f.session!!.files!!.entries.isEmpty())
            f.listResult(requestId!!, """[{"id":"f1","name":"a.txt","size":12,"rel":"out/a.txt"},""" +
                """{"id":"f2","name":"b.png","size":0,"rel":"out/b.png"}]""")
            assertEquals(listOf(DesktopFileEntry("f1", "a.txt", 12, "out/a.txt"),
                DesktopFileEntry("f2", "b.png", 0, "out/b.png")), f.session!!.files!!.entries)
            assertFalse(f.session!!.files!!.listing)
            assertNull(f.session!!.files!!.listError)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `read sends the exact command and decodes standard Base64`() = runTest {
        fixture { f ->
            f.ready()
            f.listResult(f.listAndRequest(), """[{"id":"f1","name":"notes.md","size":8,"rel":"notes.md"}]""")
            f.read("f1", 4)
            runCurrent()
            val raw = f.sent().single()
            val requestId = readCommand.matchEntire(raw)?.groupValues?.get(1)
            assertNotNull("sent: $raw", requestId)
            assertTrue(f.session!!.files!!.reading)
            assertEquals("f1", f.session!!.files!!.readingFileId)
            assertEquals(4L, f.session!!.files!!.readOffset)
            val bytes = byteArrayOf(0, 1, 2, -1, -2, 127, -128, 10)
            // The host omits `name` when the phone's listing already names the file.
            f.readResult(requestId!!) {
                put("size", 8); put("offset", 4)
                put("data", Base64.getEncoder().encodeToString(bytes))
            }
            val chunk = f.session!!.files!!.chunk!!
            assertEquals("f1", chunk.fileId)
            assertEquals("notes.md", chunk.name)
            assertEquals(8L, chunk.size)
            assertEquals(4L, chunk.offset)
            assertArrayEquals(bytes, chunk.data)
            assertNull(chunk.error)
            assertFalse(f.session!!.files!!.reading)
            assertNull(f.session!!.files!!.readError)
            assertEquals(4L, f.session!!.files!!.readOffset)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.readResult(f.readAndRequest("f1", 0)) {
                put("name", "db.sqlite"); put("size", 4); put("offset", 0); put("data", "AQIDBA==")
            }
            assertEquals("db.sqlite", f.session!!.files!!.chunk!!.name)
        }
    }

    @Test fun `a repeat click never sends a second request of the same kind`() = runTest {
        fixture { f ->
            f.ready()
            f.list()
            f.list()
            runCurrent()
            assertEquals(1, f.sent().size)
            f.read("f1", 0)
            f.read("f2", 10)
            runCurrent()
            assertEquals(1, f.sent().size)
            // A read never blocks a list and a list never blocks a read.
            f.list()
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals("f1", f.session!!.files!!.readingFileId)
        }
    }

    @Test fun `timeout reports an error keeps the association and never resends`() = runTest {
        fixture { f ->
            f.ready()
            val requestId = f.listAndRequest()
            advanceTimeBy(14_000); runCurrent()
            assertTrue(f.session!!.files!!.listing)
            assertNull(f.session!!.files!!.listError)
            advanceTimeBy(1_100); runCurrent()
            assertFalse(f.session!!.files!!.listing)
            assertEquals("请求超时", f.session!!.files!!.listError)
            assertTrue(f.session!!.files!!.entries.isEmpty())
            assertTrue(f.commands().isEmpty())
            // A late answer still names the request it belongs to, so it settles it.
            f.listResult(requestId, """[{"id":"f1","name":"a","size":1,"rel":"a"}]""")
            assertFalse(f.session!!.files!!.listing)
            assertNull(f.session!!.files!!.listError)
            assertEquals(listOf("f1"), f.session!!.files!!.entries.map { it.id })
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            val requestId = f.readAndRequest("f1", 2)
            advanceTimeBy(14_000); runCurrent()
            assertTrue(f.session!!.files!!.reading)
            advanceTimeBy(1_100); runCurrent()
            assertFalse(f.session!!.files!!.reading)
            assertEquals("请求超时", f.session!!.files!!.readError)
            assertNull(f.session!!.files!!.chunk)
            assertTrue(f.commands().isEmpty())
            f.readResult(requestId) {
                put("name", "a"); put("size", 6); put("offset", 2); put("data", "AQIDBA==")
            }
            assertFalse(f.session!!.files!!.reading)
            assertNull(f.session!!.files!!.readError)
            assertEquals(4, f.session!!.files!!.chunk!!.data.size)
            assertEquals(2L, f.session!!.files!!.chunk!!.offset)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `results for another request session or generation are ignored`() = runTest {
        fixture { f ->
            f.ready()
            val requestId = f.listAndRequest()
            f.listResult("00000000-0000-0000-0000-000000000000", """[{"id":"bad","name":"a","size":1,"rel":"a"}]""")
            assertTrue(f.session!!.files!!.listing)
            assertTrue(f.session!!.files!!.entries.isEmpty())
            f.readResult("00000000-0000-0000-0000-000000000000") {
                put("size", 1); put("offset", 0); put("data", "AQ==")
            }
            assertNull(f.session!!.files!!.chunk)
            f.listResult(requestId, """[{"id":"f1","name":"a","size":1,"rel":"a"}]""")
            assertEquals(listOf("f1"), f.session!!.files!!.entries.map { it.id })
        }
        // Switching the selected session drops the projection and the in-flight request.
        fixture { f ->
            f.ready()
            val requestId = f.listAndRequest()
            f.link.selectSession("other"); runCurrent()
            assertEquals("other", f.session!!.timeline.sessionId)
            assertNull(f.session!!.files)
            f.listResult(requestId, """[{"id":"late","name":"a","size":1,"rel":"a"}]""")
            assertNull(f.session!!.files)
            // The new selection starts from an empty projection and can ask again.
            assertTrue(f.commands().all { it["type"].linkString() == "subscribe" })
            f.link.listFiles("other"); runCurrent()
            assertNotEquals(requestId, f.commands()
                .single { it["type"].linkString() == "file-list" }["requestId"].linkString())
            assertEquals(DesktopFilesState(listing = true), f.session!!.files)
        }
        // A reconnect is a new generation: the old request never lands and files stay empty.
        fixture { f ->
            f.ready()
            val requestId = f.listAndRequest()
            f.socket.failed(); runCurrent()
            advanceTimeBy(1_000); runCurrent()
            f.begin(existing = true); f.prove()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            assertNull(f.session!!.files)
            f.listResult(requestId, """[{"id":"late","name":"a","size":1,"rel":"a"}]""")
            assertNull(f.session!!.files)
        }
    }

    @Test fun `read-only host still allows listing and reading`() = runTest {
        fixture { f ->
            f.ready(readOnly = true)
            assertTrue(f.state.readOnly)
            f.listResult(f.listAndRequest(), """[{"id":"f1","name":"a.txt","size":1,"rel":"a.txt"}]""")
            assertEquals(listOf("f1"), f.session!!.files!!.entries.map { it.id })
            f.readResult(f.readAndRequest("f1", 0)) {
                put("name", "a.txt"); put("size", 1); put("offset", 0); put("data", "AQ==")
            }
            assertEquals(1, f.session!!.files!!.chunk!!.data.size)
        }
    }

    @Test fun `a hidden background link refuses file commands`() = runTest {
        fixture { f ->
            f.ready()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            f.commands()
            f.list()
            f.read("f1", 0)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.files)
        }
    }

    @Test fun `unusable session file id or offset never reaches the wire`() = runTest {
        fixture { f ->
            f.ready()
            f.link.listFiles("other")
            f.link.listFiles("")
            f.link.listFiles("s".repeat(513))
            f.link.readFile("s", "", 0)
            f.link.readFile("s", "   ", 0)
            f.link.readFile("s", "f".repeat(513), 0)
            f.link.readFile("s", "f1", -1)
            f.link.readFile("s", "f1", 9_007_199_254_740_992L)
            f.link.readFile("other", "f1", 0)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.files)
        }
    }

    @Test fun `bad rows are dropped one by one without failing the table`() = runTest {
        fixture { f ->
            f.ready()
            f.listResult(f.listAndRequest(), """
                [{"id":"good","name":"a.txt","size":5,"rel":"a.txt"},
                 {"name":"no-id","size":5,"rel":"x"},
                 {"id":"","name":"blank-id","size":5,"rel":"x"},
                 {"id":"blank-name","name":"  ","size":5,"rel":"x"},
                 {"id":"long-name","name":"${"n".repeat(513)}","size":5,"rel":"x"},
                 {"id":"no-rel","name":"a","size":5},
                 {"id":"long-rel","name":"a","size":0,"rel":"${"r".repeat(4097)}"},
                 {"id":"neg","name":"a","size":-1,"rel":"x"},
                 {"id":"fraction","name":"a","size":1.5,"rel":"x"},
                 {"id":"string-size","name":"a","size":"5","rel":"x"},
                 {"id":"huge","name":"a","size":9007199254740992,"rel":"x"},
                 {"id":"number-name","name":7,"size":1,"rel":"x"},
                 "row",
                 {"id":"good","name":"duplicate","size":1,"rel":"dup"},
                 {"id":"max-rel","name":"rel","size":0,"rel":"${"r".repeat(4096)}"},
                 {"id":"max-id","name":"${"n".repeat(512)}","size":0,"rel":"x"}]
            """.trimIndent())
            assertEquals(listOf("good", "max-rel", "max-id"), f.session!!.files!!.entries.map { it.id })
            assertEquals("a.txt", f.session!!.files!!.entries.first().name)
            assertEquals(4096, f.session!!.files!!.entries[1].rel.length)
            assertEquals(512, f.session!!.files!!.entries[2].name.length)
            assertNull(f.session!!.files!!.listError)
            assertFalse(f.session!!.files!!.listing)
        }
    }

    @Test fun `unusable list tables and host errors keep the previous entries`() = runTest {
        fixture { f ->
            f.ready()
            f.listResult(f.listAndRequest(), """[{"id":"old","name":"o","size":1,"rel":"o"}]""")
            // No `files` key at all is not an empty list.
            f.listResult(f.listAndRequest()) { put("error", "unavailable") }
            assertEquals(listOf("old"), f.session!!.files!!.entries.map { it.id })
            assertEquals("unavailable", f.session!!.files!!.listError)
            // A host error wins over a well-formed table and keeps the old entries.
            f.listResult(f.listAndRequest(), """[{"id":"new","name":"n","size":1,"rel":"n"}]""") {
                put("error", "changed")
            }
            assertEquals(listOf("old"), f.session!!.files!!.entries.map { it.id })
            assertEquals("changed", f.session!!.files!!.listError)
            // A non-array table and an oversized table are both invalid.
            f.listResult(f.listAndRequest()) { put("files", "nope") }
            assertEquals(listOf("old"), f.session!!.files!!.entries.map { it.id })
            assertNotNull(f.session!!.files!!.listError)
            val rows = (0..4_096).joinToString(",") { """{"id":"f$it","name":"n","size":1,"rel":"r"}""" }
            f.listResult(f.listAndRequest(), "[$rows]")
            assertEquals(listOf("old"), f.session!!.files!!.entries.map { it.id })
            assertNotNull(f.session!!.files!!.listError)
        }
    }

    @Test fun `invalid read payloads never write a chunk`() = runTest {
        fixture { f ->
            f.ready()
            // Keep a good chunk first so every rejection must preserve it.
            f.readResult(f.readAndRequest("f1", 0)) {
                put("name", "a"); put("size", 4); put("offset", 0); put("data", "AQIDBA==")
            }
            val good = f.session!!.files!!.chunk!!
            val payloads = listOf<JsonObjectBuilder.() -> Unit>(
                { put("size", 4); put("offset", 0) },                                    // no data
                { put("size", 4); put("offset", 0); put("data", "@@@@") },
                { put("size", 4); put("offset", 0); put("data", "AAA") },                // not padded
                { put("size", 4); put("offset", 0); put("data", "AQID=AAA") },
                { put("size", 4); put("offset", 0); put("data", 5) },                    // not text
                { put("size", 4); put("offset", 1); put("data", "AQIDBA==") },           // offset drift
                { put("offset", 0); put("data", "AQIDBA==") },                           // no size
                { put("size", -1); put("offset", 0); put("data", "AQIDBA==") },
                { put("size", 4.5); put("offset", 0); put("data", "AQIDBA==") },
                { put("size", "4"); put("offset", 0); put("data", "AQIDBA==") },
                { put("name", 7); put("size", 4); put("offset", 0); put("data", "AQIDBA==") },
                {
                    put("size", 4); put("offset", 0)
                    put("data", Base64.getEncoder().encodeToString(ByteArray(FILE_CHUNK_BYTES + 1)))
                },
            )
            for (payload in payloads) {
                f.readResult(f.readAndRequest("f1", 0), payload)
                assertFalse(f.session!!.files!!.reading)
                assertNotNull(f.session!!.files!!.readError)
                assertSame(good, f.session!!.files!!.chunk)
            }
            // Exactly one chunk is accepted, so the bound is inclusive.
            val full = Base64.getEncoder().encodeToString(ByteArray(FILE_CHUNK_BYTES))
            f.readResult(f.readAndRequest("f1", 0)) {
                put("name", "a"); put("size", FILE_CHUNK_BYTES); put("offset", 0); put("data", full)
            }
            assertNull(f.session!!.files!!.readError)
            assertEquals(FILE_CHUNK_BYTES, f.session!!.files!!.chunk!!.data.size)
        }
    }

    @Test fun `local send failure never pretends success`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.accept = false
            f.list()
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.session!!.files)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.socket.accept = false
            f.read("f1", 0)
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.session!!.files)
        }
    }

    private fun TestScope.fixture(block: (Fixture) -> Unit) {
        val f = Fixture(this)
        try { block(f) } finally { f.link.close(); runCurrent(); advanceTimeBy(1_001); runCurrent() }
    }

    private class Fixture(val scope: TestScope) {
        val key = ByteArray(32)
        val host = FrameReplay(key, ReplayRole.Host, announce = true)
        val sockets = mutableListOf<FakeSocket>()
        val socket get() = sockets.last()
        val link = DesktopLink(PairCredentials("pair-1", "token", key, "Eaves", "https://example.test"),
            {}, false, StandardTestDispatcher(scope.testScheduler), { scope.testScheduler.currentTime }, { 0.5 },
            { request, listener -> FakeSocket(request, listener).also(sockets::add) })
        val state get() = link.state.value
        val session get() = state.session
        fun begin(existing: Boolean = false) {
            if (!existing) link.setVisible(true)
            scope.runCurrent()
            socket.opened(); socket.text("pong"); socket.text("""{"type":"host-online"}""")
            scope.runCurrent(); host.peerReset()
        }
        fun prove() {
            socket.sent.forEach { host.open(it) }; socket.sent.clear()
            frame(json("""{"type":"replay-hello"}"""))
            assertEquals(LinkPhase.Online, state.phase)
        }
        fun ready(readOnly: Boolean = false) {
            link.selectSession("s"); begin(); prove()
            sync(commands().single { it["type"].linkString() == "subscribe" })
            frame(json("""{"type":"host-info","hostname":"Host","readOnly":$readOnly}"""))
        }
        fun list() = link.listFiles("s")
        fun read(fileId: String = "f1", offset: Long = 0) = link.readFile("s", fileId, offset)
        fun listAndRequest(): String {
            list(); scope.runCurrent()
            return commands().single { it["type"].linkString() == "file-list" }["requestId"].linkString()!!
        }
        fun readAndRequest(fileId: String = "f1", offset: Long = 0): String {
            read(fileId, offset); scope.runCurrent()
            return commands().single { it["type"].linkString() == "file-read" }["requestId"].linkString()!!
        }
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun listResult(requestId: String, files: String, extra: JsonObjectBuilder.() -> Unit = {}) =
            listResult(requestId) {
                put("files", Json.parseToJsonElement(files))
                extra()
            }
        fun listResult(requestId: String, fields: JsonObjectBuilder.() -> Unit = {}) {
            frame(result("file-list-result", requestId, fields))
        }
        fun readResult(requestId: String, fields: JsonObjectBuilder.() -> Unit) {
            frame(result("file-read-result", requestId, fields))
        }
        private fun result(type: String, requestId: String, fields: JsonObjectBuilder.() -> Unit) =
            buildJsonObject {
                put("type", type)
                put("requestId", requestId)
                fields()
            }
        fun sync(command: JsonObject, status: String = "idle", epoch: String = "e") {
            val requestId = (command["sync"] as JsonObject)["requestId"].linkString()
            frame(json("""{"type":"session-sync","sessionId":"s","requestId":"$requestId","cursor":{"epoch":"$epoch","seq":0},"mode":"snapshot","snapshot":{"type":"snapshot","sessions":[{"sessionId":"s","identity":{"sessionId":"s","generation":"g"},"baseIndex":0,"messages":[],"status":"$status"}]}}"""))
        }
        fun commands(): List<JsonObject> = socket.sent.mapNotNull { host.open(it)?.payload }.also { socket.sent.clear() }
        fun sent(): List<String> = socket.sent.mapNotNull { host.open(it)?.payload?.toString() }.also { socket.sent.clear() }
    }

    private class FakeSocket(private val request: Request, private val listener: WebSocketListener) : WebSocket {
        val sent = mutableListOf<ByteArray>()
        var accept = true
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String) = accept
        override fun send(bytes: ByteString): Boolean {
            if (!accept) return false
            sent.add(bytes.toByteArray()); return true
        }
        override fun close(code: Int, reason: String?) = false
        override fun cancel() = Unit
        fun opened() = listener.onOpen(this, Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(101).message("Upgrade").build())
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, value.toByteString())
        fun failed() = listener.onFailure(this, IOException(), null)
    }

    private companion object {
        val listCommand = Regex(
            """^\{"type":"file-list","requestId":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})","target":\{"sessionId":"s"\}\}$""")
        val readCommand = Regex(
            """^\{"type":"file-read","requestId":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})","target":\{"sessionId":"s"\},"fileId":"f1","offset":4\}$""")
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
    }
}
