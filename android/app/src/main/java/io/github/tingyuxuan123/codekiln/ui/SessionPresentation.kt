package io.github.tingyuxuan123.codekiln.ui

import io.github.tingyuxuan123.codekiln.pair.SessionMessage
import io.github.tingyuxuan123.codekiln.pair.SessionTodo
import io.github.tingyuxuan123.codekiln.pair.SessionTodoStatus
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
    /** 注入的委派信封：只保留来源、状态与正文，原始 XML 与 id 不进渲染层。 */
    data class Delegation(
        val kind: SessionDelegationKind,
        val from: String,
        val status: String?,
        val text: String,
        val context: String? = null,
    ) : SessionBlock
    /** 例行任务信封：桌面 InjectedMessageCard 的 routine，只留标题与 prompt。 */
    data class Routine(val title: String, val dryRun: Boolean, val prompt: String) : SessionBlock
    /** 群消息补投信封：逐条紧凑行，另带尾部的真实指令。 */
    data class GroupMessages(val entries: List<GroupEntry>, val instruction: String?) : SessionBlock
}

internal data class GroupEntry(val from: String, val text: String)

internal enum class SessionDelegationKind { Task, Result }

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
                "text" -> part["text"].text()?.takeIf { it.isNotEmpty() }?.let { builder.userText(it) }
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

private val ENTITIES = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'")
private val ENTITY = Regex("&(amp|lt|gt|quot|apos);")
private val ATTRIBUTE = Regex("""\s+([\w-]+)="([^"]*)"""")
private val ENVELOPE_HEAD = Regex("""^<(routine|delegation-task|delegation-result)(\s[^>]*)?>""")
private val BATCH_HEAD = Regex("""^<delegation-results(\s[^>]*)?>""")
private const val BATCH_CLOSE = "</delegation-results>"
private val RESULT_HEAD = Regex("""^<delegation-result(\s[^>]*)?>""")
private const val RESULT_CLOSE = "</delegation-result>"
private val NOTES_PREFIX = Regex("""^\s*<notes-updated>[\s\S]*?</notes-updated>\s*""")
private val PREVIOUS_RUNS = Regex("""\s*<previous-runs>[\s\S]*</previous-runs>$""")
private val ACCEPTANCE_CHECK = Regex("""\s*<acceptance-check>[\s\S]*</acceptance-check>$""")
private val CONTEXT = Regex("""\s*<context>([\s\S]*)</context>$""")
private val CONTEXT_MARKER = Regex("</?context>")
private val DRY_RUN_PREFIX = Regex("""^\[Dry run\][^\n]*\n*""")
private val GROUP_INFO = Regex("""^<group-info>[\s\S]*?</group-info>\s*""")
private val GROUP_STATE = Regex("""^<group-state>[\s\S]*?</group-state>\s*""")
private val GROUP_OMITTED = Regex("""^（省略了 \d+ 条更早的消息）\s*""")
private val GROUP_MESSAGE = Regex("""^<group-message([^>]*)>([\s\S]*?)</group-message>\s*""")
private val ROUTING_NOTE = Regex("""\n?<routing-note>([\s\S]*?)</routing-note>\s*$""")
/** 桌面允许「前置信封 + 换行后的群消息补投」这一种续接，其它尾部正文不折叠。 */
private val GROUP_TAIL = Regex("""\n(?=<group-info>|<group-state>|<group-message |（省略了 )""")

/** 与桌面 parseBotInjectedMessage 一致：只解这些实体，一次替换，不做二次解码。 */
private fun decode(text: String) = ENTITY.replace(text) { ENTITIES.getValue(it.groupValues[1]) }

/** 只接受 key="value" 形式的完整属性串，其它写法一律当作坏信封。 */
private fun attributes(text: String): Map<String, String>? {
    val result = mutableMapOf<String, String>()
    val rest = ATTRIBUTE.replace(text) { match ->
        result[match.groupValues[1]] = decode(match.groupValues[2])
        ""
    }
    return result.takeIf { rest.isBlank() }
}

/** 一条 <delegation-result>，允许后面还有批量信封的兄弟节点；返回折叠块与已消费长度。 */
private fun readResult(source: String): Pair<SessionBlock.Delegation, Int>? {
    val head = RESULT_HEAD.find(source) ?: return null
    val end = source.indexOf(RESULT_CLOSE, head.range.last + 1)
    if (end < 0) return null
    val attrs = attributes(head.groupValues[1]) ?: return null
    val from = attrs["from"]?.takeIf { it.isNotBlank() } ?: return null
    val body = source.substring(head.range.last + 1, end).trim()
    return SessionBlock.Delegation(SessionDelegationKind.Result, from, attrs["status"], decode(body)) to
        (end + RESULT_CLOSE.length)
}

/** 一批 <delegation-results> 只在里面全是合法 delegation-result 时才识别。 */
private fun readBatch(source: String): List<SessionBlock>? {
    val head = BATCH_HEAD.find(source) ?: return null
    if (!source.endsWith(BATCH_CLOSE) || source.length - BATCH_CLOSE.length < head.range.last + 1) return null
    attributes(head.groupValues[1]) ?: return null
    var rest = source.substring(head.range.last + 1, source.length - BATCH_CLOSE.length).trim()
    val items = mutableListOf<SessionBlock>()
    while (rest.isNotEmpty()) {
        val (item, consumed) = readResult(rest) ?: return null
        items += item
        rest = rest.substring(consumed).trim()
    }
    return items.takeIf { it.isNotEmpty() }
}

/** 单条信封必须是整段文本：桌面 parseBotInjectedMessage 同样要求整段匹配。 */
private fun readSingleEnvelope(source: String): List<SessionBlock>? {
    val head = ENVELOPE_HEAD.find(source) ?: return null
    val tag = head.groupValues[1]
    val close = "</$tag>"
    if (!source.endsWith(close)) return null
    val end = source.length - close.length
    if (end < head.range.last + 1) return null
    val attrs = attributes(head.groupValues[2]) ?: return null
    val body = source.substring(head.range.last + 1, end).trim()
    val from = attrs["from"]?.takeIf { it.isNotBlank() }
    return when (tag) {
        "routine" -> {
            val title = attrs["title"]?.takeIf { it.isNotBlank() } ?: return null
            val dryRun = attrs["dry-run"] == "true"
            listOf(SessionBlock.Routine(title, dryRun, decode(if (dryRun) body.replace(DRY_RUN_PREFIX, "") else body)))
        }
        "delegation-result" -> listOf(SessionBlock.Delegation(SessionDelegationKind.Result, from ?: return null,
            attrs["status"], decode(body)))
        else -> {
            // 尾部的历次执行摘要与验收条件是给成员看的说明，不进正文
            val task = body.replace(PREVIOUS_RUNS, "").replace(ACCEPTANCE_CHECK, "")
            val context = CONTEXT.find(task)
            if (context == null && CONTEXT_MARKER.containsMatchIn(task)) return null
            listOf(SessionBlock.Delegation(SessionDelegationKind.Task, from ?: return null, attrs["status"],
                decode((context?.let { task.substring(0, it.range.first) } ?: task).trim()),
                context?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }?.let(::decode)))
        }
    }
}

/** 群消息补投：group-info / group-state 只作为上下文隐藏，逐条 group-message 折成紧凑行。 */
private fun readGroupMessages(source: String): List<SessionBlock>? {
    if (!source.startsWith("<group-info>") && !source.startsWith("<group-state>") &&
        !source.startsWith("<group-message ") && GROUP_OMITTED.find(source) == null) return null
    var rest = GROUP_INFO.replace(source, "")
    rest = GROUP_STATE.replace(rest, "")
    val omitted = GROUP_OMITTED.find(rest)?.value?.trim()
    rest = GROUP_OMITTED.replace(rest, "")
    val entries = mutableListOf<GroupEntry>()
    while (rest.startsWith("<group-message ")) {
        val match = GROUP_MESSAGE.find(rest) ?: return null
        val attrs = attributes(match.groupValues[1]) ?: return null
        val from = attrs["from"]?.takeIf { it.isNotBlank() } ?: return null
        entries += GroupEntry(from, decode(match.groupValues[2].trim()))
        rest = rest.substring(match.range.last + 1)
    }
    if (entries.isEmpty()) return null
    ROUTING_NOTE.find(rest)?.let { rest = rest.substring(0, it.range.first) }
    val instruction = listOfNotNull(omitted, rest.trim().takeIf { it.isNotEmpty() })
        .joinToString("\n").let(::decode).takeIf { it.isNotEmpty() }
    return listOf(SessionBlock.GroupMessages(entries, instruction))
}

private fun wholeInjected(source: String): List<SessionBlock>? =
    readGroupMessages(source) ?: readBatch(source) ?: readSingleEnvelope(source)

/**
 * 与桌面 parseBotInjectedMessage 的语义一致：只折叠整段注入，或「前置信封 + 群消息补投」。
 * 其余（信封后接正文、Markdown 包裹、代码块、非开头标签、坏信封）一律回退原文，不吞内容。
 */
private fun injectedBody(source: String): List<SessionBlock>? {
    wholeInjected(source)?.let { return it }
    for (split in GROUP_TAIL.findAll(source)) {
        val lead = wholeInjected(source.substring(0, split.range.first).trim()) ?: continue
        if (lead.any { it is SessionBlock.GroupMessages }) continue
        val tail = wholeInjected(source.substring(split.range.first).trim()) ?: continue
        if (tail.none { it is SessionBlock.GroupMessages }) continue
        return lead + tail
    }
    return null
}

/** 群聊等直接渲染原始文本的位置：识别不出注入信封时返回 null，调用方按原样渲染。 */
internal fun sessionMessageBlocks(text: String): List<SessionBlock>? {
    val source = text.trim()
    if (source.isEmpty()) return null
    // 桌面在识别前先跳过 Main 追加的笔记块；只有后面真的能折成注入块时才跳过，避免吞掉真实内容。
    val withoutNotes = NOTES_PREFIX.replace(source, "").trim()
    if (withoutNotes != source && withoutNotes.isNotEmpty()) injectedBody(withoutNotes)?.let { return it }
    return injectedBody(source)
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
    /** 私聊用户消息：整段注入信封折成块，其它情况（含信封后接正文）原样作为正文。 */
    fun userText(text: String) {
        val injected = sessionMessageBlocks(text) ?: return prose(text)
        blocks.addAll(injected)
    }
    fun step(value: SessionStep) {
        val previous = blocks.lastOrNull() as? SessionBlock.Steps
        if (previous == null) blocks.add(SessionBlock.Steps(listOf(value)))
        else blocks[blocks.lastIndex] = SessionBlock.Steps(previous.steps + value)
    }
    fun build() = SessionTurn(index, user, timestamp, blocks.toList())
}

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
