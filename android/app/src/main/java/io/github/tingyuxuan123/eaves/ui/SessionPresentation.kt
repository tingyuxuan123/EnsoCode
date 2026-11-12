package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.pair.SessionTodo
import io.github.tingyuxuan123.eaves.pair.SessionTodoStatus
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
    data class Todos(val items: List<SessionTodo>) : SessionBlock
    data class Notice(val kind: SessionNoticeKind, val detail: String) : SessionBlock
    data class Compaction(val summary: String?) : SessionBlock
    data class Worklog(val entries: List<SessionBlock>, val running: Boolean, val hasAnswer: Boolean) : SessionBlock {
        private val steps = entries.filterIsInstance<Steps>().flatMap { it.steps }
        val thinking = steps.count { it.kind == SessionStepKind.Thinking }
        val calls = steps.size - thinking + entries.count { it is Todos }
        val failures = steps.count { it.failed }
        val notices = entries.count { it is Notice }
    }
    data class Images(val images: List<TimelineImage>) : SessionBlock
    data object ImagePlaceholder : SessionBlock
}

internal enum class SessionNoticeKind(val tag: String, val title: String) {
    Background("background-task-update", "后台任务通知"), Reminder("system-reminder", "系统提醒"),
}

internal data class SessionStep(
    val name: String, val detail: String?, val result: String? = null, val callId: String? = null, val failed: Boolean = false,
    val kind: SessionStepKind = SessionStepKind.Tool,
)
internal enum class SessionStepKind { Thinking, Tool }

private data class CallSite(val messageIndex: Long, val partIndex: Int, val name: String?)
private data class ToolOutput(val text: String?, val notices: List<SessionBlock.Notice>, val todos: List<SessionTodo>?, val failed: Boolean)

internal fun sessionTurns(messages: List<SessionMessage>): List<SessionTurn> {
    val pending = mutableMapOf<String, CallSite>()
    val matched = mutableMapOf<CallSite, ToolOutput>()
    val outputs = mutableMapOf<Long, ToolOutput>()
    val linked = mutableSetOf<Long>()
    for (message in messages) when (message.role) {
        "assistant" -> message.content.forEachIndexed { index, part ->
            if (part["type"].text() == "toolCall") part["id"].text()?.takeIf { it.isNotBlank() }?.let { id ->
                pending[id] = CallSite(message.index, index, part["name"].text())
            }
        }
        "toolResult" -> {
            val output = toolOutput(message)
            outputs[message.index] = output
            val id = message.toolCallId
            val call = pending[id]
            if (call != null && (message.toolName == null || call.name == null || message.toolName == call.name)) {
                pending.remove(id)
                matched[call] = output
                linked += message.index
            }
        }
    }
    val turns = mutableListOf<SessionTurn>()
    var current: TurnBuilder? = null
    fun flush() {
        current?.let { if (it.blocks.isNotEmpty()) turns.add(it.build()) }
        current = null
    }
    for (message in messages) {
        if (message.role == "user") {
            val notice = if (message.content.any { it["type"].text() != "text" }) null else standaloneNotice(message.toolText())
            if (notice != null) {
                val builder = current ?: TurnBuilder(message.index, false, message.timestamp).also { current = it }
                builder.blocks.add(notice)
                continue
            }
            flush()
            val builder = TurnBuilder(message.index, true, message.timestamp)
            for (part in message.content) when (part["type"].text()) {
                "text" -> part["text"].text()?.takeIf { it.isNotEmpty() }?.let { builder.prose(it) }
                "image" -> builder.image(part)
            }
            if (builder.blocks.isNotEmpty()) turns.add(builder.build())
        } else if (message.role == "assistant") {
            val builder = current ?: TurnBuilder(message.index, false, message.timestamp).also { current = it }
            message.content.forEachIndexed { index, part -> when (part["type"].text()) {
                "text" -> part["text"].text()?.takeIf { it.isNotEmpty() }?.let { builder.prose(it) }
                "thinking" -> builder.step(SessionStep("思考", part["text"].text(), kind = SessionStepKind.Thinking))
                "toolCall" -> {
                    val id = part["id"].text()
                    val name = part["name"].text()
                    val output = matched[CallSite(message.index, index, name)]
                    if (output?.todos == null) {
                        val arguments = part["arguments"] as? JsonObject
                        val detail = if (name == "todo") null else listOf("command", "path", "file_path", "pattern", "description")
                            .firstNotNullOfOrNull { arguments?.get(it).text() } ?: arguments?.toString()
                        builder.step(SessionStep(name ?: "工具", detail?.bounded(), output?.text, id, output?.failed == true))
                    }
                }
                "image" -> builder.image(part)
            } }
        } else if (message.role == "toolResult") {
            val output = outputs.getValue(message.index)
            val builder = current ?: TurnBuilder(message.index, false, message.timestamp).also { current = it }
            builder.blocks.addAll(output.notices)
            if (output.todos != null) builder.blocks.add(SessionBlock.Todos(output.todos))
            else if (message.index !in linked) builder.step(SessionStep(message.toolName ?: "工具结果", null, output.text,
                message.toolCallId, output.failed))
            message.content.filter { it["type"].text() == "image" }.forEach(builder::image)
        } else if (message.role == "compactionSummary") {
            flush()
            turns.add(SessionTurn(message.index, false, message.timestamp,
                listOf(SessionBlock.Compaction(message.toolText().takeIf { it.isNotBlank() }?.bounded()))))
        }
    }
    flush()
    return turns
}

/** PWA-style per-reply worklog. Keep live prose and the latest actual deliverables in the timeline. */
internal fun sessionWorklogBlocks(blocks: List<SessionBlock>, running: Boolean): List<SessionBlock> {
    val lastTodo = blocks.indexOfLast { it is SessionBlock.Todos }
    fun activity(index: Int, block: SessionBlock): Boolean = block is SessionBlock.Steps ||
        block is SessionBlock.Notice || block is SessionBlock.Todos && index != lastTodo

    if (blocks.indices.none { activity(it, blocks[it]) }) return blocks
    // Incomplete/failed replies may have no final answer. In that case don't hide any prose.
    val lastProseOrSteps = blocks.indexOfLast { it is SessionBlock.Prose || it is SessionBlock.Steps }
    val answer = lastProseOrSteps.takeIf { !running && it >= 0 && blocks[it] is SessionBlock.Prose }
    val entries = ArrayList<SessionBlock>()
    val visible = ArrayList<SessionBlock>()
    var at = -1
    blocks.forEachIndexed { index, block ->
        if (activity(index, block) || answer != null && block is SessionBlock.Prose && index != answer) {
            if (at < 0) at = visible.size
            entries += block
        } else visible += block
    }
    visible.add(at, SessionBlock.Worklog(entries, running, answer != null))
    return visible
}

private const val DETAIL_LIMIT = 8_192
private fun String.bounded() = if (length <= DETAIL_LIMIT) this else take(DETAIL_LIMIT - 1) + "…"

private fun SessionMessage.toolText() = content.asSequence().filter { it["type"].text() == "text" }
    .mapNotNull { it["text"].text() }.joinToString("\n")

/** Match only complete leading envelopes; ordinary Markdown and embedded stdout are not rewritten. */
private fun readNotice(text: String, kind: SessionNoticeKind): Pair<SessionBlock.Notice, Int>? {
    val open = "<${kind.tag}>"
    val close = "</${kind.tag}>"
    if (!text.startsWith(open)) return null
    val end = text.indexOf(close, open.length)
    if (end < 0) return null
    return SessionBlock.Notice(kind, text.substring(open.length, end).trim().bounded()) to end + close.length
}

private fun standaloneNotice(text: String): SessionBlock.Notice? {
    val trimmed = text.trim()
    val (notice, end) = readNotice(trimmed, SessionNoticeKind.Background) ?: return null
    return notice.takeIf { end == trimmed.length }
}

private fun toolOutput(message: SessionMessage): ToolOutput {
    val notices = mutableListOf<SessionBlock.Notice>()
    var text = message.toolText()
    while (notices.size < 16) {
        val leading = text.trimStart()
        val (notice, end) = SessionNoticeKind.entries.firstNotNullOfOrNull { readNotice(leading, it) } ?: break
        notices += notice
        text = leading.substring(end).trimStart('\r', '\n')
    }
    val todos = if (message.toolName == "todo" && !message.isError) message.todos ?: legacyTodos(text) else null
    return ToolOutput(text.takeUnless { it.isEmpty() }?.bounded(), notices, todos, message.isError)
}

private val TODO_HEADER = Regex("Todos \\((\\d{1,2})/(\\d{1,2}) done\\):")
private val TODO_ITEM = Regex("\\[([x~ ])\\] (.{1,4096})")

/** Older hosts may omit structured data. Only decode the todo tool's exact, consistent result format. */
private fun legacyTodos(text: String): List<SessionTodo>? {
    if (text.length > DETAIL_LIMIT) return null
    val value = text.trim()
    if (value == "Todo list cleared") return emptyList()
    val lines = value.lineSequence().take(66).toList()
    val header = TODO_HEADER.matchEntire(lines.firstOrNull() ?: return null) ?: return null
    val done = header.groupValues[1].toInt()
    val total = header.groupValues[2].toInt()
    if (total !in 1..64 || lines.size != total + 1) return null
    val items = lines.drop(1).map { line ->
        val row = TODO_ITEM.matchEntire(line) ?: return null
        val status = when (row.groupValues[1]) {
            "x" -> SessionTodoStatus.Completed
            "~" -> SessionTodoStatus.InProgress
            else -> SessionTodoStatus.Pending
        }
        val content = row.groupValues[2].takeIf { it.isNotBlank() } ?: return null
        SessionTodo(content, status)
    }
    return items.takeIf { it.count { row -> row.status == SessionTodoStatus.Completed } == done }
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
