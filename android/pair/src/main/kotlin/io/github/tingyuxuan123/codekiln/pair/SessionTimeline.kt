package io.github.tingyuxuan123.eaves.pair

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class SessionTimeline(
    val sessionId: String,
    val cursor: JsonObject? = null,
    val baseIndex: Long = 0,
    val messages: List<SessionMessage> = emptyList(),
    val status: String? = null,
    val error: String? = null,
    val approvals: List<SessionApproval> = emptyList(),
    val asks: List<SessionAsk> = emptyList(),
    val subagents: List<SessionSubagent> = emptyList(),
    val backgroundTasks: List<SessionBackgroundTask> = emptyList(),
)

/** Coarse subagent projection: enough to show progress and stop it, never the full transcript. */
data class SessionSubagent(
    val id: String,
    val description: String,
    val status: String,
    val steps: Long,
    val currentActivity: String,
    val agentType: String? = null,
    val modelId: String? = null,
    val resultText: String? = null,
    val startedAt: Long? = null,
)

data class SessionBackgroundTask(
    val taskId: String,
    val command: String,
    val status: String,
    val tail: String,
    val startedAt: Long? = null,
    val exitCode: Long? = null,
)

data class SessionMessage(
    val index: Long,
    val role: String,
    val content: List<JsonObject>,
    val timestamp: Long? = null,
    val toolCallId: String? = null,
    val toolName: String? = null,
    /** Null means no usable metadata; an empty list is an explicit checklist clear. */
    val todos: List<SessionTodo>? = null,
    val isError: Boolean = false,
)

data class SessionTodo(val content: String, val status: SessionTodoStatus)

enum class SessionTodoStatus { Pending, InProgress, Completed }

data class SessionApproval(
    val requestId: String,
    val tool: String,
    val kind: String,
    val summary: String,
    val toolCallId: String? = null,
    val reviewing: Boolean = false,
    val protected: Boolean = false,
    val expiresAt: Long? = null,
)

data class SessionAsk(
    val requestId: String,
    val question: String,
    val options: List<String> = emptyList(),
    val selectionOnly: Boolean = false,
    val expiresAt: Long? = null,
)

/** Pure projection of authenticated host frames. The caller owns request correlation and resubscription. */
object SessionTimelineReducer {
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    private const val MAX_TOKEN_CHARS = 512
    private const val MAX_TEXT_CHARS = 256_000
    private const val MAX_REPLAY_EVENTS = 512 // PairReplayLog's host-side limit.
    private const val MAX_MESSAGES = 1_000
    private const val MAX_PAGE_MESSAGES = 2 * MAX_MESSAGES
    private const val MAX_CONTENT_WEIGHT = 4_000_000
    private const val CONTENT_NODE_WEIGHT = 32 // Structural charge, separate from text weight.
    private const val MAX_TODOS = 64
    private const val MAX_TODO_CHARS = 4_096
    private const val MAX_JSON_DEPTH = 128 // Match WireJson's input nesting limit.
    private const val MAX_PENDING_REQUESTS = 128
    private const val MAX_PENDING_TEXT = 1_000_000
    private const val MAX_ASK_OPTIONS = 128
    private const val MAX_SUBAGENTS = 32
    private const val MAX_TASKS = 32
    private const val MAX_TASK_ID = 512
    private const val MAX_TASK_TEXT = 4_096
    private const val MAX_TASK_TAIL = 8_192
    private const val MAX_AGENT_RESULT = 32_768
    private val AGENT_STATUSES = setOf("running", "done", "failed")
    private val TASK_STATUSES = setOf("running", "done", "failed")

    /** An invalid snapshot or replay never partially changes the prior timeline. */
    fun sync(previous: SessionTimeline, frame: JsonObject): SessionTimeline? {
        if (frame["sessionId"].token() != previous.sessionId) return null
        if ((frame["events"] as? JsonArray)?.size?.let { it > MAX_REPLAY_EVENTS } == true) return null
        if (SessionSync.parse(frame) == null) return null
        val cursor = readCursor(frame["cursor"]) ?: return null
        return when (frame["mode"].text()) {
            "snapshot" -> {
                val snapshot = frame["snapshot"] as? JsonObject ?: return null
                val session = (snapshot["sessions"] as? JsonArray)?.singleOrNull() as? JsonObject ?: return null
                readSnapshot(previous.sessionId, session)?.copy(cursor = cursor.raw)
            }
            "replay" -> {
                val current = readCursor(previous.cursor) ?: return null
                if (current.epoch != cursor.epoch || current.seq != frame["fromSeq"].sequence()) return null
                val events = frame["events"] as? JsonArray ?: return null
                var result = previous
                for (value in events) {
                    val body = value as? JsonObject ?: return null
                    val type = eventType(body, previous.sessionId) ?: return null
                    result = reduce(result, type, body) ?: return null
                }
                result.copy(cursor = cursor.raw)
            }
            else -> null
        }
    }

    /** Null requests a resubscribe; stale/duplicate frames return [previous] by reference. */
    fun event(previous: SessionTimeline, frame: JsonObject): SessionTimeline? {
        if (frame["type"].text() != "agent-event") return null
        val body = frame["event"] as? JsonObject ?: return null
        val type = eventType(body, previous.sessionId) ?: return null
        val current = readCursor(previous.cursor) ?: return null
        val incoming = readCursor(frame["cursor"]) ?: return null
        if (incoming.epoch != current.epoch) return null
        if (incoming.seq <= current.seq) return previous
        if (incoming.seq != current.seq + 1) return null
        // event.seq belongs to the worker, not the Pair replay log.
        return reduce(previous, type, body)?.copy(cursor = incoming.raw)
    }

    /** History has no cursor and may be older than concurrent live writes. Only prepend its prefix. */
    fun history(previous: SessionTimeline, frame: JsonObject): SessionTimeline? {
        if (frame["type"].text() != "history" || frame["sessionId"].token() != previous.sessionId ||
            readCursor(previous.cursor) == null) return null
        val base = frame["baseIndex"].sequence() ?: return null
        val page = readMessages(frame["messages"], base) ?: return null
        if (page.isEmpty() || base >= previous.baseIndex) return previous
        val prefixSize = previous.baseIndex - base
        // A page not reaching the retained window could belong to the pre-truncation timeline.
        if (prefixSize > page.size) return null
        return withMessages(previous, page.take(prefixSize.toInt()) + previous.messages, base)
    }

    private fun readSnapshot(sessionId: String, session: JsonObject): SessionTimeline? {
        val base = session["baseIndex"].sequence() ?: return null
        val messages = readMessages(session["messages"], base) ?: return null
        val status = session["status"]?.let { it.token() ?: return null } ?: "idle"
        val error = session["error"]?.let { it.text(MAX_TEXT_CHARS) ?: return null }
        val approvals = readPending(session["pendingApprovals"], ::readApproval, SessionApproval::requestId,
            ::approvalTextSize) ?: return null
        val asks = readPending(session["pendingAsks"], ::readAsk, SessionAsk::requestId, ::askTextSize)
            ?: return null
        val subagents = readTasks(session["subagents"], MAX_SUBAGENTS, ::readSubagent, SessionSubagent::id)
        val backgroundTasks = readTasks(session["backgroundTasks"], MAX_TASKS, ::readBackgroundTask,
            SessionBackgroundTask::taskId)
        return withMessages(SessionTimeline(sessionId, status = status, error = error, approvals = approvals,
            asks = asks, subagents = subagents, backgroundTasks = backgroundTasks), messages, base)
    }

    private fun eventType(body: JsonObject, sessionId: String): String? {
        if (body["sessionId"].token() != sessionId) return null
        val identity = body["identity"]
        if (identity != null && (identity as? JsonObject)?.get("sessionId").token() != sessionId) return null
        return body["type"].token()
    }

    private fun reduce(previous: SessionTimeline, type: String, body: JsonObject): SessionTimeline? {
        return when (type) {
            "message-upsert" -> {
                val index = body["index"].sequence() ?: return null
                // The retained tail window is not a sparse history cache. Only an explicit
                // history response may prepend earlier entries; old live upserts still advance seq.
                if (index < previous.baseIndex) return previous
                val message = readMessage(body["message"], index) ?: return null
                val at = previous.messages.binarySearchBy(index, selector = SessionMessage::index)
                val next = previous.messages.toMutableList()
                if (at < 0) next.add(-at - 1, message) else next[at] = message
                withMessages(previous, next, previous.baseIndex)
            }
            "messages-truncated" -> {
                val length = body["length"].sequence() ?: return null
                val kept = previous.messages.takeWhile { it.index < length }
                // A positive length below our window requires an authoritative new tail snapshot.
                if (length > 0 && kept.isEmpty()) return null
                withMessages(previous, kept, 0)
            }
            "status" -> {
                val status = body["status"].token() ?: return null
                val error = body["error"]?.let { it.text(MAX_TEXT_CHARS) ?: return null }
                previous.copy(status = status, error = error)
            }
            "turn-completed" -> previous.copy(status = "idle", error = null)
            "turn-failed" -> {
                val error = body["error"].text(MAX_TEXT_CHARS)?.takeIf { it.isNotEmpty() } ?: return null
                previous.copy(status = "failed", error = error)
            }
            "approval-request" -> {
                val request = readApproval(body["request"] ?: body) ?: return null
                val approvals = upsertPending(previous.approvals, request, SessionApproval::requestId,
                    ::approvalTextSize) ?: return null
                previous.copy(approvals = approvals)
            }
            "approval-resolved" -> {
                val id = body["requestId"].token() ?: return null
                previous.copy(approvals = previous.approvals.filterNot { it.requestId == id })
            }
            "ask-request" -> {
                val ask = readAsk(body["ask"] ?: body) ?: return null
                val asks = upsertPending(previous.asks, ask, SessionAsk::requestId, ::askTextSize) ?: return null
                previous.copy(asks = asks)
            }
            "ask-resolved" -> {
                val id = body["requestId"].token() ?: return null
                previous.copy(asks = previous.asks.filterNot { it.requestId == id })
            }
            "subagent-update" -> {
                val agent = readSubagent(body["agent"]) ?: return previous
                previous.copy(subagents = upsertTask(previous.subagents, agent, SessionSubagent::id, MAX_SUBAGENTS))
            }
            "task-started" -> {
                val task = body["task"]?.let(::readBackgroundTask) ?: return previous
                previous.copy(backgroundTasks = upsertTask(previous.backgroundTasks, task,
                    SessionBackgroundTask::taskId, MAX_TASKS))
            }
            "task-output" -> {
                val id = body["taskId"].token() ?: return previous
                val status = body["status"].token()?.takeIf { it in TASK_STATUSES } ?: return previous
                val tail = body["tail"].text(MAX_TASK_TAIL) ?: return previous
                previous.copy(backgroundTasks = previous.backgroundTasks.map {
                    if (it.taskId == id) it.copy(status = status, tail = tail) else it
                })
            }
            "task-ended" -> {
                val id = body["taskId"].token() ?: return previous
                val status = body["status"].token()?.takeIf { it in TASK_STATUSES } ?: return previous
                val exitCode = body["exitCode"]?.let { it.number()?.toLong() ?: return previous }
                previous.copy(backgroundTasks = previous.backgroundTasks.map {
                    if (it.taskId == id) it.copy(status = status, exitCode = exitCode) else it
                })
            }
            "background-tasks-level" -> {
                // A malformed level frame is a real resubscribe, not a proven empty list.
                val rows = body["tasks"] as? JsonArray ?: return null
                val tasks = readTasks(rows, MAX_TASKS, ::readBackgroundTask, SessionBackgroundTask::taskId)
                previous.copy(backgroundTasks = tasks)
            }
            "session-invalidated", "worker-exited", "snapshot" -> null
            else -> previous // Unknown scoped events still advance the cursor.
        }
    }

    private fun readMessages(value: JsonElement?, base: Long): List<SessionMessage>? {
        val array = value as? JsonArray ?: return null
        if (array.size > MAX_PAGE_MESSAGES || base + (array.size - 1) > MAX_SAFE_INTEGER) return null
        return array.mapIndexed { offset, message -> readMessage(message, base + offset) ?: return null }
    }

    private fun readMessage(value: JsonElement?, index: Long): SessionMessage? {
        val message = value as? JsonObject ?: return null
        val role = message["role"].token() ?: return null
        val parts = message["content"] as? JsonArray ?: return null
        val contentWeight = jsonWeight(parts, MAX_CONTENT_WEIGHT) ?: return null
        val content = parts.map { (it as? JsonObject)?.takeIf { part -> part["type"].token() != null } ?: return null }
        val timestamp = message["timestamp"]?.let { it.timestamp() ?: return null }
        val toolCallId = message["toolCallId"]?.let { it.text(MAX_TOKEN_CHARS) ?: return null }
        val toolName = message["toolName"]?.let { it.text(MAX_TOKEN_CHARS) ?: return null }
        val isToolResult = role == "toolResult"
        val todos = if (isToolResult && toolName == "todo") {
            // Optional metadata must never make an otherwise valid message exceed its budget.
            readTodos(message["todos"])?.takeIf { todoWeight(it) <= MAX_CONTENT_WEIGHT - contentWeight }
        } else null
        val isError = isToolResult && message["isError"].boolean() == true
        return SessionMessage(index, role, content, timestamp, toolCallId, toolName, todos, isError)
    }

    private fun readTodos(value: JsonElement?): List<SessionTodo>? {
        val rows = value as? JsonArray ?: return null
        if (rows.size > MAX_TODOS) return null
        if (rows.isEmpty()) return emptyList()
        return rows.mapNotNull { row ->
            val item = row as? JsonObject ?: return@mapNotNull null
            val content = item["content"].text(MAX_TODO_CHARS) ?: return@mapNotNull null
            val status = when (item["status"].text()) {
                "pending" -> SessionTodoStatus.Pending
                "in_progress" -> SessionTodoStatus.InProgress
                "completed" -> SessionTodoStatus.Completed
                else -> return@mapNotNull null
            }
            SessionTodo(content, status)
        }.takeIf { it.isNotEmpty() }
    }

    private fun withMessages(previous: SessionTimeline, messages: List<SessionMessage>, emptyBase: Long): SessionTimeline {
        var first = messages.size
        var remaining = MAX_CONTENT_WEIGHT
        while (first > 0 && messages.size - first < MAX_MESSAGES) {
            val message = messages[first - 1]
            val metadataWeight = todoWeight(message.todos)
            val contentWeight = jsonWeight(JsonArray(message.content), remaining - metadataWeight) ?: break
            remaining -= metadataWeight + contentWeight
            first--
        }
        val kept = if (first == 0) messages else messages.subList(first, messages.size).toList()
        val base = kept.firstOrNull()?.index ?: emptyBase
        return if (base == previous.baseIndex && kept == previous.messages) previous
        else previous.copy(baseIndex = base, messages = kept)
    }

    // Empty lists share a singleton; preserve the explicit clear even when content fills the budget.
    private fun todoWeight(todos: List<SessionTodo>?): Int = if (todos.isNullOrEmpty()) 0 else
        CONTENT_NODE_WEIGHT + todos.sumOf { 2 * CONTENT_NODE_WEIGHT + 2 * it.content.length }

    /** Bound large text and many tiny nested objects without reserializing retained content. */
    private fun jsonWeight(value: JsonElement, budget: Int, depth: Int = 0): Int? {
        if (depth >= MAX_JSON_DEPTH || budget < CONTENT_NODE_WEIGHT) return null
        var remaining = budget - CONTENT_NODE_WEIGHT
        when (value) {
            is JsonObject -> for ((key, child) in value) {
                if (key.length > remaining / 2) return null
                remaining -= 2 * key.length
                remaining -= jsonWeight(child, remaining, depth + 1) ?: return null
            }
            is JsonArray -> for (child in value) {
                remaining -= jsonWeight(child, remaining, depth + 1) ?: return null
            }
            is JsonPrimitive -> {
                if (value.content.length > remaining / 2) return null
                remaining -= 2 * value.content.length
            }
        }
        return budget - remaining
    }

    private fun readApproval(value: JsonElement): SessionApproval? {
        val request = value as? JsonObject ?: return null
        val id = request["requestId"].token() ?: return null
        val tool = request["tool"].token() ?: return null
        val kind = request["kind"].token() ?: return null
        val summary = request["summary"].text(MAX_TEXT_CHARS) ?: return null
        val toolCallId = request["toolCallId"]?.let { it.token() ?: return null }
        val phase = request["phase"]?.let { it.text().takeIf { phase -> phase == "reviewing" } ?: return null }
        val protected = request["protected"]?.let { it.token() ?: return null } != null
        val expiresAt = request["expiresAt"]?.let { it.timestamp() ?: return null }
        return SessionApproval(id, tool, kind, summary, toolCallId, phase == "reviewing", protected, expiresAt)
    }

    private fun readAsk(value: JsonElement): SessionAsk? {
        val ask = value as? JsonObject ?: return null
        val id = ask["requestId"].token() ?: return null
        val question = ask["question"].text(MAX_TEXT_CHARS)?.takeIf { it.isNotEmpty() } ?: return null
        val options = ask["options"]?.let { value ->
            val array = value as? JsonArray ?: return null
            if (array.size > MAX_ASK_OPTIONS) return null
            array.map { it.text(MAX_TEXT_CHARS) ?: return null }
        } ?: emptyList()
        val selectionOnly = ask["selectionOnly"]?.let { it.boolean() ?: return null } ?: false
        if (selectionOnly && (question.isBlank() || options.isEmpty() || options.any(String::isBlank) ||
                options.toSet().size != options.size)) return null
        val expiresAt = ask["expiresAt"]?.let { it.timestamp() ?: return null }
        return SessionAsk(id, question, options, selectionOnly, expiresAt)
    }

    private fun approvalTextSize(approval: SessionApproval) = with(approval) {
        requestId.length + tool.length + kind.length + summary.length + (toolCallId?.length ?: 0)
    }

    private fun readSubagent(value: JsonElement?): SessionSubagent? {
        val agent = value as? JsonObject ?: return null
        val id = agent["id"].token()?.takeIf { it.length <= MAX_TASK_ID } ?: return null
        val description = agent["description"].text(MAX_TASK_TEXT) ?: return null
        val status = agent["status"].token()?.takeIf { it in AGENT_STATUSES } ?: return null
        val steps = agent["steps"].sequence() ?: return null
        val activity = agent["currentActivity"].text(MAX_TASK_TEXT) ?: return null
        val agentType = agent["agentType"]?.let { it.token() ?: return null }
        val modelId = agent["modelId"]?.let { it.token() ?: return null }
        // The final report is markdown; it is bounded here so one agent cannot fill the phone state.
        val resultText = agent["resultText"]?.let { it.text(MAX_AGENT_RESULT) ?: return null }
        val startedAt = agent["startedAt"]?.let { it.timestamp() ?: return null }
        return SessionSubagent(id, description, status, steps, activity, agentType, modelId, resultText, startedAt)
    }

    private fun readBackgroundTask(value: JsonElement): SessionBackgroundTask? {
        val task = value as? JsonObject ?: return null
        val id = task["taskId"].token()?.takeIf { it.length <= MAX_TASK_ID } ?: return null
        val command = task["command"].text(MAX_TASK_TEXT) ?: return null
        val status = task["status"].token()?.takeIf { it in TASK_STATUSES } ?: return null
        val tail = task["tail"].text(MAX_TASK_TAIL) ?: return null
        val startedAt = task["startedAt"]?.let { it.timestamp() ?: return null }
        val exitCode = task["exitCode"]?.let { it.number()?.toLong() ?: return null }
        return SessionBackgroundTask(id, command, status, tail, startedAt, exitCode)
    }

    private fun <T> readTasks(value: JsonElement?, limit: Int, read: (JsonElement) -> T?, id: (T) -> String): List<T> {
        val array = value as? JsonArray ?: return emptyList()
        val seen = mutableMapOf<String, T>()
        for (row in array) {
            val parsed = read(row) ?: continue
            seen[id(parsed)] = parsed
        }
        return seen.values.toList().takeLast(limit)
    }

    private fun <T> upsertTask(rows: List<T>, row: T, id: (T) -> String, limit: Int): List<T> {
        val key = id(row)
        val index = rows.indexOfFirst { id(it) == key }
        val next = if (index < 0) rows + row else rows.toMutableList().also { it[index] = row }
        return if (next.size > limit) next.takeLast(limit) else next
    }

    private fun askTextSize(ask: SessionAsk) = with(ask) {
        requestId.length + question.length + options.sumOf(String::length)
    }

    private fun <T> readPending(value: JsonElement?, parse: (JsonElement) -> T?, id: (T) -> String,
                                textSize: (T) -> Int): List<T>? {
        if (value == null) return emptyList()
        val array = value as? JsonArray ?: return null
        if (array.size > MAX_PENDING_REQUESTS) return null
        val items = linkedMapOf<String, T>()
        for (entry in array) {
            val item = parse(entry) ?: return null
            if (items.put(id(item), item) != null) return null
        }
        return items.values.toList().takeIf { withinPendingBudget(it, textSize) }
    }

    private fun <T> upsertPending(previous: List<T>, item: T, id: (T) -> String,
                                  textSize: (T) -> Int): List<T>? {
        val at = previous.indexOfFirst { id(it) == id(item) }
        val next = if (at < 0) previous + item else previous.toMutableList().also { it[at] = item }
        return next.takeIf { withinPendingBudget(it, textSize) }
    }

    private fun <T> withinPendingBudget(items: List<T>, textSize: (T) -> Int): Boolean {
        if (items.size > MAX_PENDING_REQUESTS) return false
        var remaining = MAX_PENDING_TEXT
        for (item in items) {
            remaining -= textSize(item)
            if (remaining < 0) return false // Never silently discard pending safety decisions.
        }
        return true
    }

    private data class Cursor(val raw: JsonObject, val epoch: String, val seq: Long)

    private fun readCursor(value: JsonElement?): Cursor? {
        val raw = value as? JsonObject ?: return null
        if (!SessionSync.isCursor(raw)) return null
        return Cursor(raw, raw["epoch"].token() ?: return null, raw["seq"].sequence() ?: return null)
    }

    private fun JsonElement?.text(max: Int = MAX_TOKEN_CHARS): String? =
        (this as? JsonPrimitive)?.takeIf { it.isString && it.content.length <= max }?.content

    private fun JsonElement?.token(): String? = text()?.takeIf { it.isNotEmpty() }

    private fun JsonElement?.boolean(): Boolean? = when ((this as? JsonPrimitive)?.takeUnless { it.isString }?.content) {
        "true" -> true
        "false" -> false
        else -> null
    }

    private fun JsonElement?.number(): Double? =
        (this as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toDoubleOrNull()

    private fun JsonElement?.sequence(): Long? {
        val number = number() ?: return null
        if (number !in 0.0..MAX_SAFE_INTEGER.toDouble() || number.toLong().toDouble() != number) return null
        return number.toLong()
    }

    private fun JsonElement?.timestamp(): Long? = number()
        ?.takeIf { it in -MAX_SAFE_INTEGER.toDouble()..MAX_SAFE_INTEGER.toDouble() }?.toLong()
}
