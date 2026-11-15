package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DraftKey
import io.github.tingyuxuan123.eaves.mirror.DraftKind
import io.github.tingyuxuan123.eaves.mirror.TextDraftStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** Independent first-batch acceptance: assertions describe the user-visible draft contract. */
@OptIn(ExperimentalCoroutinesApi::class)
class DraftBookAcceptanceTest {
    private val key = DraftKey(DraftKind.Session, "same-id")

    private class Store : TextDraftStore {
        var entries = emptyMap<DraftKey, String>()
        var owner = "pair-a"
        var beforeLoadReturns: (() -> Unit)? = null
        var broken = false
        var writes = 0
        override fun load(pairId: String): Map<DraftKey, String> {
            val snapshot = if (pairId == owner) entries else emptyMap()
            beforeLoadReturns?.invoke()
            return snapshot
        }
        override fun save(pairId: String, entries: Map<DraftKey, String>) {
            check(!broken) { "disk unavailable" }
            writes++
            owner = pairId
            this.entries = entries
        }
        override fun clear(pairId: String?) { if (pairId == null || pairId == owner) entries = emptyMap() }
    }

    @Test fun `same ID in Code Bot and new task remains isolated after reload`() = runTest {
        val store = Store()
        val dispatcher = StandardTestDispatcher(testScheduler)
        val book = DraftBook(store, this, dispatcher)
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(key, "code")
        book.edit(DraftKey(DraftKind.Chat, key.id), "bot")
        book.edit(DraftKey(DraftKind.NewTask, key.id), "new task")
        book.flush()
        val restored = DraftBook(store, this, dispatcher)
        restored.bind("pair-a")
        advanceUntilIdle()
        assertEquals("code", restored.text(key))
        assertEquals("bot", restored.text(DraftKey(DraftKind.Chat, key.id)))
        assertEquals("new task", restored.text(DraftKey(DraftKind.NewTask, key.id)))
    }

    @Test fun `A submitted then B then A is a newer edit and old confirmation must not erase it`() = runTest {
        val store = Store()
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(key, "A")
        val submitted = book.text(key)
        book.edit(key, "B")
        book.edit(key, "A")
        book.confirm(key, submitted)
        assertEquals("The later editing revision must survive the earlier receipt", "A", book.text(key))
        book.flush()
        assertEquals("A", store.entries[key])
    }

    @Test fun `clearing a draft while initial disk load is outstanding must not resurrect the old draft`() = runTest {
        val store = Store().apply { entries = mapOf(key to "old disk draft") }
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        // A synchronous store hook models UI edits interleaved with the IO dispatcher load.
        store.beforeLoadReturns = {
            book.edit(key, "typed before load completes")
            book.edit(key, "")
        }
        book.bind("pair-a")
        advanceUntilIdle()
        assertEquals("An explicit empty edit is newer than the disk snapshot", "", book.text(key))
        assertEquals(emptyMap<DraftKey, String>(), store.entries)
    }

    @Test fun `debounce upper edge and onStop style flush preserve the latest edit`() = runTest {
        val store = Store()
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(key, "before stop")
        advanceTimeBy(249)
        runCurrent()
        assertEquals(0, store.writes)
        book.flush()
        assertEquals(mapOf(key to "before stop"), store.entries)
        advanceUntilIdle()
        assertEquals(1, store.writes)
    }

    @Test fun `a failed save is retried by flush after storage recovers without sending anything`() = runTest {
        val store = Store().apply { broken = true }
        val book = DraftBook(store, this, StandardTestDispatcher(testScheduler))
        book.bind("pair-a")
        advanceUntilIdle()
        book.edit(key, "keep me")
        advanceUntilIdle()
        assertEquals("keep me", book.text(key))
        assertEquals(0, store.writes)
        store.broken = false
        book.flush()
        assertEquals(mapOf(key to "keep me"), store.entries)
    }
}
