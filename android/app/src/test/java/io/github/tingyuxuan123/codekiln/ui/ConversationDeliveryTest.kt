package io.github.tingyuxuan123.codekiln.ui

import io.github.tingyuxuan123.codekiln.mirror.DesktopFileChunk
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.DesktopPreviewEntry
import io.github.tingyuxuan123.codekiln.mirror.SessionImageTarget
import io.github.tingyuxuan123.codekiln.pair.SessionMessage
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.*
import org.junit.Test

class ConversationDeliveryTest {
    @Test fun `APK is a download and never an external open action`() {
        assertEquals(ArtifactAction.Save, artifactActionOnTap("app-debug.APK"))
        assertNull(artifactExternalMime("app-debug.APK"))
        assertEquals("application/vnd.android.package-archive", artifactSaveMime("app-debug.APK"))
        assertEquals(ArtifactAction.Open, artifactActionOnTap("report.pdf"))
        assertNull(artifactActionOnTap("notes.md"))
        assertNull(artifactActionOnTap("sample.apk.txt"))
    }

    @Test fun `ordinary links open outside and desktop links only match authorised candidates`() {
        assertEquals(SessionLink.Browser("https://example.org/a?q=1#b"), sessionLink("https://example.org/a?q=1#b"))
        val local = sessionLink("http://localhost:5173/demo") as SessionLink.Preview
        val candidates = listOf(DesktopPreviewEntry("unrelated", "http://127.0.0.1:5173/", "server"),
            DesktopPreviewEntry("demo", "http://127.0.0.1:5173/demo", "server"))
        assertEquals("demo", local.match(candidates)?.id)
        assertNull(local.match(candidates.take(1)))
        assertEquals(SessionLink.Preview("docs/报告.html", "html"), sessionLink("./docs/%E6%8A%A5%E5%91%8A.html"))
        assertNull((sessionLink("file:///tmp/a.html") as SessionLink.Preview).match(candidates))
        listOf("file://server/share/a.html", "intent://host", "javascript:alert(1)", "//host/x.html", "../x.html",
            "http://localhost:5173/has?query=1", "http://127.1:5173/", "https://localhost:8443/").forEach {
            assertNull(it, sessionLink(it))
        }
    }

    @Test fun `a successful image tool result creates a history preview without exposing an absolute path`() {
        val id = "1a2b3c4d-1111-4111-8111-1a2b3c4d5e6f"
        fun call(name: String, path: String) = SessionMessage(0, "assistant", listOf(JsonObject(mapOf(
            "type" to JsonPrimitive("toolCall"), "id" to JsonPrimitive("call-1"), "name" to JsonPrimitive(name),
            "arguments" to JsonObject(mapOf("path" to JsonPrimitive(path))),
        ))))
        fun result(name: String, text: String, error: Boolean = false) = SessionMessage(1, "toolResult",
            listOf(JsonObject(mapOf("type" to JsonPrimitive("text"), "text" to JsonPrimitive(text)))),
            toolCallId = "call-1", toolName = name, isError = error)
        fun images(vararg messages: SessionMessage) = sessionTurns(messages.toList()).flatMap { it.blocks }
            .filterIsInstance<SessionBlock.RemoteImage>().map { it.target }
        assertEquals(listOf(SessionImageTarget.Read("call-1")), images(call("read", "/tmp/a.PNG"), result("read", "ok")))
        assertTrue(images(call("read", "/tmp/a.PNG"), result("read", "failed", error = true)).isEmpty())
        assertTrue(images(call("read", "/tmp/a.PNG")).isEmpty())
        val json = """{"ok":true,"image":{"id":"$id","path":".xiaoman/images/$id.png","mimeType":"image/png"}}"""
        assertEquals(listOf(SessionImageTarget.Generated(".xiaoman/images/$id.png")), images(result("generate_image", json)))
        assertTrue(images(result("generate_image", json.replace(".xiaoman/images/", "../"))).isEmpty())
    }

    @Test fun `reply matches only files from the host list and disambiguates duplicate basenames`() {
        val one = DesktopFileEntry("1", "报告.pdf", 1, "out/报告.pdf")
        val two = DesktopFileEntry("2", "报告.pdf", 2, "other/报告.pdf")
        val turn = SessionTurn(1, false, null, listOf(SessionBlock.Prose("完成：[报告](out/%E6%8A%A5%E5%91%8A.pdf)")))
        assertEquals(listOf(one), replyArtifacts(turn, listOf(one, two)))
        assertEquals(one, (sessionLink("file:///Users/work/out/%E6%8A%A5%E5%91%8A.pdf") as SessionLink.File).match(listOf(one, two)))
        assertEquals(emptyList<DesktopFileEntry>(), replyArtifacts(turn.copy(blocks = listOf(SessionBlock.Prose("见 `报告.pdf`"))),
            listOf(one, two)))
        assertEquals(listOf(one), replyArtifacts(turn.copy(blocks = listOf(SessionBlock.Prose("见 `报告.pdf`"))), listOf(one)))
    }

    @Test fun `download writes the entire ordered file and refuses stale or short blocks`() = runTest {
        val entry = DesktopFileEntry("f", "report.pdf", 5, "out/report.pdf")
        val file = ByteArrayOutputStream()
        val blocks = mutableListOf<Long>()
        val progress = mutableListOf<Long>()
        assertTrue(copyArtifact(entry, file, { offset ->
            blocks += offset
            DesktopFileChunk("f", null, 5, offset, if (offset == 0L) byteArrayOf(1, 2) else byteArrayOf(3, 4, 5))
        }, progress::add))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), file.toByteArray())
        assertEquals(listOf(0L, 2L), blocks)
        assertEquals(listOf(2L, 5L), progress)
        for (bad in listOf(DesktopFileChunk("wrong", null, 5, 0, byteArrayOf(1)),
            DesktopFileChunk("f", null, 5, 1, byteArrayOf(1)), DesktopFileChunk("f", null, 6, 0, byteArrayOf(1)),
            DesktopFileChunk("f", null, 5, 0, byteArrayOf()), DesktopFileChunk("f", null, 5, 0, ByteArray(6)))) {
            val untouched = ByteArrayOutputStream()
            assertFalse(copyArtifact(entry, untouched, { bad }))
            assertEquals(0, untouched.size())
        }
        assertFalse(copyArtifact(entry.copy(size = 51L * 1024 * 1024), file, { error("must not request") }))
    }
}
