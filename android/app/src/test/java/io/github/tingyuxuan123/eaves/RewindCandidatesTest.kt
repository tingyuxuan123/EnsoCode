package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.ui.rewindCandidates
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RewindCandidatesTest {
    private fun message(index: Long, role: String, text: String?, image: Boolean = false): SessionMessage {
        val parts = buildList {
            if (text != null) add(buildJsonObject { put("type", "text"); put("text", text) })
            if (image) add(buildJsonObject { put("type", "image"); put("mimeType", "image/jpeg"); put("data", "AAAA") })
        }
        return SessionMessage(index, role, parts)
    }

    @Test fun `only user messages count from the end and the newest is index zero`() {
        val candidates = rewindCandidates(listOf(
            message(0, "user", "first"),
            message(1, "assistant", "reply"),
            message(2, "user", "second"),
            message(3, "assistant", "reply"),
            message(4, "user", "third"),
        ))
        assertEquals(listOf("third", "second", "first"), candidates.map { it.preview })
        assertEquals(listOf(0L, 1L, 2L), candidates.map { it.userIndexFromEnd })
        assertEquals(listOf(4L, 2L, 0L), candidates.map { it.index })
    }

    @Test fun `preview collapses whitespace truncates and never invents text for image only messages`() {
        val long = "  a\n\n b   " + "字".repeat(200)
        val candidates = rewindCandidates(listOf(
            message(0, "user", long),
            message(1, "user", null, image = true),
            message(2, "user", "  \n "),
        ))
        assertEquals(3, candidates.size)
        assertNull(candidates[0].timestamp)
        assertEquals("空消息", candidates[0].preview)
        assertEquals("图片消息", candidates[1].preview)
        val first = requireNotNull(candidates[2].preview)
        assertEquals(true, first.startsWith("a b 字"))
        assertEquals(true, first.length <= 121)
        assertEquals(false, first.contains("\n"))
    }

    @Test fun `a long history is bounded from the newest side without losing indexes`() {
        val messages = (0 until 80L).map { message(it, "user", "m$it") }
        val candidates = rewindCandidates(messages, limit = 20)
        assertEquals(20, candidates.size)
        assertEquals("m79", candidates.first().preview)
        assertEquals(0L, candidates.first().userIndexFromEnd)
        assertEquals("m60", candidates.last().preview)
        assertEquals(19L, candidates.last().userIndexFromEnd)
        assertEquals(0, rewindCandidates(emptyList()).size)
    }
}
