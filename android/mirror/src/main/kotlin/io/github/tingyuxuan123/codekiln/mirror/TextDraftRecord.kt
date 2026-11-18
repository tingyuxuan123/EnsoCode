package io.github.tingyuxuan123.eaves.mirror

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/** Versioned plaintext format used only inside the encrypted draft envelope. */
internal object TextDraftRecord {
    /** Same ceiling as a composer, so a persisted draft can never exceed what can be sent. */
    const val MAX_TEXT = DRAFT_TEXT_LIMIT
    const val MAX_ENTRIES = DRAFT_ENTRY_LIMIT
    const val MAX_TOTAL = DRAFT_TOTAL_LIMIT
    const val MAX_ID_LENGTH = 512
    const val MAX_SIZE = 768 * 1024

    /**
     * 1: text stored with `writeUTF` (65535 byte ceiling, so a full 32000 character Chinese draft could not be saved).
     * 2: text stored as a UTF-8 byte length + raw UTF-8 bytes, and entry order kept as the order of last edit.
     */
    private const val VERSION = 2
    private const val MIN_VERSION = 1
    private const val MAX_KIND = 2
    private const val MAX_TEXT_BYTES = MAX_TEXT * 3

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
            usable[key] = truncate(text)
        }
        val kept = LinkedHashMap<DraftKey, String>()
        usable.entries.drop((usable.size - MAX_ENTRIES).coerceAtLeast(0)).forEach { (key, text) -> kept[key] = text }
        while (kept.size > 1 && kept.values.sumOf { it.length } > MAX_TOTAL) kept.remove(kept.keys.first())
        return kept
    }

    /** Cuts to the composer ceiling without leaving half of a surrogate pair at the end. */
    private fun truncate(text: String): String {
        if (text.length <= MAX_TEXT) return text
        val cut = text.take(MAX_TEXT)
        return if (cut.last().isHighSurrogate()) cut.dropLast(1) else cut
    }

    fun encode(pairId: String, entries: Map<DraftKey, String>): ByteArray {
        require(PairCredentialRecord.isRouteIdentifier(pairId)) { "Invalid draft record" }
        val normalized = normalize(entries)
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            out.writeByte(VERSION)
            out.writeUTF(pairId)
            out.writeByte(normalized.size)
            // Iteration order is the order of last edit, so eviction still drops the oldest slot after a restart.
            normalized.forEach { (key, text) ->
                out.writeByte(key.kind.ordinal)
                out.writeUTF(key.id)
                writeText(out, text)
            }
        }
        return bytes.toByteArray().also { require(it.size <= MAX_SIZE) { "Invalid draft record" } }
    }

    fun decode(bytes: ByteArray): Record {
        require(bytes.size in 2..MAX_SIZE) { "Invalid draft record" }
        return try {
            DataInputStream(ByteArrayInputStream(bytes)).use { input ->
                val version = input.readUnsignedByte()
                require(version in MIN_VERSION..VERSION) { "Invalid draft record" }
                val pairId = input.readUTF()
                require(PairCredentialRecord.isRouteIdentifier(pairId)) { "Invalid draft record" }
                val count = input.readUnsignedByte()
                require(count <= MAX_ENTRIES) { "Invalid draft record" }
                val entries = LinkedHashMap<DraftKey, String>()
                repeat(count) {
                    val kind = DraftKind.entries.getOrNull(input.readUnsignedByte())?.takeIf { it.ordinal <= MAX_KIND }
                        ?: throw IllegalArgumentException("Invalid draft record")
                    val id = input.readUTF()
                    val text = if (version >= 2) readText(input) else input.readUTF()
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

    private fun writeText(out: DataOutputStream, text: String) {
        val encoded = text.toByteArray(Charsets.UTF_8)
        out.writeInt(encoded.size)
        out.write(encoded)
    }

    /** Strict UTF-8: a record that does not decode exactly is treated as unreadable, never as mojibake. */
    private fun readText(input: DataInputStream): String {
        val size = input.readInt()
        require(size in 0..MAX_TEXT_BYTES) { "Invalid draft record" }
        val encoded = ByteArray(size)
        input.readFully(encoded)
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(encoded))
                .toString()
        } catch (_: CharacterCodingException) {
            throw IllegalArgumentException("Invalid draft record")
        }
    }

    private fun isDraftKey(key: DraftKey): Boolean =
        key.id.length in 1..MAX_ID_LENGTH && key.id.none(Char::isISOControl)
}
