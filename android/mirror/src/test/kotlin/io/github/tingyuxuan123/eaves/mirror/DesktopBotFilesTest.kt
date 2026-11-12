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

/** 群消息产物的文本读取：权威 file-list 的 id、单块 file-read、与会话文件互不串台。 */
@OptIn(ExperimentalCoroutinesApi::class)
class DesktopBotFilesTest {
    @Test fun `a bot file list carries the nested target and projects the exact entries`() = runTest {
        fixture { f ->
            f.ready(withSession = false)
            f.link.listBotFiles(f.entry)
            f.link.listBotFiles(f.entry) // 同一条消息的重复点击不是第二次请求
            runCurrent()
            val command = f.commands().single()
            assertEquals(
                """{"type":"file-list","requestId":"${command["requestId"].linkString()}","target":{"bot":{"chatId":"c1","entryId":"e1"}}}""",
                command.toString())
            assertNotNull(f.bots!!.files)
            assertTrue(f.bots!!.files!!.listing)
            assertEquals(f.entry, f.bots!!.filesTarget)
            assertNull(f.session)
            f.listResult(command["requestId"].linkString()!!, """
                [{"id":"f1","name":"report.md","size":4096,"rel":"out/report.md"},
                 {"id":"f2","name":"","size":1,"rel":"x"}]
            """.trimIndent())
            assertEquals(listOf(DesktopFileEntry("f1", "report.md", 4096, "out/report.md")),
                f.bots!!.files!!.entries)
            assertFalse(f.bots!!.files!!.listing)
            assertNull(f.bots!!.files!!.listError)
            assertTrue(f.commands().isEmpty())
        }
        // 私聊某条消息的目标也一样是嵌套对象，绝不接受裸路径。
        fixture { f ->
            f.ready(withSession = false)
            f.link.listBotFiles(f.direct)
            runCurrent()
            val command = f.commands().single()
            assertEquals(
                """{"type":"file-list","requestId":"${command["requestId"].linkString()}","target":{"bot":{"chatId":"c2","conversationId":"cv2","messageIndex":3}}}""",
                command.toString())
            assertEquals(f.direct, f.bots!!.filesTarget)
        }
    }

    @Test fun `a bot file read sends the listed opaque id and decodes one bounded chunk`() = runTest {
        fixture { f ->
            f.ready(withSession = false)
            f.link.readBotFile(f.entry, "f1", 0)
            runCurrent()
            // 没有同一 target 的权威列表就没有 id 映射，绝不发读请求。
            assertTrue(f.commands().isEmpty())
            f.list(f.entry, """[{"id":"f1","name":"report.md","size":8,"rel":"out/report.md"}]""")
            f.link.readBotFile(f.entry, "f1", 4)
            runCurrent()
            val command = f.commands().single()
            assertEquals(
                """{"type":"file-read","requestId":"${command["requestId"].linkString()}","target":{"bot":{"chatId":"c1","entryId":"e1"}},"fileId":"f1","offset":4}""",
                command.toString())
            assertTrue(f.bots!!.files!!.reading)
            assertEquals("f1", f.bots!!.files!!.readingFileId)
            val bytes = byteArrayOf(0, 1, 2, -1, -2, 127, -128, 10)
            // 主机可以省略 name；列表是后备名字来源。
            f.readResult(command["requestId"].linkString()!!) {
                put("size", 8); put("offset", 4)
                put("data", Base64.getEncoder().encodeToString(bytes))
            }
            val chunk = f.bots!!.files!!.chunk!!
            assertEquals("f1", chunk.fileId)
            assertEquals("report.md", chunk.name)
            assertEquals(8L, chunk.size)
            assertEquals(4L, chunk.offset)
            assertArrayEquals(bytes, chunk.data)
            assertFalse(f.bots!!.files!!.reading)
            assertEquals(4L, f.bots!!.files!!.readOffset)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a new artifact target starts an empty projection and drops the old block`() = runTest {
        fixture { f ->
            f.ready(withSession = false)
            f.list(f.entry, """[{"id":"f1","name":"report.md","size":8,"rel":"out/report.md"}]""")
            f.readResult(f.readAndRequest(f.entry, "f1", 0)) {
                put("size", 8); put("offset", 0); put("data", "AQIDBA==")
            }
            assertEquals(4, f.bots!!.files!!.chunk!!.data.size)
            // 另一条消息的列表从一开始就是空投影，旧 entries/chunk 不会被带过去。
            f.link.listBotFiles(f.direct)
            runCurrent()
            assertEquals(f.direct, f.bots!!.filesTarget)
            assertTrue(f.bots!!.files!!.listing)
            assertTrue(f.bots!!.files!!.entries.isEmpty())
            assertNull(f.bots!!.files!!.chunk)
            // 旧 target 的读请求已作废：它的迟到答复不会写进新投影。
            f.readResult("00000000-0000-0000-0000-000000000000") {
                put("size", 8); put("offset", 0); put("data", "AQIDBA==")
            }
            assertNull(f.bots!!.files!!.chunk)
            assertNull(f.bots!!.files!!.readError)
            // 换成新 target 后，旧 target 的读不再被接受。
            f.link.readBotFile(f.entry, "f1", 0)
            runCurrent()
            assertTrue(f.commands().none { it["type"].linkString() == "file-read" })
        }
        // 在途的读被另一条消息的列表打断时，旧答复同样作废。
        fixture { f ->
            f.ready(withSession = false)
            f.list(f.entry, """[{"id":"f1","name":"report.md","size":8,"rel":"out/report.md"}]""")
            val stale = f.readAndRequest(f.entry, "f1", 0)
            f.link.listBotFiles(f.direct)
            runCurrent()
            f.readResult(stale) { put("size", 8); put("offset", 0); put("data", "AQIDBA==") }
            assertNull(f.bots!!.files!!.chunk)
            assertEquals(f.direct, f.bots!!.filesTarget)
        }
    }

    @Test fun `a silent bot file answer is reported once and a late matching answer still settles`() = runTest {
        fixture { f ->
            f.ready(withSession = false)
            f.link.listBotFiles(f.entry)
            runCurrent()
            val requestId = f.commands().single()["requestId"].linkString()!!
            advanceTimeBy(14_000); runCurrent()
            assertTrue(f.bots!!.files!!.listing)
            assertNull(f.bots!!.files!!.listError)
            advanceTimeBy(1_100); runCurrent()
            assertFalse(f.bots!!.files!!.listing)
            assertEquals("请求超时", f.bots!!.files!!.listError)
            assertTrue(f.commands().isEmpty())
            f.listResult(requestId, """[{"id":"f1","name":"a.md","size":1,"rel":"a.md"}]""")
            assertNull(f.bots!!.files!!.listError)
            assertEquals(listOf("f1"), f.bots!!.files!!.entries.map { it.id })
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready(withSession = false)
            f.list(f.entry, """[{"id":"f1","name":"a.md","size":8,"rel":"a.md"}]""")
            val requestId = f.readAndRequest(f.entry, "f1", 2)
            advanceTimeBy(15_100); runCurrent()
            assertFalse(f.bots!!.files!!.reading)
            assertEquals("请求超时", f.bots!!.files!!.readError)
            assertNull(f.bots!!.files!!.chunk)
            f.readResult(requestId) {
                put("name", "a.md"); put("size", 6); put("offset", 2); put("data", "AQIDBA==")
            }
            assertNull(f.bots!!.files!!.readError)
            assertEquals(4, f.bots!!.files!!.chunk!!.data.size)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `session and bot file operations never share a projection or a reply`() = runTest {
        // 两边的在途请求互斥：桌面一个连接只有一次 fileOperation。
        fixture { f ->
            f.ready()
            val sessionRequest = f.sessionListAndRequest()
            f.link.listBotFiles(f.entry)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.listResult(sessionRequest, """[{"id":"s1","name":"s.txt","size":1,"rel":"s.txt"}]""")
            assertEquals(listOf("s1"), f.session!!.files!!.entries.map { it.id })
            assertNull(f.bots)
            // 会话的答复只写会话投影；bot 投影不会被它创建。
            val botRequest = f.botListAndRequest(f.entry)
            f.link.listFiles("s")
            runCurrent()
            assertTrue(f.commands().none { it["type"].linkString() == "file-list" })
            f.listResult(botRequest, """[{"id":"b1","name":"b.md","size":1,"rel":"b.md"}]""")
            assertEquals(listOf("b1"), f.bots!!.files!!.entries.map { it.id })
            assertEquals(listOf("s1"), f.session!!.files!!.entries.map { it.id })
            assertFalse(f.session!!.files!!.listing)
            // 会话的读答复不会落进 bot 投影，反之亦然。
            val botRead = f.readAndRequest(f.entry, "b1", 0)
            f.link.readFile("s", "s1", 0)
            runCurrent()
            assertTrue(f.commands().none { it["type"].linkString() == "file-read" })
            f.readResult(botRead) { put("size", 1); put("offset", 0); put("data", "AQ==") }
            assertEquals("b1", f.bots!!.files!!.chunk!!.fileId)
            assertNull(f.session!!.files!!.chunk)
            val sessionRead = f.sessionReadAndRequest("s1", 0)
            f.readResult(sessionRead) { put("name", "s.txt"); put("size", 1); put("offset", 0); put("data", "Ag==") }
            assertEquals("s1", f.session!!.files!!.chunk!!.fileId)
            assertEquals("b1", f.bots!!.files!!.chunk!!.fileId)
        }
        // 会话切走只清会话投影，bot 投影不受影响。
        fixture { f ->
            f.ready(withSession = false)
            f.list(f.entry, """[{"id":"b1","name":"b.md","size":1,"rel":"b.md"}]""")
            f.link.selectSession("s"); runCurrent()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            assertEquals(listOf("b1"), f.bots!!.files!!.entries.map { it.id })
            assertNull(f.session!!.files)
        }
    }

    @Test fun `switching chat or connection clears the bot file projection`() = runTest {
        fixture { f ->
            f.ready(withSession = false)
            f.link.openBotChat("c1"); runCurrent()
            f.commands()
            f.list(f.entry, """[{"id":"b1","name":"b.md","size":1,"rel":"b.md"}]""")
            assertNotNull(f.bots!!.files)
            f.link.closeBotChat("c1"); runCurrent()
            assertNull(f.bots!!.files)
            assertNull(f.bots!!.filesTarget)
            // 关闭后的迟到答复不会复活投影。
            f.listResult("11111111-1111-4111-8111-111111111111",
                """[{"id":"late","name":"l","size":1,"rel":"l"}]""")
            assertNull(f.bots!!.files)
        }
        // 打开另一个聊天同样清空。
        fixture { f ->
            f.ready(withSession = false)
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.list(f.entry, """[{"id":"b1","name":"b.md","size":1,"rel":"b.md"}]""")
            f.link.openBotChat("c2"); runCurrent()
            f.commands()
            assertNull(f.bots!!.files)
            assertNull(f.bots!!.filesTarget)
        }
        // 换代（重连）后既没有投影也没有在途请求。
        fixture { f ->
            f.ready(withSession = false)
            f.link.listBotFiles(f.entry); runCurrent()
            val requestId = f.commands().single()["requestId"].linkString()!!
            f.socket.failed(); runCurrent()
            advanceTimeBy(1_000); runCurrent()
            f.begin(); f.prove()
            assertNull(f.bots)
            f.listResult(requestId, """[{"id":"late","name":"l","size":1,"rel":"l"}]""")
            assertNull(f.bots)
        }
    }

    @Test fun `a readonly host still lists and reads bot files while a hidden link refuses`() = runTest {
        fixture { f ->
            f.ready(readOnly = true, withSession = false)
            assertTrue(f.state.readOnly)
            f.list(f.entry, """[{"id":"b1","name":"b.md","size":4,"rel":"b.md"}]""")
            f.readResult(f.readAndRequest(f.entry, "b1", 0)) {
                put("name", "b.md"); put("size", 4); put("offset", 0); put("data", "AQIDBA==")
            }
            assertEquals(4, f.bots!!.files!!.chunk!!.data.size)
        }
        fixture { f ->
            f.ready(withSession = false)
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            f.commands()
            f.link.listBotFiles(f.entry)
            f.link.readBotFile(f.entry, "b1", 0)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots)
        }
    }

    @Test fun `unusable targets ids and offsets never reach the wire`() = runTest {
        fixture { f ->
            f.ready(withSession = false)
            f.link.listBotFiles(DesktopBotArtifactTarget("c1"))
            f.link.listBotFiles(DesktopBotArtifactTarget("c1", entryId = "e1", conversationId = "cv", messageIndex = 1))
            f.link.listBotFiles(DesktopBotArtifactTarget(""))
            f.link.listBotFiles(DesktopBotArtifactTarget("c1", entryId = "e".repeat(513)))
            f.link.readBotFile(DesktopBotArtifactTarget("c1", entryId = "e1"), "", 0)
            f.link.readBotFile(DesktopBotArtifactTarget("c1", entryId = "e1"), "   ", 0)
            f.link.readBotFile(DesktopBotArtifactTarget("c1", entryId = "e1"), "f".repeat(513), 0)
            f.link.readBotFile(DesktopBotArtifactTarget("c1", entryId = "e1"), "f1", -1)
            f.link.readBotFile(DesktopBotArtifactTarget("c1", entryId = "e1"), "f1", 9_007_199_254_740_992L)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots)
        }
    }

    @Test fun `host errors and unusable tables keep the previous bot entries`() = runTest {
        fixture { f ->
            f.ready(withSession = false)
            f.list(f.entry, """[{"id":"old","name":"o.md","size":1,"rel":"o.md"}]""")
            f.listResult(f.botListAndRequest(f.entry)) { put("error", "changed") }
            assertEquals(listOf("old"), f.bots!!.files!!.entries.map { it.id })
            assertEquals("changed", f.bots!!.files!!.listError)
            f.listResult(f.botListAndRequest(f.entry)) { put("files", "nope") }
            assertEquals(listOf("old"), f.bots!!.files!!.entries.map { it.id })
            assertEquals("无效的响应", f.bots!!.files!!.listError)
            // 一个坏块只是错误，绝不写半份数据。
            f.readResult(f.readAndRequest(f.entry, "old", 0)) {
                put("size", 4); put("offset", 1); put("data", "AQIDBA==")
            }
            assertNull(f.bots!!.files!!.chunk)
            assertEquals("无效的响应", f.bots!!.files!!.readError)
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
        val entry = DesktopBotArtifactTarget("c1", entryId = "e1")
        val direct = DesktopBotArtifactTarget("c2", conversationId = "cv2", messageIndex = 3)
        val link = DesktopLink(PairCredentials("pair-1", "token", key, "Eaves", "https://example.test"),
            {}, false, StandardTestDispatcher(scope.testScheduler), { scope.testScheduler.currentTime }, { 0.5 },
            { request, listener -> FakeSocket(request, listener).also(sockets::add) })
        val state get() = link.state.value
        val session get() = state.session
        val bots get() = state.bots
        fun begin() {
            link.setVisible(true)
            scope.runCurrent()
            socket.opened(); socket.text("pong"); socket.text("""{"type":"host-online"}""")
            scope.runCurrent(); host.peerReset()
        }
        fun prove() {
            socket.sent.forEach { host.open(it) }; socket.sent.clear()
            frame(json("""{"type":"replay-hello"}"""))
            assertEquals(LinkPhase.Online, state.phase)
        }
        fun ready(readOnly: Boolean = false, withSession: Boolean = true) {
            if (withSession) link.selectSession("s")
            begin(); prove()
            if (withSession) sync(commands().single { it["type"].linkString() == "subscribe" })
            frame(json("""{"type":"host-info","hostname":"Host","readOnly":$readOnly}"""))
            commands()
        }
        fun list(target: DesktopBotArtifactTarget, files: String) =
            listResult(botListAndRequest(target), files)
        fun botListAndRequest(target: DesktopBotArtifactTarget): String {
            link.listBotFiles(target); scope.runCurrent()
            return commands().single { it["type"].linkString() == "file-list" }["requestId"].linkString()!!
        }
        fun readAndRequest(target: DesktopBotArtifactTarget, fileId: String, offset: Long): String {
            link.readBotFile(target, fileId, offset); scope.runCurrent()
            return commands().single { it["type"].linkString() == "file-read" }["requestId"].linkString()!!
        }
        fun sessionListAndRequest(): String {
            link.listFiles("s"); scope.runCurrent()
            return commands().single { it["type"].linkString() == "file-list" }["requestId"].linkString()!!
        }
        fun sessionReadAndRequest(fileId: String, offset: Long): String {
            link.readFile("s", fileId, offset); scope.runCurrent()
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
        fun opened() = listener.onOpen(this, Response.Builder().request(request)
            .protocol(Protocol.HTTP_1_1).code(101).message("Upgrade").build())
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, value.toByteString())
        fun failed() = listener.onFailure(this, IOException(), null)
    }

    private companion object {
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
    }
}
