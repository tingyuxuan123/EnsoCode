package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Strict envelope validator for packages/pair/src/sessionSync.ts. */
object SessionSync {
    private const val MAX_STRING_LENGTH = 512
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0
    private val cursorKeys = setOf("epoch", "seq")
    private val commonKeys = setOf("type", "sessionId", "requestId", "cursor", "mode")
    private val snapshotKeys = commonKeys + "snapshot"
    private val replayKeys = commonKeys + setOf("fromSeq", "events")

    /** Keep unknown nested event/body fields; the envelope and cursor themselves are exact. */
    fun parse(value: JsonElement): JsonObject? {
        val frame = value as? JsonObject ?: return null
        if (frame["type"].text() != "session-sync") return null
        val sessionId = frame["sessionId"].boundedText() ?: return null
        frame["requestId"].boundedText() ?: return null
        val seq = cursorSequence(frame["cursor"]) ?: return null
        when (frame["mode"].text()) {
            "snapshot" -> if (frame.keys != snapshotKeys || !isSnapshot(frame["snapshot"], sessionId)) return null
            "replay" -> {
                if (frame.keys != replayKeys) return null
                val from = frame["fromSeq"].sequence() ?: return null
                val events = frame["events"] as? JsonArray ?: return null
                if (from > seq || events.size.toLong() != seq - from) return null
                if (events.any { value ->
                    val event = value as? JsonObject
                    event?.get("type").boundedText() == null || event?.get("sessionId").text() != sessionId
                }) return null
            }
            else -> return null
        }
        return frame
    }

    fun isCursor(value: JsonElement): Boolean = cursorSequence(value) != null

    private fun cursorSequence(value: JsonElement?): Long? {
        val cursor = value as? JsonObject ?: return null
        if (cursor.keys != cursorKeys || cursor["epoch"].boundedText() == null) return null
        return cursor["seq"].sequence()
    }

    private fun isSnapshot(value: JsonElement?, sessionId: String): Boolean {
        val snapshot = value as? JsonObject ?: return false
        if (snapshot["type"].text() != "snapshot") return false
        val sessions = snapshot["sessions"] as? JsonArray ?: return false
        val session = sessions.singleOrNull() as? JsonObject ?: return false
        if (session["sessionId"].text() != sessionId || session["messages"] !is JsonArray ||
            session["baseIndex"].sequence() == null) return false
        return "identity" !in session || (session["identity"] as? JsonObject)?.get("sessionId").text() == sessionId
    }

    private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonElement?.boundedText(): String? = text()?.takeIf { it.length in 1..MAX_STRING_LENGTH }

    private fun JsonElement?.sequence(): Long? {
        val value = (this as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toDoubleOrNull() ?: return null
        // JS numbers use IEEE-754 and treat 1, 1.0, 1e0 alike; enforce Number.isSafeInteger.
        if (value !in 0.0..MAX_SAFE_INTEGER || value.toLong().toDouble() != value) return null
        return value.toLong()
    }
}
