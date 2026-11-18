package io.github.tingyuxuan123.codekiln

import io.github.tingyuxuan123.codekiln.mirror.DRAFT_ENTRY_LIMIT
import io.github.tingyuxuan123.codekiln.mirror.DRAFT_TEXT_LIMIT
import io.github.tingyuxuan123.codekiln.mirror.DRAFT_TOTAL_LIMIT
import io.github.tingyuxuan123.codekiln.mirror.DraftKey
import io.github.tingyuxuan123.codekiln.mirror.TextDraftStore
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
 * matching confirmation of a submission the caller explicitly [DraftBook.pin]ned). Reading [DraftBook.text]
 * never authorises anything, so a screen may render the composer as often as it likes.
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

    /** One revision per accepted edit: a confirmation names the revision it observed, not just the text. */
    private var revision = 0L
    private val revisions = HashMap<DraftKey, Long>()

    /**
     * Explicit submissions, one entry per real send: the revision the user pressed send on. Only [pin]
     * writes here, so text equality alone can never clear a draft nobody submitted.
     */
    private val pins = HashMap<DraftKey, Long>()

    /** Slots the user already touched under this pairing; the disk snapshot must never bring them back. */
    private val touched = HashSet<DraftKey>()

    /** Adopts a pairing identity: loads its drafts, or drops memory when there is no pairing. */
    fun bind(next: String?) {
        if (next == pairId) return
        pairId = next
        pending?.cancel()
        pending = null
        dirty = false
        mutable.value = emptyMap()
        revisions.clear()
        pins.clear()
        touched.clear()
        if (next == null) return
        scope.launch(io) {
            val loaded = try { store.load(next) } catch (_: Exception) { emptyMap() }
            if (pairId != next) return@launch
            // Touched slots win outright: an edit or an explicit clear made while the disk load was in flight
            // is newer than the snapshot, so a cleared slot must not be resurrected (and keeps its own order).
            val merged = LinkedHashMap<DraftKey, String>()
            for ((key, text) in loaded) if (key !in touched) merged[key] = text
            merged.putAll(mutable.value)
            mutable.value = merged
        }
    }

    /** Current text of [key]. A pure read: displaying the composer is not a submission. */
    fun text(key: DraftKey): String = mutable.value[key].orEmpty()

    /**
     * Records that the user really sent [key] right now, and hands back the text to submit.
     * Returns null when there is nothing to send. Only the revision captured here may later be cleared.
     */
    fun pin(key: DraftKey): String? {
        val text = mutable.value[key] ?: return null
        pins[key] = revisions[key] ?: 0L
        return text
    }

    fun edit(key: DraftKey, text: String) {
        val bounded = text.take(DRAFT_TEXT_LIMIT)
        val next = LinkedHashMap(mutable.value)
        next.remove(key)
        if (bounded.isNotBlank()) next[key] = bounded
        while (next.size > DRAFT_ENTRY_LIMIT) next.remove(next.keys.first())
        while (next.size > 1 && next.values.sumOf { it.length } > DRAFT_TOTAL_LIMIT) next.remove(next.keys.first())
        if (next == mutable.value) return
        // Any real edit retires the submission it no longer matches; a stale pin can never revive.
        pins.remove(key)
        touched += key
        revisions[key] = ++revision
        mutable.value = next
        dirty = true
        schedule()
    }

    /**
     * Clears only a submission made through [pin] whose revision is still current, so a receipt that
     * arrives while the page is closed still clears the delivered draft, while text edited since
     * (A → B → A) survives. A confirmation without a pin never clears anything.
     * Returns true when the draft was removed.
     */
    fun confirm(key: DraftKey, submittedText: String): Boolean {
        val pinned = pins[key] ?: return false
        if (pinned != (revisions[key] ?: 0L)) {
            pins.remove(key)
            return false
        }
        if (mutable.value[key] != submittedText) return false
        val next = LinkedHashMap(mutable.value)
        next.remove(key)
        mutable.value = next
        pins.remove(key)
        touched += key
        revisions[key] = ++revision
        dirty = true
        persistNow()
        return true
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
