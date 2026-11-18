package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.pair.SessionMessage
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal data class RewindCandidate(
    val userIndexFromEnd: Long,
    val index: Long,
    val preview: String,
    val timestamp: Long?,
)

/**
 * Desktop counts `userIndexFromEnd` over persisted user entries, so only real user messages in the
 * retained tail may be offered. Newest first, bounded so the sheet never loads an entire history.
 */
internal fun rewindCandidates(messages: List<SessionMessage>, limit: Int = 20): List<RewindCandidate> {
    if (limit <= 0) return emptyList()
    val users = messages.filter { it.role == "user" }
    return users.takeLast(limit).reversed().mapIndexed { offset, message ->
        RewindCandidate(offset.toLong(), message.index, messagePreview(message), message.timestamp)
    }
}

private const val PREVIEW_LIMIT = 120
private const val IMAGE_ONLY = "图片消息"
private const val NO_TEXT = "空消息"

private fun messagePreview(message: SessionMessage): String {
    val text = message.content.mapNotNull { part ->
        val type = (part["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (type != "text") null else (part["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }.joinToString(" ").replace(Regex("\\s+"), " ").trim()
    return when {
        text.isNotEmpty() -> text.take(PREVIEW_LIMIT) + if (text.length > PREVIEW_LIMIT) "…" else ""
        message.content.any { (it["type"] as? JsonPrimitive)?.content == "image" } -> IMAGE_ONLY
        else -> NO_TEXT
    }
}
