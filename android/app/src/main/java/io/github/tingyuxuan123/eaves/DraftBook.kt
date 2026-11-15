package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DRAFT_ENTRY_LIMIT
import io.github.tingyuxuan123.eaves.mirror.DRAFT_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.mirror.DRAFT_TOTAL_LIMIT
import io.github.tingyuxuan123.eaves.mirror.DraftKey
import io.github.tingyuxuan123.eaves.mirror.TextDraftStore
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Bounded composer text kept across pages and process restarts, scoped to the current pairing identity.
 * Text leaves memory only through [DraftBook.edit] (the user's words) or [DraftBook.confirm] (the desktop's
 * matching confirmation). A stale confirmation never erases text typed after the submit.
 */
internal class DraftBook(
    private val store: TextDraftStore,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val debounceMillis: Long = 250,
) {
    private val mutable = MutableStateFlow<Map<DraftKey, String>>(emptyMap())
    val drafts: StateFlow<Map<DraftKey, String>> = mutable.asStateFlow()
    private var pairId: String? = null
    private var pending: Job? = null
    private var dirty = false

    /** Adopts a pairing identity: loads its drafts, or drops memory when there is no pairing. */
    fun bind(next: String?) {
        if (next == pairId) return
        pairId = next
        pending?.cancel()
        pending = null
        dirty = false
        mutable.value = emptyMap()
        if (next == null) return
        scope.launch(io) {
            val loaded = try { store.load(next) } catch (_: Exception) { emptyMap() }
            if (pairId != next) return@launch
            mutable.value = loaded + mutable.value
        }
    }

    fun text(key: DraftKey): String = mutable.value[key].orEmpty()

    fun edit(key: DraftKey, text: String) {
        val bounded = text.take(DRAFT_TEXT_LIMIT)
        val next = LinkedHashMap(mutable.value)
        next.remove(key)
        if (bounded.isNotBlank()) next[key] = bounded
        while (next.size > DRAFT_ENTRY_LIMIT) next.remove(next.keys.first())
        while (next.size > 1 && next.values.sumOf { it.length } > DRAFT_TOTAL_LIMIT) next.remove(next.keys.first())
        if (next == mutable.value) return
        mutable.value = next
        dirty = true
        schedule()
    }

    /** Clears only when the stored text is still the text that was submitted. */
    fun confirm(key: DraftKey, submittedText: String) {
        if (mutable.value[key] != submittedText) return
        val next = LinkedHashMap(mutable.value)
        next.remove(key)
        mutable.value = next
        dirty = true
        persistNow()
    }

    /** Called when leaving the foreground: writes the pending debounce immediately. */
    fun flush() {
        val owner = pairId ?: return
        pending?.cancel()
        pending = null
        if (!dirty) return
        persist(owner)
    }

    private fun schedule() {
        val owner = pairId ?: return
        pending?.cancel()
        pending = scope.launch(io) {
            delay(debounceMillis)
            if (pairId != owner) return@launch
            persist(owner)
            pending = null
        }
    }

    private fun persistNow() {
        val owner = pairId ?: return
        pending?.cancel()
        pending = null
        persist(owner)
    }

    private fun persist(owner: String) {
        val snapshot = mutable.value
        dirty = false
        try {
            store.save(owner, snapshot)
        } catch (_: Exception) {
            // Kept in memory; the next edit or flush retries. Never surfaced as a send failure.
            dirty = true
        }
    }
}
