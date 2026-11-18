package io.github.tingyuxuan123.eaves.mirror

/** The kind of local composer a draft belongs to. Ids never cross between kinds. */
enum class DraftKind { Session, Chat, NewTask }

/** Storage ceilings: one draft can never exceed a composer, and only the newest slots are kept. */
const val DRAFT_TEXT_LIMIT = SESSION_TEXT_LIMIT
const val DRAFT_ENTRY_LIMIT = 24

/** Total characters across slots, so the encrypted file stays small enough to always be writable. */
const val DRAFT_TOTAL_LIMIT = 64_000

/** A draft slot: one composer in one authoritative conversation, plus the new-task description. */
data class DraftKey(val kind: DraftKind, val id: String)

/**
 * Bounded, encrypted-at-rest text drafts for the current pairing identity only.
 * Implementations must not throw for unreadable storage: a broken file reads as no drafts.
 */
interface TextDraftStore {
    fun load(pairId: String): Map<DraftKey, String>
    fun save(pairId: String, entries: Map<DraftKey, String>)
    /** Delete drafts; with a pair id, only when the stored file still belongs to that identity. */
    fun clear(pairId: String? = null)
}
