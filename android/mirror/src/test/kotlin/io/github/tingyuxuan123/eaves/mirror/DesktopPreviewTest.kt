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
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
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
class DesktopPreviewTest {
    @Test fun `list sends the exact command and accepts the matching entries`() = runTest {
        fixture { f ->
            f.ready()
            assertNull(f.session!!.preview)
            f.listPreviews()
            runCurrent()
            val raw = f.sent().single()
            val requestId = listCommand.matchEntire(raw)?.groupValues?.get(1)
            assertNotNull("sent: $raw", requestId)
            val listing = f.session!!.preview!!
            assertTrue(listing.listing)
            assertTrue(listing.busy)
            assertNull(listing.listError)
            assertTrue(listing.entries.isEmpty())
            f.listResult(requestId!!, """[{"id":"e1","label":"index.html","kind":"html"},""" +
                """{"id":"e2","label":"dev server","kind":"server"}]""")
            val preview = f.session!!.preview!!
            assertEquals(listOf(DesktopPreviewEntry("e1", "index.html", "html"),
                DesktopPreviewEntry("e2", "dev server", "server")), preview.entries)
            assertFalse(preview.listing)
            assertFalse(preview.busy)
            assertNull(preview.listError)
            assertNull(preview.error)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `open sends the exact command and lands the preview and frame`() = runTest {
        fixture { f ->
            f.ready()
            f.open("e1", 800, 600)
            runCurrent()
            val raw = f.sent().single()
            val requestId = openCommand.matchEntire(raw)?.groupValues?.get(1)
            assertNotNull("sent: $raw", requestId)
            assertTrue(f.session!!.preview!!.busy)
            f.frameResult(requestId!!, previewId = "p1", width = 800, height = 600)
            val preview = f.session!!.preview!!
            assertEquals("p1", preview.previewId)
            assertEquals(DesktopPreviewFrame("fr1", 800, 600, IMAGE, "Title"), preview.frame)
            assertFalse(preview.busy)
            assertNull(preview.error)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a repeat operation never sends a second request while one is in flight`() = runTest {
        fixture { f ->
            f.ready()
            f.listPreviews()
            f.listPreviews()
            f.open()
            f.previewAction(DesktopPreviewAction.Frame)
            f.input(DesktopPreviewInput.Key("Enter"))
            runCurrent()
            val sent = f.commands()
            assertEquals(1, sent.size)
            f.listResult(sent.single()["requestId"].linkString()!!, "[]")
            assertFalse(f.session!!.preview!!.busy)
            // The listing answer leaves an empty, usable preview: one open is now allowed.
            f.open()
            f.open()
            f.listPreviews()
            f.input(DesktopPreviewInput.Text("x"))
            runCurrent()
            assertEquals(listOf("preview-open"), f.sentTypes())
        }
    }

    @Test fun `frame refresh and close need an established preview`() = runTest {
        fixture { f ->
            f.ready()
            for (action in DesktopPreviewAction.entries) f.previewAction(action)
            f.input(DesktopPreviewInput.Key("Enter"))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.preview)
            f.openedPreview()
            f.frameResult(f.actionAndRequest(DesktopPreviewAction.Frame))
            assertEquals("fr1", f.session!!.preview!!.frame!!.frameId)
            f.frameResult(f.actionAndRequest(DesktopPreviewAction.Refresh))
            assertEquals("fr1", f.session!!.preview!!.frame!!.frameId)
            f.result(f.actionAndRequest(DesktopPreviewAction.Close)) { put("previewId", "p1") }
            val preview = f.session!!.preview!!
            assertNull(preview.previewId)
            assertNull(preview.frame)
            assertFalse(preview.busy)
            // Nothing is left to act on, so the next action never reaches the wire.
            f.previewAction(DesktopPreviewAction.Close)
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `input uses the current preview and frame`() = runTest {
        fixture { f ->
            f.ready()
            f.openedPreview()
            f.input(DesktopPreviewInput.Text("hi"))
            runCurrent()
            f.frameResult(f.requestIdOf(TEXT_INPUT))
            f.input(DesktopPreviewInput.Key("Enter"))
            runCurrent()
            f.frameResult(f.requestIdOf(KEY_INPUT))
            f.input(DesktopPreviewInput.Click(10, 20))
            runCurrent()
            f.frameResult(f.requestIdOf(CLICK_INPUT))
            f.input(DesktopPreviewInput.Scroll(0, -120))
            runCurrent()
            f.frameResult(f.requestIdOf(SCROLL_INPUT))
            // The far edge of the frame is inside its bounds; one pixel past it is not.
            f.input(DesktopPreviewInput.Click(800, 600))
            runCurrent()
            f.frameResult(f.requestIdOf(EDGE_INPUT))
            for (input in listOf(DesktopPreviewInput.Click(-1, 0), DesktopPreviewInput.Click(801, 0),
                    DesktopPreviewInput.Click(0, 601), DesktopPreviewInput.Key("F1"),
                    DesktopPreviewInput.Key("enter"), DesktopPreviewInput.Text(""),
                    DesktopPreviewInput.Text("x".repeat(PREVIEW_INPUT_TEXT_LIMIT + 1)))) {
                f.input(input)
                runCurrent()
                assertTrue("input: $input", f.commands().isEmpty())
                assertFalse(f.session!!.preview!!.busy)
                assertNull(f.session!!.preview!!.error)
            }
            // The bound itself is inclusive.
            f.input(DesktopPreviewInput.Text("x".repeat(PREVIEW_INPUT_TEXT_LIMIT)))
            runCurrent()
            assertEquals("preview-input", f.sentTypes().single())
        }
    }

    @Test fun `timeout reports an error and a late matching result is still accepted`() = runTest {
        fixture { f ->
            f.ready()
            val requestId = f.listAndRequest()
            advanceTimeBy(19_000); runCurrent()
            assertTrue(f.session!!.preview!!.listing)
            assertTrue(f.session!!.preview!!.busy)
            advanceTimeBy(1_100); runCurrent()
            assertFalse(f.session!!.preview!!.listing)
            assertFalse(f.session!!.preview!!.busy)
            assertEquals("请求超时", f.session!!.preview!!.listError)
            assertTrue(f.commands().isEmpty())
            f.listResult(requestId, """[{"id":"e1","label":"a","kind":"html"}]""")
            assertFalse(f.session!!.preview!!.listing)
            assertNull(f.session!!.preview!!.listError)
            assertEquals(listOf("e1"), f.session!!.preview!!.entries.map { it.id })
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            val requestId = f.openAndRequest()
            advanceTimeBy(19_000); runCurrent()
            assertTrue(f.session!!.preview!!.busy)
            advanceTimeBy(1_100); runCurrent()
            assertFalse(f.session!!.preview!!.busy)
            assertEquals("请求超时", f.session!!.preview!!.error)
            assertNull(f.session!!.preview!!.frame)
            assertTrue(f.commands().isEmpty())
            f.frameResult(requestId)
            assertEquals("p1", f.session!!.preview!!.previewId)
            assertNull(f.session!!.preview!!.error)
            assertEquals("fr1", f.session!!.preview!!.frame!!.frameId)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `results for another request session or generation are ignored`() = runTest {
        fixture { f ->
            f.ready()
            val requestId = f.listAndRequest()
            f.listResult("00000000-0000-0000-0000-000000000000", """[{"id":"bad","label":"a","kind":"html"}]""")
            assertTrue(f.session!!.preview!!.listing)
            assertTrue(f.session!!.preview!!.entries.isEmpty())
            f.result("00000000-0000-0000-0000-000000000000") { put("previewId", "p1") }
            assertNull(f.session!!.preview!!.previewId)
            f.listResult(requestId, """[{"id":"e1","label":"a","kind":"html"}]""")
            assertEquals(listOf("e1"), f.session!!.preview!!.entries.map { it.id })
        }
        // Switching the selected session drops the projection and the in-flight request.
        fixture { f ->
            f.ready()
            val requestId = f.openAndRequest()
            f.link.selectSession("other"); runCurrent()
            assertEquals("other", f.session!!.timeline.sessionId)
            assertNull(f.session!!.preview)
            f.frameResult(requestId)
            assertNull(f.session!!.preview)
            assertTrue(f.commands().all { it["type"].linkString() == "subscribe" })
            f.link.listPreviews("other"); runCurrent()
            assertNotEquals(requestId, f.commands()
                .single { it["type"].linkString() == "preview-list" }["requestId"].linkString())
            assertEquals(DesktopPreviewState(listing = true, busy = true), f.session!!.preview)
        }
        // A reconnect is a new generation: the old answer never lands and the preview stays empty.
        fixture { f ->
            f.ready()
            f.openedPreview()
            val requestId = f.actionAndRequest(DesktopPreviewAction.Frame)
            f.socket.failed(); runCurrent()
            advanceTimeBy(1_000); runCurrent()
            f.begin(existing = true); f.prove()
            f.sync(f.commands().single { it["type"].linkString() == "subscribe" })
            assertNull(f.session!!.preview)
            f.frameResult(requestId)
            assertNull(f.session!!.preview)
        }
    }

    @Test fun `unusable tables and host errors keep the previous entries and frame`() = runTest {
        fixture { f ->
            f.ready()
            f.listResult(f.listAndRequest(), """[{"id":"old","label":"o","kind":"html"}]""")
            // No `entries` key at all is not an empty list.
            f.listResult(f.listAndRequest()) { put("error", "unavailable") }
            assertEquals(listOf("old"), f.session!!.preview!!.entries.map { it.id })
            assertEquals("unavailable", f.session!!.preview!!.listError)
            f.listResult(f.listAndRequest()) { put("entries", "nope") }
            assertEquals(listOf("old"), f.session!!.preview!!.entries.map { it.id })
            assertNotNull(f.session!!.preview!!.listError)
            val rows = (0..PREVIEW_ENTRY_LIMIT).joinToString(",") {
                """{"id":"e$it","label":"l","kind":"html"}"""
            }
            f.listResult(f.listAndRequest(), "[$rows]")
            assertEquals(listOf("old"), f.session!!.preview!!.entries.map { it.id })
            assertNotNull(f.session!!.preview!!.listError)
            assertFalse(f.session!!.preview!!.busy)
            // A host error keeps the last good frame instead of blanking the screen.
            f.openedPreview()
            val good = f.session!!.preview!!.frame!!
            f.result(f.openAndRequest()) { put("error", "busy") }
            assertSame(good, f.session!!.preview!!.frame)
            assertEquals("p1", f.session!!.preview!!.previewId)
            assertEquals("busy", f.session!!.preview!!.error)
            assertFalse(f.session!!.preview!!.busy)
        }
    }

    @Test fun `invalid frames never replace the previous one`() = runTest {
        fixture { f ->
            f.ready()
            f.openedPreview()
            val good = f.session!!.preview!!.frame!!
            val payloads = listOf<JsonObjectBuilder.() -> Unit>(
                // Malformed or missing identity.
                { put("frameId", ""); put("width", 800); put("height", 600); put("dataUrl", IMAGE) },
                { put("width", 800); put("height", 600); put("dataUrl", IMAGE) },
                { put("frameId", "f".repeat(PREVIEW_TEXT_LIMIT + 1)); put("width", 800); put("height", 600)
                    put("dataUrl", IMAGE) },
                // A frame without a frame at all is not an answer.
                { put("title", "nothing") },
                // Sizes the phone can never display.
                { put("frameId", "f2"); put("width", 0); put("height", 600); put("dataUrl", IMAGE) },
                { put("frameId", "f2"); put("width", 800); put("height", 8_193); put("dataUrl", IMAGE) },
                { put("frameId", "f2"); put("width", 800.5); put("height", 600); put("dataUrl", IMAGE) },
                { put("frameId", "f2"); put("width", "800"); put("height", 600); put("dataUrl", IMAGE) },
                // Only a bounded standard Base64 PNG or JPEG is a displayable frame.
                { put("frameId", "f2"); put("width", 800); put("height", 600)
                    put("dataUrl", "data:image/gif;base64,AAAAAA==") },
                { put("frameId", "f2"); put("width", 800); put("height", 600)
                    put("dataUrl", "data:image/png;base64,@@@@") },
                { put("frameId", "f2"); put("width", 800); put("height", 600); put("dataUrl", 7) },
                { put("frameId", "f2"); put("width", 800); put("height", 600); put("dataUrl", "") },
            )
            for (payload in payloads) {
                f.result(f.openAndRequest()) {
                    put("previewId", "p2")
                    putJsonObject("frame") { payload() }
                }
                assertFalse(f.session!!.preview!!.busy)
                assertEquals("无效的响应", f.session!!.preview!!.error)
                assertSame(good, f.session!!.preview!!.frame)
                assertEquals("p1", f.session!!.preview!!.previewId)
            }
            // The largest frame and a JPEG both land, so the bounds are inclusive.
            f.result(f.openAndRequest()) {
                put("previewId", "p2")
                putJsonObject("frame") {
                    put("frameId", "f2"); put("width", 8_192); put("height", 8_192)
                    put("dataUrl", "data:image/jpeg;base64,AAAAAA==")
                }
            }
            assertNull(f.session!!.preview!!.error)
            assertEquals("f2", f.session!!.preview!!.frame!!.frameId)
            assertEquals("p2", f.session!!.preview!!.previewId)
            assertEquals(8_192, f.session!!.preview!!.frame!!.width)
            assertNull(f.session!!.preview!!.frame!!.title)
        }
    }

    @Test fun `only a bounded standard base64 png or jpeg is a displayable frame`() {
        // A relay frame is far smaller than the decoded cap, so the cap is a guard on its own.
        val full = "data:image/jpeg;base64," +
            Base64.getEncoder().encodeToString(ByteArray(PREVIEW_FRAME_BYTES))
        assertEquals(full, desktopPreviewDataUrl(JsonPrimitive(full)))
        assertNull(desktopPreviewDataUrl(JsonPrimitive("data:image/png;base64," +
            Base64.getEncoder().encodeToString(ByteArray(PREVIEW_FRAME_BYTES + 1)))))
        assertEquals(IMAGE, desktopPreviewDataUrl(JsonPrimitive(IMAGE)))
        assertNotNull(desktopPreviewDataUrl(JsonPrimitive("data:image/jpeg;base64,AAAAAA==")))
        for (bad in listOf("data:image/png;base64,@@@@@@", "data:image/webp;base64,AAAAAA==",
                "data:image/png,AAAAAA==", "AAAAAA==", "", "data:image/png;base64,AAA")) {
            assertNull("dataUrl: $bad", desktopPreviewDataUrl(JsonPrimitive(bad)))
        }
        assertNull(desktopPreviewDataUrl(JsonPrimitive(7)))
        assertNull(desktopPreviewDataUrl(null))
    }

    @Test fun `frame fields are bounded and a display-only title never fails a frame`() {
        fun frame(width: Int = 800, height: Int = 600, title: String? = null) = buildJsonObject {
            put("frameId", "f")
            put("width", width)
            put("height", height)
            put("dataUrl", IMAGE)
            title?.let { put("title", it) }
        }
        assertEquals(DesktopPreviewFrame("f", 8_192, 8_192, IMAGE), desktopPreviewFrame(frame(8_192, 8_192)))
        assertEquals("t", desktopPreviewFrame(frame(title = "t"))!!.title)
        for (bad in listOf(frame(0, 600), frame(800, 8_193), frame(-1, 600))) {
            assertNull(desktopPreviewFrame(bad))
        }
        assertNull(desktopPreviewFrame(frame(title = "t".repeat(PREVIEW_TEXT_LIMIT + 1)))!!.title)
        assertNull(desktopPreviewFrame(null))
    }

    @Test fun `bad rows are dropped one by one without failing the table`() = runTest {
        fixture { f ->
            f.ready()
            f.listResult(f.listAndRequest(), """
                [{"id":"good","label":"a","kind":"html"},
                 {"label":"no-id","kind":"html"},
                 {"id":"","label":"blank-id","kind":"html"},
                 {"id":"blank-label","label":"  ","kind":"html"},
                 {"id":"long-label","label":"${"l".repeat(PREVIEW_TEXT_LIMIT + 1)}","kind":"html"},
                 {"id":"bad-kind","label":"a","kind":"pdf"},
                 {"id":"no-kind","label":"a"},
                 {"id":"number-label","label":7,"kind":"html"},
                 "row",
                 {"id":"good","label":"duplicate","kind":"server"},
                 {"id":"max-label","label":"${"l".repeat(PREVIEW_TEXT_LIMIT)}","kind":"server"}]
            """.trimIndent())
            assertEquals(listOf("good", "max-label"), f.session!!.preview!!.entries.map { it.id })
            assertEquals(DesktopPreviewEntry("good", "a", "html"), f.session!!.preview!!.entries.first())
            assertEquals(PREVIEW_TEXT_LIMIT, f.session!!.preview!!.entries[1].label.length)
            assertNull(f.session!!.preview!!.listError)
            assertFalse(f.session!!.preview!!.listing)
            assertFalse(f.session!!.preview!!.busy)
        }
    }

    @Test fun `unusable ids sizes and inputs never reach the wire`() = runTest {
        fixture { f ->
            f.ready()
            f.link.listPreviews("other")
            f.link.listPreviews("")
            f.link.listPreviews("s".repeat(PREVIEW_TEXT_LIMIT + 1))
            f.link.openPreview("s", "", 800, 600)
            f.link.openPreview("s", "  ", 800, 600)
            f.link.openPreview("s", "e".repeat(PREVIEW_TEXT_LIMIT + 1), 800, 600)
            f.link.openPreview("s", "e1", 0, 600)
            f.link.openPreview("s", "e1", 800, 4_097)
            f.link.openPreview("other", "e1", 800, 600)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.session!!.preview)
        }
    }

    @Test fun `read-only host still allows previews`() = runTest {
        fixture { f ->
            f.ready(readOnly = true)
            assertTrue(f.state.readOnly)
            f.listResult(f.listAndRequest(), """[{"id":"e1","label":"a","kind":"html"}]""")
            assertEquals(listOf("e1"), f.session!!.preview!!.entries.map { it.id })
            f.frameResult(f.openAndRequest())
            assertEquals("fr1", f.session!!.preview!!.frame!!.frameId)
            f.frameResult(f.inputAndRequest(DesktopPreviewInput.Key("Tab")))
            assertEquals("fr1", f.session!!.preview!!.frame!!.frameId)
            assertNull(f.session!!.preview!!.error)
        }
    }

    @Test fun `a hidden background link refuses preview commands`() = runTest {
        fixture { f ->
            f.ready()
            f.openedPreview()
            val frame = f.session!!.preview!!.frame!!
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            runCurrent()
            f.commands()
            f.listPreviews()
            f.open()
            f.previewAction(DesktopPreviewAction.Frame)
            f.input(DesktopPreviewInput.Key("Enter"))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertFalse(f.session!!.preview!!.busy)
            assertSame(frame, f.session!!.preview!!.frame)
            // Dropping the retained transport drops the projection with it.
            f.link.setBackgroundAllowed(false)
            runCurrent()
            assertNull(f.session!!.preview)
        }
    }

    @Test fun `local send failure never pretends success`() = runTest {
        fixture { f ->
            f.ready()
            f.socket.accept = false
            f.listPreviews()
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.session!!.preview)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.openedPreview()
            f.socket.accept = false
            f.input(DesktopPreviewInput.Key("Enter"))
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.session!!.preview)
            assertTrue(f.commands().isEmpty())
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
            commands()
        }
        fun listPreviews() = link.listPreviews("s")
        fun open(entryId: String = "e1", width: Int = 800, height: Int = 600) =
            link.openPreview("s", entryId, width, height)
        fun previewAction(action: DesktopPreviewAction) = link.previewAction("s", action)
        fun input(gesture: DesktopPreviewInput) = link.previewInput("s", gesture)
        fun listAndRequest(): String {
            listPreviews(); scope.runCurrent()
            return commands().single { it["type"].linkString() == "preview-list" }["requestId"].linkString()!!
        }
        fun openAndRequest(entryId: String = "e1", width: Int = 800, height: Int = 600): String {
            open(entryId, width, height); scope.runCurrent()
            return commands().single { it["type"].linkString() == "preview-open" }["requestId"].linkString()!!
        }
        fun actionAndRequest(action: DesktopPreviewAction): String {
            previewAction(action); scope.runCurrent()
            val type = when (action) {
                DesktopPreviewAction.Frame -> "preview-frame"
                DesktopPreviewAction.Refresh -> "preview-refresh"
                DesktopPreviewAction.Close -> "preview-close"
            }
            return commands().single { it["type"].linkString() == type }["requestId"].linkString()!!
        }
        fun inputAndRequest(gesture: DesktopPreviewInput): String {
            input(gesture); scope.runCurrent()
            return commands().single { it["type"].linkString() == "preview-input" }["requestId"].linkString()!!
        }
        /** The single command just sent must match the exact wire shape of `regex`. */
        fun requestIdOf(regex: Regex): String {
            val raw = sent().single()
            val requestId = regex.matchEntire(raw)?.groupValues?.get(1)
            assertNotNull("sent: $raw", requestId)
            return requestId!!
        }
        fun openedPreview(entryId: String = "e1", width: Int = 800, height: Int = 600) {
            frameResult(openAndRequest(entryId, width, height), "p1", width, height)
        }
        fun listResult(requestId: String, entries: String, extra: JsonObjectBuilder.() -> Unit = {}) {
            frame(buildJsonObject {
                put("type", "preview-list-result")
                put("requestId", requestId)
                put("entries", Json.parseToJsonElement(entries))
                extra()
            })
        }
        fun listResult(requestId: String, fields: JsonObjectBuilder.() -> Unit = {}) {
            frame(buildJsonObject {
                put("type", "preview-list-result")
                put("requestId", requestId)
                fields()
            })
        }
        fun result(requestId: String, fields: JsonObjectBuilder.() -> Unit = {}) {
            frame(buildJsonObject {
                put("type", "preview-result")
                put("requestId", requestId)
                fields()
            })
        }
        fun frameResult(requestId: String, previewId: String? = "p1", width: Int = 800, height: Int = 600) {
            result(requestId) {
                previewId?.let { put("previewId", it) }
                putJsonObject("frame") {
                    put("frameId", "fr1")
                    put("width", width)
                    put("height", height)
                    put("dataUrl", IMAGE)
                    put("title", "Title")
                }
            }
        }
        fun sync(command: JsonObject, status: String = "idle", epoch: String = "e") {
            val requestId = (command["sync"] as JsonObject)["requestId"].linkString()
            frame(json("""{"type":"session-sync","sessionId":"s","requestId":"$requestId","cursor":{"epoch":"$epoch","seq":0},"mode":"snapshot","snapshot":{"type":"snapshot","sessions":[{"sessionId":"s","identity":{"sessionId":"s","generation":"g"},"baseIndex":0,"messages":[],"status":"$status"}]}}"""))
        }
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun commands(): List<JsonObject> = socket.sent.mapNotNull { host.open(it)?.payload }.also { socket.sent.clear() }
        fun sent(): List<String> = socket.sent.mapNotNull { host.open(it)?.payload?.toString() }.also { socket.sent.clear() }
        fun sentTypes(): List<String> = sent().map { json(it)["type"].linkString()!! }
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
        const val IMAGE = "data:image/png;base64,AAAAAA=="
        const val REQUEST = """([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"""
        const val INPUT = """"requestId":"$REQUEST","previewId":"p1","frameId":"fr1","""
        val listCommand = Regex(
            """^\{"type":"preview-list","requestId":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})","target":\{"sessionId":"s"\}\}$""")
        val openCommand = Regex(
            """^\{"type":"preview-open","requestId":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})","target":\{"sessionId":"s"\},"entryId":"e1","width":800,"height":600\}$""")
        val TEXT_INPUT = Regex(
            """^\{"type":"preview-input",$INPUT"input":\{"kind":"text","text":"hi"\}\}$""")
        val KEY_INPUT = Regex(
            """^\{"type":"preview-input",$INPUT"input":\{"kind":"key","key":"Enter"\}\}$""")
        val CLICK_INPUT = Regex(
            """^\{"type":"preview-input",$INPUT"input":\{"kind":"click","x":10,"y":20\}\}$""")
        val SCROLL_INPUT = Regex(
            """^\{"type":"preview-input",$INPUT"input":\{"kind":"scroll","deltaX":0,"deltaY":-120\}\}$""")
        val EDGE_INPUT = Regex(
            """^\{"type":"preview-input",$INPUT"input":\{"kind":"click","x":800,"y":600\}\}$""")
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
    }
}
