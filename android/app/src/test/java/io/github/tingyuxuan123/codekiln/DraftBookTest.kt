package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DRAFT_ENTRY_LIMIT
import io.github.tingyuxuan123.eaves.mirror.DRAFT_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.mirror.DRAFT_TOTAL_LIMIT
import io.github.tingyuxuan123.eaves.mirror.DraftKey
import io.github.tingyuxuan123.eaves.mirror.DraftKind
import io.github.tingyuxuan123.eaves.mirror.TextDraftStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DraftBookTest {
    private class Store(var pairId: String? = null, var entries: Map<DraftKey, String> = emptyMap(),
        var broken: Boolean = false) : TextDraftStore {
        var writes = 0
        var clears = 0
        override fun load(pairId: String): Map<DraftKey, String> {
            check(!broken) { "unreadable" }
            return if (this.pairId == pairId) entries else emptyMap()
        }
        override fun save(pairId: String, entries: Map<DraftKey, String>) {
            check(!broken) { "unwritable" }
            writes++
            this.pairId = pairId
            this.entries = entries
        }
        override fun clear(pairId: String?) {
            clears++
            if (pairId == null || this.pairId == pairId) { this.pairId = null; entries = emptyMap() }
        }
    }

    private val code = DraftKey(DraftKind.Session, "session-1")
    private val chat = DraftKey(DraftKind.Chat, "chat-1")

    @Test fun `重新进入时读回同一配对身份的草稿`() = runTest {
        val store = Store("pair-a", mapOf(code to "写了一半", chat to "群里的草稿"))
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        assertEquals("写了一半", book.text(code))
        assertEquals("群里的草稿", book.text(chat))
    }

    @Test fun `编辑在防抖后落盘且不需要额外确认`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "第一版")
        advanceTimeBy(10)
        assertEquals(0, store.writes)
        advanceUntilIdle()
        assertEquals("第一版", store.entries[code])
    }

    @Test fun `flush 立即落盘`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "没等防抖就退到后台")
        book.flush()
        assertEquals("没等防抖就退到后台", store.entries[code])
    }

    @Test fun `发送确认只清掉与提交一致的文字`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "已提交")
        assertEquals("已提交", book.pin(code))
        book.edit(code, "提交后又改了")
        book.confirm(code, "已提交")
        assertEquals("提交后又改了", book.text(code))
        advanceUntilIdle()
        assertEquals("提交后又改了", store.entries[code])
        assertEquals("提交后又改了", book.pin(code))
        book.confirm(code, "提交后又改了")
        assertNull(book.text(code).takeIf { it.isNotEmpty() })
        advanceUntilIdle()
        assertEquals(emptyMap<DraftKey, String>(), store.entries)
    }

    @Test fun `失败断线保留文字且不自动重发`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "断线时没发出去")
        book.confirm(code, "别的文字")
        advanceUntilIdle()
        assertEquals("断线时没发出去", book.text(code))
        assertEquals("断线时没发出去", store.entries[code])
    }

    @Test fun `换配对身份后不再写入或显示上一台电脑的草稿`() = runTest {
        val store = Store("pair-a", mapOf(code to "旧电脑草稿"))
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        assertEquals("旧电脑草稿", book.text(code))
        book.edit(code, "旧电脑还没落盘")
        book.bind("pair-b")
        advanceUntilIdle()
        assertEquals("", book.text(code))
        assertEquals("旧电脑草稿", store.entries[code])
        book.edit(code, "新电脑草稿")
        advanceUntilIdle()
        assertEquals("pair-b", store.pairId)
        assertEquals("新电脑草稿", store.entries[code])
    }

    @Test fun `解绑后内存清空且不再写回已删除的草稿`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "解绑前的草稿")
        book.bind(null)
        book.flush()
        advanceUntilIdle()
        assertEquals("", book.text(code))
        assertEquals(emptyMap<DraftKey, String>(), store.entries)
    }

    @Test fun `坏存储不会抛出也不会丢掉内存里的文字`() = runTest {
        val store = Store("pair-a", broken = true)
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "存储坏了也要留在输入框")
        advanceUntilIdle()
        assertEquals("存储坏了也要留在输入框", book.text(code))
    }

    @Test fun `草稿文字与条目数量都有上限`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "字".repeat(DRAFT_TEXT_LIMIT + 500))
        advanceUntilIdle()
        assertEquals(DRAFT_TEXT_LIMIT, book.text(code).length)
        assertEquals(DRAFT_TEXT_LIMIT, store.entries.getValue(code).length)
        repeat(DRAFT_ENTRY_LIMIT + 3) { index -> book.edit(DraftKey(DraftKind.Session, "s-$index"), "v$index") }
        advanceUntilIdle()
        assertEquals(DRAFT_ENTRY_LIMIT, store.entries.size)
        assertTrue(store.entries.containsKey(DraftKey(DraftKind.Session, "s-${DRAFT_ENTRY_LIMIT + 2}")))
        assertTrue(!store.entries.containsKey(code))
    }

    @Test fun `空白草稿等于没有草稿`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(code, "   \n ")
        advanceUntilIdle()
        assertEquals("", book.text(code))
        assertEquals(emptyMap<DraftKey, String>(), store.entries)
    }

    @Test fun `多条长草稿按总字数上限淘汰且最新一条仍能落盘`() = runTest {
        val store = Store("pair-a")
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        repeat(20) { index -> book.edit(DraftKey(DraftKind.Session, "long-$index"), "字".repeat(8_000)) }
        advanceUntilIdle()
        assertTrue(book.drafts.value.values.sumOf { it.length } <= DRAFT_TOTAL_LIMIT)
        assertTrue(store.entries.values.sumOf { it.length } <= DRAFT_TOTAL_LIMIT)
        assertEquals("字".repeat(8_000), store.entries[DraftKey(DraftKind.Session, "long-19")])
    }
}
