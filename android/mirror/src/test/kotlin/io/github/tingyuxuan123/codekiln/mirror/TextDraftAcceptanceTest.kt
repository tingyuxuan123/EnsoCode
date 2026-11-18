package io.github.tingyuxuan123.eaves.mirror

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Boundary round trips must include encode, not only in-memory normalize. */
class TextDraftAcceptanceTest {
    private val key = DraftKey(DraftKind.Session, "session-a")
    private fun roundTrip(text: String) =
        TextDraftRecord.decode(TextDraftRecord.encode("pair-a", mapOf(key to text))).entries.getValue(key)

    @Test fun `ASCII text at both sides of the 32000 ceiling round trips`() {
        for (size in listOf(1, 31_999, 32_000, 32_001)) {
            assertEquals("a".repeat(size.coerceAtMost(32_000)), roundTrip("a".repeat(size)))
        }
    }

    @Test fun `Chinese text at the accepted 32000 ceiling round trips`() {
        assertEquals("字".repeat(32_000), roundTrip("字".repeat(32_000)))
    }

    @Test fun `Chinese text just above 65535 modified UTF bytes remains a valid draft`() {
        assertEquals("字".repeat(21_846), roundTrip("字".repeat(21_846)))
    }

    @Test fun `emoji within the accepted 32000 UTF16 units round trips`() {
        val text = "😀".repeat(16_000)
        assertEquals(32_000, text.length)
        assertEquals(text, roundTrip(text))
    }

    @Test fun `truncation never splits a Unicode surrogate pair`() {
        val bounded = TextDraftRecord.normalize(mapOf(key to ("a" + "😀".repeat(16_000)))).getValue(key)
        assertTrue(bounded.length <= DRAFT_TEXT_LIMIT)
        assertFalse("A persisted composer must not end with a lone high surrogate", bounded.last().isHighSurrogate())
    }

    @Test fun `64000 total units fit and the 64001st evicts only the oldest slot`() {
        val second = DraftKey(DraftKind.Chat, "chat-a")
        val entries = linkedMapOf(key to "a".repeat(32_000), second to "b".repeat(32_000))
        assertEquals(entries, TextDraftRecord.decode(TextDraftRecord.encode("pair-a", entries)).entries)
        val third = DraftKey(DraftKind.Session, "newest")
        entries[third] = "c"
        assertEquals(mapOf(second to "b".repeat(32_000), third to "c"), TextDraftRecord.normalize(entries))
    }

    @Test fun `eviction remains last edited first after a process restart`() {
        val oldest = DraftKey(DraftKind.Session, "z-oldest")
        val recent = DraftKey(DraftKind.Session, "a-01")
        val entries = linkedMapOf(oldest to "old")
        repeat(23) { entries[DraftKey(DraftKind.Session, "a-${(it + 1).toString().padStart(2, '0')}")] = "recent-$it" }
        val restored = TextDraftRecord.decode(TextDraftRecord.encode("pair-a", entries)).entries.toMutableMap()
        restored[DraftKey(DraftKind.Session, "zz-newest")] = "new"
        val bounded = TextDraftRecord.normalize(restored)
        assertEquals(24, bounded.size)
        assertTrue("A recent edit must not be evicted merely because its ID sorts first", bounded.containsKey(recent))
        assertFalse("The oldest edit must be evicted across restart too", bounded.containsKey(oldest))
    }
}
