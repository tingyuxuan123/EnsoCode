package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.pair.SessionMessage
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal data class SessionTurn(
    val index: Long,
    val user: Boolean,
    val timestamp: Long?,
    val blocks: List<SessionBlock>,
)

internal sealed interface SessionBlock {
    data class Prose(val text: String) : SessionBlock
    data class Steps(val steps: List<SessionStep>) : SessionBlock
    data class Images(val images: List<TimelineImage>) : SessionBlock
    data object ImagePlaceholder : SessionBlock
}

internal data class SessionStep(val name: String, val detail: String?, val result: String? = null, val callId: String? = null)

internal fun sessionTurns(messages: List<SessionMessage>): List<SessionTurn> {
    val calls = messages.flatMap { it.content }.filter { it["type"].text() == "toolCall" }
        .mapNotNull { it["id"].text() }.toSet()
    val results = messages.filter { it.role == "toolResult" && it.toolCallId != null }.associate {
        it.toolCallId!! to it.content.filter { part -> part["type"].text() == "text" }
            .mapNotNull { part -> part["text"].text() }.joinToString("\n").take(8192)
    }
    val turns = mutableListOf<SessionTurn>()
    var current: TurnBuilder? = null
    fun flush() {
        current?.let { if (it.blocks.isNotEmpty()) turns.add(it.build()) }
        current = null
    }
    for (message in messages) {
        if (message.role == "user") {
            flush()
            val builder = TurnBuilder(message.index, true, message.timestamp)
            for (part in message.content) when (part["type"].text()) {
                "text" -> part["text"].text()?.takeIf { it.isNotEmpty() }?.let { builder.prose(it) }
                "image" -> builder.image(part)
            }
            if (builder.blocks.isNotEmpty()) turns.add(builder.build())
        } else if (message.role == "assistant") {
            val builder = current ?: TurnBuilder(message.index, false, message.timestamp).also { current = it }
            for (part in message.content) when (part["type"].text()) {
                "text" -> part["text"].text()?.takeIf { it.isNotEmpty() }?.let { builder.prose(it) }
                "thinking" -> builder.step(SessionStep("思考", part["text"].text()))
                "toolCall" -> {
                    val id = part["id"].text()
                    val arguments = part["arguments"] as? JsonObject
                    val detail = listOf("command", "path", "file_path", "pattern", "description")
                        .firstNotNullOfOrNull { arguments?.get(it).text() } ?: arguments?.toString()
                    builder.step(SessionStep(part["name"].text() ?: "工具", detail?.take(8192), results[id], id))
                }
                "image" -> builder.image(part)
            }
        } else if (message.role == "toolResult" && message.toolCallId !in calls) {
            val builder = current ?: TurnBuilder(message.index, false, message.timestamp).also { current = it }
            builder.step(SessionStep(message.toolName ?: "工具结果", null,
                message.toolCallId?.let(results::get) ?: message.content.mapNotNull { it["text"].text() }.joinToString("\n").take(8192),
                message.toolCallId))
        }
    }
    flush()
    return turns
}

private class TurnBuilder(val index: Long, val user: Boolean, val timestamp: Long?) {
    val blocks = mutableListOf<SessionBlock>()
    fun image(part: kotlinx.serialization.json.JsonObject) {
        val image = timelineImages(listOf(part)).singleOrNull()
        if (image == null) blocks.add(SessionBlock.ImagePlaceholder)
        else {
            val previous = blocks.lastOrNull() as? SessionBlock.Images
            if (previous == null) blocks.add(SessionBlock.Images(listOf(image)))
            else blocks[blocks.lastIndex] = SessionBlock.Images(previous.images + image)
        }
    }
    fun prose(text: String) {
        val previous = blocks.lastOrNull() as? SessionBlock.Prose
        if (previous == null) blocks.add(SessionBlock.Prose(text))
        else blocks[blocks.lastIndex] = SessionBlock.Prose(previous.text + "\n\n" + text)
    }
    fun step(value: SessionStep) {
        val previous = blocks.lastOrNull() as? SessionBlock.Steps
        if (previous == null) blocks.add(SessionBlock.Steps(listOf(value)))
        else blocks[blocks.lastIndex] = SessionBlock.Steps(previous.steps + value)
    }
    fun build() = SessionTurn(index, user, timestamp, blocks.toList())
}

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
