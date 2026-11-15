package io.github.tingyuxuan123.eaves.mirror

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException

/** Versioned plaintext format used only inside the encrypted draft envelope. */
internal object TextDraftRecord {
    /** Same ceiling as a composer, so a persisted draft can never exceed what can be sent. */
    const val MAX_TEXT = DRAFT_TEXT_LIMIT
    const val MAX_ENTRIES = DRAFT_ENTRY_LIMIT
    const val MAX_TOTAL = DRAFT_TOTAL_LIMIT
    const val MAX_ID_LENGTH = 512
    const val MAX_SIZE = 768 * 1024
    private const val VERSION = 1
    private const val MAX_KIND = 2

    data class Record(val pairId: String, val entries: Map<DraftKey, String>)

    /** Drafts of another pairing identity are never adopted. */
    fun adopt(record: Record?, pairId: String): Map<DraftKey, String> =
        if (record != null && record.pairId == pairId) record.entries else emptyMap()

    /** Drops unusable slots, blank text and overflow; keeps the newest entries of the given order. */
    fun normalize(entries: Map<DraftKey, String>): Map<DraftKey, String> {
        val usable = LinkedHashMap<DraftKey, String>()
        for ((key, text) in entries) {
            if (!isDraftKey(key)) continue
            if (text.isBlank()) continue
            usable[key] = text.take(MAX_TEXT)
        }
        val kept = LinkedHashMap<DraftKey, String>()
        usable.entries.drop((usable.size - MAX_ENTRIES).coerceAtLeast(0)).forEach { (key, text) -> kept[key] = text }
        while (kept.size > 1 && kept.values.sumOf { it.length } > MAX_TOTAL) kept.remove(kept.keys.first())
        return kept
    }

    fun encode(pairId: String, entries: Map<DraftKey, String>): ByteArray {
        require(PairCredentialRecord.isRouteIdentifier(pairId)) { "Invalid draft record" }
        val normalized = normalize(entries)
        val ordered = normalized.entries.sortedWith(compareBy({ it.key.kind.ordinal }, { it.key.id }))
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            out.writeByte(VERSION)
            out.writeUTF(pairId)
            out.writeByte(ordered.size)
            ordered.forEach { (key, text) ->
                out.writeByte(key.kind.ordinal)
                out.writeUTF(key.id)
                out.writeUTF(text)
            }
        }
        return bytes.toByteArray().also { require(it.size <= MAX_SIZE) { "Invalid draft record" } }
    }

    fun decode(bytes: ByteArray): Record {
        require(bytes.size in 2..MAX_SIZE) { "Invalid draft record" }
        return try {
            DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                require(input.readUnsignedByte() == VERSION) { "Invalid draft record" }
                val pairId = input.readUTF()
                require(PairCredentialRecord.isRouteIdentifier(pairId)) { "Invalid draft record" }
                val count = input.readUnsignedByte()
                require(count <= MAX_ENTRIES) { "Invalid draft record" }
                val entries = LinkedHashMap<DraftKey, String>()
                repeat(count) {
                    val kind = DraftKind.entries.getOrNull(input.readUnsignedByte())?.takeIf { it.ordinal <= MAX_KIND }
                        ?: throw IllegalArgumentException("Invalid draft record")
                    val id = input.readUTF()
                    val text = input.readUTF()
                    val key = DraftKey(kind, id)
                    require(isDraftKey(key) && text.isNotBlank() && text.length <= MAX_TEXT) { "Invalid draft record" }
                    entries[key] = text
                }
                require(entries.values.sumOf { it.length } <= MAX_TOTAL) { "Invalid draft record" }
                require(input.read() == -1) { "Invalid draft record" }
                Record(pairId, entries)
            }
        } catch (_: IOException) {
            throw IllegalArgumentException("Invalid draft record")
        } catch (_: IllegalArgumentException) {
            throw IllegalArgumentException("Invalid draft record")
        }
    }

    private fun isDraftKey(key: DraftKey): Boolean =
        key.id.length in 1..MAX_ID_LENGTH && key.id.none(Char::isISOControl)
}
