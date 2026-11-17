package io.github.tingyuxuan123.eaves.mirror

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TextDraftRecordTest {
    private val pair = "pair-fixture"
    private val session = DraftKey(DraftKind.Session, "session-1")
    private val chat = DraftKey(DraftKind.Chat, "chat-1")

    @Test fun `草稿往返保留配对身份与条目内容`() {
        val entries = mapOf(session to "第一行\n第二行", chat to "群里未发出的文字")
        val decoded = TextDraftRecord.decode(TextDraftRecord.encode(pair, entries))
        assertEquals(pair, decoded.pairId)
        assertEquals(entries, decoded.entries)
    }

    /**
     * 编辑顺序是草稿内容的一部分：重启后仍要按「最近编辑」淘汰，所以同一条目不同编辑顺序必须写出不同字节，
     * 否则解码后拿不回真正的先后。这里只要求「同样的内容 + 同样的编辑顺序」写出的字节稳定。
     */
    @Test fun `同样的草稿与同样的编辑顺序写出稳定的字节`() {
        val first = TextDraftRecord.encode(pair, linkedMapOf(session to "a", chat to "b"))
        val second = TextDraftRecord.encode(pair, linkedMapOf(session to "a", chat to "b"))
        assertTrue(first.contentEquals(second))
        assertFalse("编辑顺序是内容，顺序不同不能写出同样的字节",
            first.contentEquals(TextDraftRecord.encode(pair, linkedMapOf(chat to "b", session to "a"))))
    }

    @Test fun `不同配对身份读到的对应草稿互不相通`() {
        val stored = TextDraftRecord.decode(TextDraftRecord.encode(pair, mapOf(session to "旧电脑的草稿")))
        assertEquals(mapOf(session to "旧电脑的草稿"), TextDraftRecord.adopt(stored, pair))
        assertEquals(emptyMap<DraftKey, String>(), TextDraftRecord.adopt(stored, "pair-other"))
        assertEquals(emptyMap<DraftKey, String>(), TextDraftRecord.adopt(null, pair))
    }

    @Test fun `空白草稿不落盘`() {
        assertEquals(emptyMap<DraftKey, String>(), TextDraftRecord.normalize(mapOf(session to "", chat to "   \n\t")))
    }

    @Test fun `单条草稿截断到上限且不静默丢字符之外的字段`() {
        val long = "字".repeat(TextDraftRecord.MAX_TEXT + 500)
        val normalized = TextDraftRecord.normalize(mapOf(session to long))
        assertEquals(TextDraftRecord.MAX_TEXT, normalized.getValue(session).length)
        assertTrue(normalized.getValue(session).all { it == '字' })
    }

    @Test fun `条目数量有上限并保留最近的写入`() {
        val entries = LinkedHashMap<DraftKey, String>()
        repeat(TextDraftRecord.MAX_ENTRIES + 6) { index -> entries[DraftKey(DraftKind.Session, "s-$index")] = "v$index" }
        val normalized = TextDraftRecord.normalize(entries)
        assertEquals(TextDraftRecord.MAX_ENTRIES, normalized.size)
        assertTrue(normalized.containsKey(DraftKey(DraftKind.Session, "s-${TextDraftRecord.MAX_ENTRIES + 5}")))
        assertEquals(false, normalized.containsKey(DraftKey(DraftKind.Session, "s-0")))
    }

    @Test fun `非法会话标识的草稿被丢弃而不是写坏记录`() {
        val normalized = TextDraftRecord.normalize(mapOf(
            DraftKey(DraftKind.Session, "") to "空",
            DraftKey(DraftKind.Chat, "bad\u0000id") to "控制字符",
            DraftKey(DraftKind.Chat, "x".repeat(513)) to "过长",
            session to "合法",
        ))
        assertEquals(mapOf(session to "合法"), normalized)
    }

    @Test fun `多条长草稿不会撑爆记录：总字数有上限且保留最近的`() {
        val entries = LinkedHashMap<DraftKey, String>()
        repeat(20) { index -> entries[DraftKey(DraftKind.Session, "long-$index")] = "字".repeat(8_000) }
        val normalized = TextDraftRecord.normalize(entries)
        assertEquals(true, normalized.values.sumOf { it.length } <= TextDraftRecord.MAX_TOTAL)
        assertEquals("字".repeat(8_000), normalized[DraftKey(DraftKind.Session, "long-19")])
        assertEquals(false, normalized.containsKey(DraftKey(DraftKind.Session, "long-0")))
        assertEquals(true, TextDraftRecord.decode(TextDraftRecord.encode(pair, entries)).entries.size <= normalized.size)
    }

    @Test fun `坏记录只抛通用错误`() {
        val valid = TextDraftRecord.encode(pair, mapOf(session to "草稿"))
        for (bad in listOf(
            ByteArray(0),
            valid.copyOf().also { it[0] = 9 },
            valid.copyOf(valid.size - 1),
            ByteArray(TextDraftRecord.MAX_SIZE + 1),
        )) {
            try {
                TextDraftRecord.decode(bad)
                throw AssertionError("corrupt record decoded")
            } catch (expected: IllegalArgumentException) {
                assertNotEquals("", expected.message)
            }
        }
    }

    @Test fun `文本与身份不出现在异常消息里`() {
        val broken = TextDraftRecord.encode(pair, mapOf(session to "机密草稿正文")).copyOf().also { it[0] = 9 }
        val message = try { TextDraftRecord.decode(broken); "" } catch (error: IllegalArgumentException) {
            error.message.orEmpty()
        }
        assertTrue(message.none { it.isISOControl() })
        assertEquals(false, message.contains("机密草稿正文"))
    }
}
