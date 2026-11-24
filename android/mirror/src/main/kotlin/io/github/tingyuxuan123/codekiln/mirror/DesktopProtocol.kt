package io.github.tingyuxuan123.codekiln.mirror

import io.github.tingyuxuan123.codekiln.pair.SessionTimeline
import java.util.Collections
import java.util.Base64
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.roundToLong

enum class LinkPhase { Inactive, Connecting, AwaitingHost, Authenticating, Online, Offline, Replaced, Revoked, Failed }

data class DesktopTask(
    val id: String,
    val title: String,
    val projectName: String,
    val updatedAt: Long? = null,
    val status: String,
    val pendingApprovalCount: Int = 0,
    val pendingAskCount: Int = 0,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val projectId: String? = null,
    val providerId: String? = null,
    val modelId: String? = null,
    val parentId: String? = null,
    val reasoningEnabled: Boolean? = null,
    val thinkingLevel: TaskThinkingLevel? = null,
)

data class DesktopProject(val id: String, val name: String)
data class DesktopProvider(val id: String, val name: String, val models: List<DesktopModel>)
data class DesktopModel(val id: String, val label: String)

data class TaskLaunch(
    val projectId: String,
    val providerId: String,
    val modelId: String,
    val approvalMode: TaskApprovalMode,
    val thinkingLevel: TaskThinkingLevel?,
    val text: String,
)

enum class TaskApprovalMode(internal val wire: String) {
    Supervised("supervised"), AutoEdits("auto-edits"), Full("full"), Assistant("assistant"),
}

enum class TaskThinkingLevel(internal val wire: String) {
    Minimal("minimal"), Low("low"), Medium("medium"), High("high"), XHigh("xhigh"), Max("max"),
}

data class DesktopCreation(val sessionId: String?, val phase: CreationPhase)
enum class CreationPhase { Creating, Created, Unconfirmed, Rejected, Unavailable }

data class DesktopLinkState(
    val phase: LinkPhase = LinkPhase.Inactive,
    val hostName: String? = null,
    val catalog: List<DesktopTask> = emptyList(),
    val rttMillis: Long? = null,
    val session: DesktopSessionState? = null,
    val readOnly: Boolean = true,
    val projects: List<DesktopProject>? = null,
    val providers: List<DesktopProvider>? = null,
    val creation: DesktopCreation? = null,
    val catalogReady: Boolean = false,
    val sessionImages: Boolean = false,
)

data class DesktopSessionState(
    val timeline: SessionTimeline,
    val loading: Boolean = true,
    val error: Boolean = false,
    val loadingHistory: Boolean = false,
    val hasMoreHistory: Boolean = true,
    val pendingResponses: Set<String> = emptySet(),
    val responseFailed: Boolean = false,
    val historyLimitReached: Boolean = false,
    val textAttempt: SessionTextAttempt? = null,
    val stopPhase: SessionCommandPhase? = null,
    val queued: List<DesktopQueuedMessage> = emptyList(),
    val queueAttempt: DesktopQueueAttempt? = null,
    val queueReady: Boolean = false,
    val goal: DesktopGoal? = null,
    val goalReady: Boolean = false,
    val goalAttempt: DesktopGoalAttempt? = null,
    val context: DesktopContextUsage? = null,
    val usage: DesktopUsageTotals? = null,
    val maintenance: DesktopMaintenanceAttempt? = null,
    val compaction: DesktopCompaction? = null,
    val rewind: DesktopRewindAttempt? = null,
    val taskStop: DesktopTaskStopAttempt? = null,
    val files: DesktopFilesState? = null,
    val preview: DesktopPreviewState? = null,
    val modelAttempt: DesktopModelAttempt? = null,
    val modelReady: Boolean = false,
    val thinkingAttempt: DesktopThinkingAttempt? = null,
) {
    val running get() = timeline.status == "running"
    val canPrompt get() = timeline.status in setOf("idle", "failed", "error")
}

enum class SessionCommandPhase { Waiting, Observed, Unconfirmed, Rejected }
data class DesktopModelAttempt(val id: Long, val providerId: String, val modelId: String, val phase: SessionCommandPhase)
data class DesktopThinkingAttempt(val id: Long, val enabled: Boolean?, val level: TaskThinkingLevel?, val phase: SessionCommandPhase)
data class SessionTextAttempt(
    val id: Long,
    val text: String,
    val phase: SessionCommandPhase,
    val imageFingerprints: List<String> = emptyList(),
)

enum class QueueCommand(internal val wire: String) {
    Enqueue("enqueue"), Update("queue-update"), Remove("queue-remove"),
    SendNow("queue-send-now"), InterruptSend("queue-interrupt-send"),
}

data class DesktopQueuedMessage(val id: String, val text: String, val hasImages: Boolean = false)
data class DesktopQueueAttempt(val id: Long, val command: QueueCommand, val messageId: String?,
    val text: String?, val phase: SessionCommandPhase)

enum class GoalCommand(internal val wire: String) {
    Set("goal-set"), Pause("goal-pause"), Resume("goal-resume"), Clear("goal-clear");

    internal val startsWork get() = this == Set || this == Resume
}
data class DesktopGoal(val text: String, val status: String, val autoTurns: Long, val note: String? = null)
data class DesktopGoalAttempt(val id: Long, val command: GoalCommand, val text: String?, val phase: SessionCommandPhase)

/** Desktop only sends a window it actually knows; `used` alone is a valid, window-less occupancy. */
data class DesktopContextUsage(val used: Long, val window: Long? = null)
data class DesktopUsageTotals(val inputTokens: Long, val outputTokens: Long, val cacheHitPercent: Long? = null)

enum class SessionMaintenanceCommand(internal val wire: String) { Retry("retry"), Compact("compact") }

data class DesktopMaintenanceAttempt(val id: Long, val command: SessionMaintenanceCommand, val text: String?,
    val phase: SessionCommandPhase)

/** Compaction progress; `state` is only ever queued/start/end. */
data class DesktopCompaction(val state: String, val error: String? = null)

/** A rewind keeps the restored draft and the deferred file-restore receipt; no image bytes are retained. */
data class DesktopRewindAttempt(
    val id: Long,
    val userIndexFromEnd: Long,
    val restoreFiles: Boolean,
    val phase: SessionCommandPhase,
    val editorText: String? = null,
    val editorImageCount: Int = 0,
    val filesRestored: Boolean? = null,
)

/** What a maintenance write must present so a stale screen can never resend after the state moved. */
data class MaintenanceBaseline(val epoch: String, val maintenanceId: Long?, val compaction: DesktopCompaction?)

/** The exact baseline of the current projection; callers never parse cursors themselves. */
val DesktopSessionState.maintenanceBaseline: MaintenanceBaseline?
    get() {
        val epoch = timeline.cursor?.get("epoch").linkString() ?: return null
        return MaintenanceBaseline(epoch, maintenance?.id, compaction)
    }

/** What a rewind write must present so an old screen can never resend after the timeline or attempt moved. */
data class RewindBaseline(val epoch: String, val rewindId: Long?)

/** The exact rewind baseline of the current projection; a missing epoch means no baseline at all. */
val DesktopSessionState.rewindBaseline: RewindBaseline?
    get() {
        val epoch = timeline.cursor?.get("epoch").linkString() ?: return null
        return RewindBaseline(epoch, rewind?.id)
    }

/** Which desktop write stops one running background task or subagent. */
enum class SessionTaskKind(internal val wire: String) {
    Background("task-stop"), Subagent("subagent-stop");

    /** pairPolicy names the stopped id differently per command. */
    internal val idField: String get() = if (this == Background) "taskId" else "agentId"
}

/** What a task stop must present so a stale screen can never stop a task that already moved. */
data class TaskStopBaseline(val epoch: String, val attemptId: Long?, val runningIds: List<String>)

/** The exact running set of this projection; a missing epoch means no baseline at all. */
fun DesktopSessionState.taskStopBaseline(kind: SessionTaskKind): TaskStopBaseline? {
    val epoch = timeline.cursor?.get("epoch").linkString() ?: return null
    val runningIds = when (kind) {
        SessionTaskKind.Background -> timeline.backgroundTasks.filter { it.status == "running" }.map { it.taskId }
        SessionTaskKind.Subagent -> timeline.subagents.filter { it.status == "running" }.map { it.id }
    }
    return TaskStopBaseline(epoch, taskStop?.id, runningIds)
}

/** A task stop is only ever observed as "the desktop no longer reports this id running". */
data class DesktopTaskStopAttempt(
    val id: Long,
    val kind: SessionTaskKind,
    val targetId: String,
    val phase: SessionCommandPhase,
)

// Even a string of escaped control characters stays far below the relay's 1 MB cap.
const val SESSION_TEXT_LIMIT = 32_000

/** The desktop's own block size; a decoded payload never exceeds it. */
const val FILE_CHUNK_BYTES = 384 * 1024

/** Upper bound on one listing; a larger table is not a valid answer. */
internal const val FILE_ENTRY_LIMIT = 4_096

/** Opaque artifact ids and file names share the desktop's 512 UTF-16 code-unit bound. */
internal const val FILE_TEXT_LIMIT = 512

/** Display-only relative paths are longer but still bounded. */
internal const val FILE_REL_LIMIT = 4_096

/** One listed artifact. `rel` is display-only and never accepted back in a request. */
data class DesktopFileEntry(val id: String, val name: String, val size: Long, val rel: String)

/** The most recent successfully decoded block; bytes stay in memory and never enter a log. */
data class DesktopFileChunk(
    val fileId: String,
    val name: String?,
    val size: Long,
    val offset: Long,
    val data: ByteArray,
    val error: String? = null,
) {
    override fun toString(): String =
        "DesktopFileChunk(fileId=$fileId, name=$name, size=$size, offset=$offset, " +
            "data=<${data.size} bytes>, error=$error)"
}

/** Listing and the single in-flight read of the selected session's artifacts. */
data class DesktopFilesState(
    val listing: Boolean = false,
    val listError: String? = null,
    val entries: List<DesktopFileEntry> = emptyList(),
    val reading: Boolean = false,
    val readingFileId: String? = null,
    val readOffset: Long = 0,
    val readError: String? = null,
    val chunk: DesktopFileChunk? = null,
)

/** Background task and subagent ids share the desktop's 512 UTF-16 code-unit bound. */
const val SESSION_TASK_ID_LIMIT = 512

/** Desktop rejects longer compact instructions before they reach the worker. */
const val COMPACTION_INSTRUCTIONS_LIMIT = 8_000

/** Desktop normalizes goals with ECMAScript String.trim, not Kotlin's broader whitespace predicate. */
fun sessionGoalText(text: String): String? =
    text.takeIf { it.length in 1..SESSION_TEXT_LIMIT }?.let(::jsTrimText)

/** Compact instructions are trimmed by the desktop as well; blank input must never be sent as "no instructions". */
fun compactionInstructions(text: String): String? = jsTrimText(text)
    ?.takeIf { it.length <= COMPACTION_INSTRUCTIONS_LIMIT }

private fun jsTrimText(text: String): String? =
    text.trim { it in '\u0009'..'\u000D' || it in '\u2000'..'\u200A' || when (it) {
        ' ', '\u00A0', '\u1680', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF' -> true
        else -> false
    } }.takeIf { it.isNotEmpty() }

internal fun JsonElement?.linkString(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun JsonElement?.linkIndex(): Long? {
    val number = (this as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toDoubleOrNull() ?: return null
    if (number !in 0.0..9_007_199_254_740_991.0 || number.toLong().toDouble() != number) return null
    return number.toLong()
}

internal sealed interface DesktopRead {
    enum class Kind { Host, Catalog, Projects, Providers }
    val kind: Kind

    data class Host(val name: String?, val readOnly: Boolean, val sessionImages: Boolean = false) : DesktopRead {
        override val kind = Kind.Host
    }
    // Only chat-bearing rows belong here. A null queue is malformed; a null goal is known absent.
    // Malformed goals are omitted from the map just like missing/slim rows. Occupancy and totals
    // are display-only: a valid full row without the key proves the desktop has nothing to show.
    data class Catalog(val tasks: List<DesktopTask>, val queues: Map<String, List<DesktopQueuedMessage>?>,
        val goals: Map<String, DesktopGoal?>, val contexts: Map<String, DesktopContextUsage?>,
        val usages: Map<String, DesktopUsageTotals?>, val modelTargets: Set<String>) : DesktopRead {
        override val kind = Kind.Catalog
    }
    data object InvalidCatalog : DesktopRead { override val kind = Kind.Catalog }
    data class Projects(val projects: List<DesktopProject>) : DesktopRead { override val kind = Kind.Projects }
    data class Providers(val providers: List<DesktopProvider>) : DesktopRead { override val kind = Kind.Providers }
}

internal fun desktopRead(payload: JsonObject): DesktopRead? = when (payload["type"].linkString()) {
    "host-info" -> DesktopRead.Host(payload["hostname"].linkString()?.takeIf { it.isNotBlank() },
        payload["readOnly"] == JsonPrimitive(true), payload["images"] == JsonPrimitive(true))
    "catalog" -> desktopCatalogRead(payload) ?: DesktopRead.InvalidCatalog
    "projects" -> desktopProjects(payload)?.let(DesktopRead::Projects)
    "providers" -> desktopProviders(payload)?.let(DesktopRead::Providers)
    else -> null
}

private const val MAX_PROJECTS = 4_096
private const val MAX_PROVIDERS = 512
private const val MAX_MODELS_PER_PROVIDER = 2_048
private const val MAX_METADATA_TEXT = 512
private const val MAX_CATALOG_ENTRIES = 4_096
private const val MAX_QUEUE_ITEMS = 128
private val GOAL_STATUSES = setOf("active", "paused", "completed", "blocked", "waiting")
internal val COMPACTION_STATES = setOf("queued", "start", "end")

private fun JsonElement?.metadataString(): String? = linkString()?.takeIf {
    it.length <= MAX_METADATA_TEXT && it.isNotBlank()
}

/** A non-empty, bounded name or id; blank values would name nothing the user can open. */
internal fun desktopFileName(value: JsonElement?, limit: Int = FILE_TEXT_LIMIT): String? =
    value.linkString()?.takeIf { it.length in 1..limit && it.isNotBlank() }

/** @return null when the table itself is unusable; an unreadable row only drops itself. */
internal fun desktopFileEntries(value: JsonElement?): List<DesktopFileEntry>? {
    val rows = value as? JsonArray ?: return null
    if (rows.size > FILE_ENTRY_LIMIT) return null
    val seen = mutableSetOf<String>()
    return Collections.unmodifiableList(rows.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val id = desktopFileName(row["id"]) ?: return@mapNotNull null
        val name = desktopFileName(row["name"]) ?: return@mapNotNull null
        val rel = desktopFileName(row["rel"], FILE_REL_LIMIT) ?: return@mapNotNull null
        val size = row["size"].linkIndex() ?: return@mapNotNull null
        if (!seen.add(id)) return@mapNotNull null
        DesktopFileEntry(id, name, size, rel)
    })
}

/** Standard Base64 only, never longer than one block; an oversized payload is refused undecoded. */
internal fun desktopFileData(value: JsonElement?): ByteArray? {
    val data = value.linkString()?.takeIf { it.length <= FILE_DATA_CHARS } ?: return null
    if (!STANDARD_BASE64.matches(data)) return null
    val bytes = try { Base64.getDecoder().decode(data) } catch (_: IllegalArgumentException) { return null }
    return bytes.takeIf { it.size <= FILE_CHUNK_BYTES }
}

private const val FILE_DATA_CHARS = (FILE_CHUNK_BYTES + 2) / 3 * 4
private val STANDARD_BASE64 = Regex("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$")

/** One preview target the desktop offers for the selected session. */
data class DesktopPreviewEntry(val id: String, val label: String, val kind: String)

/** A rendered page image. The bytes stay in memory and never enter a log. */
data class DesktopPreviewFrame(
    val frameId: String,
    val width: Int,
    val height: Int,
    val dataUrl: String,
    val title: String? = null,
) {
    override fun toString(): String =
        "DesktopPreviewFrame(frameId=$frameId, width=$width, height=$height, " +
            "dataUrl=<${dataUrl.length} chars>, title=$title)"
}

/** One user gesture aimed at the current frame; the desktop owns what it means to the page. */
sealed interface DesktopPreviewInput {
    data class Click(val x: Int, val y: Int) : DesktopPreviewInput
    data class Scroll(val deltaX: Int, val deltaY: Int) : DesktopPreviewInput
    data class Text(val text: String) : DesktopPreviewInput
    data class Key(val key: String) : DesktopPreviewInput
}

/** Which preview operation addresses the established preview instead of a listed entry. */
enum class DesktopPreviewAction { Frame, Refresh, Close }

/** Listing, the single in-flight operation, and the current frame of the selected session. */
data class DesktopPreviewState(
    val listing: Boolean = false,
    val listError: String? = null,
    val entries: List<DesktopPreviewEntry> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
    val previewId: String? = null,
    val frame: DesktopPreviewFrame? = null,
)

/** Upper bound on one listing; a larger table is not a valid answer. */
internal const val PREVIEW_ENTRY_LIMIT = 256

/** Opaque entry, preview and frame ids share the desktop's 512 UTF-16 code-unit bound. */
internal const val PREVIEW_TEXT_LIMIT = 512

/** The viewport the phone may ask the desktop to render. */
internal const val PREVIEW_SIZE_LIMIT = 4_096

/** A rendered frame may be larger than the viewport that was asked for. */
internal const val PREVIEW_FRAME_SIZE_LIMIT = 8_192

/**
 * Decoded image cap. The desktop sends no data URL longer than 700_000 chars (pairPreview.ts),
 * and Base64 makes that 525_000 bytes, just under the relay's 1 MiB frame; a bigger cap only
 * accepted pictures that could never arrive.
 */
internal const val PREVIEW_FRAME_BYTES = 525_000

/** One block of typed text; the desktop applies its own, smaller, limit. */
const val PREVIEW_INPUT_TEXT_LIMIT = 20_000

/** Only these named keys are ever forwarded to a page. */
internal val PREVIEW_KEYS = setOf("Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown",
    "ArrowLeft", "ArrowRight")

/** @return null when the table itself is unusable; an unreadable row only drops itself. */
internal fun desktopPreviewEntries(value: JsonElement?): List<DesktopPreviewEntry>? {
    val rows = value as? JsonArray ?: return null
    if (rows.size > PREVIEW_ENTRY_LIMIT) return null
    val seen = mutableSetOf<String>()
    return Collections.unmodifiableList(rows.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val id = desktopFileName(row["id"]) ?: return@mapNotNull null
        val label = desktopFileName(row["label"]) ?: return@mapNotNull null
        val kind = row["kind"].linkString()?.takeIf { it in PREVIEW_KINDS } ?: return@mapNotNull null
        if (!seen.add(id)) return@mapNotNull null
        DesktopPreviewEntry(id, label, kind)
    })
}

/** A partial frame would paint a wrong page, so any unusable field invalidates the whole frame. */
internal fun desktopPreviewFrame(value: JsonElement?): DesktopPreviewFrame? {
    val frame = value as? JsonObject ?: return null
    val frameId = desktopFileName(frame["frameId"]) ?: return null
    val width = frame["width"].previewPixels() ?: return null
    val height = frame["height"].previewPixels() ?: return null
    val dataUrl = desktopPreviewDataUrl(frame["dataUrl"]) ?: return null
    // The title is display-only, so an unusable one is dropped instead of failing the frame.
    val title = frame["title"].linkString()?.takeIf { it.length <= PREVIEW_TEXT_LIMIT }
    return DesktopPreviewFrame(frameId, width, height, dataUrl, title)
}

/** Only a bounded standard Base64 PNG or JPEG data URL is a displayable frame. */
internal fun desktopPreviewDataUrl(value: JsonElement?): String? {
    val dataUrl = value.linkString() ?: return null
    val prefix = PREVIEW_DATA_URL_PREFIXES.firstOrNull { dataUrl.startsWith(it) } ?: return null
    val payload = dataUrl.substring(prefix.length)
    // Refuse an oversized payload before allocating its decoded copy.
    if (payload.length > PREVIEW_FRAME_DATA_CHARS || !STANDARD_BASE64.matches(payload)) return null
    val bytes = try { Base64.getDecoder().decode(payload) } catch (_: IllegalArgumentException) { return null }
    return dataUrl.takeIf { bytes.size <= PREVIEW_FRAME_BYTES }
}

private fun JsonElement?.previewPixels(): Int? =
    linkIndex()?.takeIf { it in 1..PREVIEW_FRAME_SIZE_LIMIT }?.toInt()

/** The exact wire form of one gesture; nothing reachable from here can name an unknown key. */
internal fun previewInputJson(input: DesktopPreviewInput, frame: DesktopPreviewFrame?): JsonObject? = when (input) {
    is DesktopPreviewInput.Click -> {
        // The desktop rejects the far edge itself, so the frame bounds stay inclusive here.
        if (frame == null || input.x !in 0..frame.width || input.y !in 0..frame.height) null
        else buildJsonObject { put("kind", "click"); put("x", input.x); put("y", input.y) }
    }
    is DesktopPreviewInput.Scroll -> buildJsonObject {
        put("kind", "scroll"); put("deltaX", input.deltaX); put("deltaY", input.deltaY)
    }
    is DesktopPreviewInput.Text ->
        if (input.text.isEmpty() || input.text.length > PREVIEW_INPUT_TEXT_LIMIT) null
        else buildJsonObject { put("kind", "text"); put("text", input.text) }
    is DesktopPreviewInput.Key ->
        if (input.key !in PREVIEW_KEYS) null
        else buildJsonObject { put("kind", "key"); put("key", input.key) }
}

private val PREVIEW_KINDS = setOf("html", "server")
private val PREVIEW_DATA_URL_PREFIXES = listOf("data:image/png;base64,", "data:image/jpeg;base64,")
private const val PREVIEW_FRAME_DATA_CHARS = (PREVIEW_FRAME_BYTES + 2) / 3 * 4

private fun desktopProjects(payload: JsonObject): List<DesktopProject>? =
    metadataRows(payload["projects"], MAX_PROJECTS) { project, id ->
        // The host only resolves a cwd for spawn; never offer SSH or archived projects.
        if (project.flag("archived") != false || "kind" in project && project["kind"].linkString() != "local") {
            return@metadataRows null
        }
        val name = project["name"].metadataString() ?: return@metadataRows null
        DesktopProject(id, project["alias"].metadataString()?.trim() ?: name)
    }

private fun desktopProviders(payload: JsonObject): List<DesktopProvider>? =
    metadataRows(payload["providers"], MAX_PROVIDERS) { provider, id ->
        val name = provider["name"].metadataString() ?: return@metadataRows null
        val models = metadataRows(provider["models"], MAX_MODELS_PER_PROVIDER) { model, modelId ->
            DesktopModel(modelId, model["label"].metadataString() ?: modelId)
        } ?: return@metadataRows null
        DesktopProvider(id, name, models)
    }

private fun <T> metadataRows(value: JsonElement?, limit: Int, read: (JsonObject, String) -> T?): List<T>? {
    val array = value as? JsonArray ?: return null
    val seen = mutableSetOf<String>()
    return Collections.unmodifiableList(array.asSequence().take(limit).mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val id = row["id"].metadataString() ?: return@mapNotNull null
        // Host resolves the first matching ID. Never offer a later duplicate of an excluded row.
        if (!seen.add(id)) return@mapNotNull null
        read(row, id)
    }.toList())
}

internal fun desktopCatalog(payload: JsonObject): List<DesktopTask>? = desktopCatalogRead(payload)?.tasks

private fun desktopCatalogRead(payload: JsonObject): DesktopRead.Catalog? {
    val entries = payload["entries"] as? JsonArray ?: return null
    if (entries.size > MAX_CATALOG_ENTRIES) return null
    val seen = mutableSetOf<String>()
    val identities = mutableSetOf<String>()
    val duplicates = mutableSetOf<String>()
    val queues = mutableMapOf<String, List<DesktopQueuedMessage>?>()
    val goals = mutableMapOf<String, DesktopGoal?>()
    val contexts = mutableMapOf<String, DesktopContextUsage?>()
    val usages = mutableMapOf<String, DesktopUsageTotals?>()
    val modelTargets = mutableSetOf<String>()
    val tasks = entries.mapNotNull { element ->
        val entry = element as? JsonObject ?: return@mapNotNull null
        val id = entry["id"].metadataString() ?: return@mapNotNull null
        if (!identities.add(id)) duplicates.add(id)
        val title = entry["title"].linkString()?.takeIf { it.length <= SESSION_TEXT_LIMIT } ?: return@mapNotNull null
        // slimCatalogForPhone drops chat-only metadata (including projectName) outside the subscription.
        val projectName = if ("projectName" in entry) entry["projectName"].linkString()
            ?.takeIf { it.length <= MAX_METADATA_TEXT } ?: return@mapNotNull null else ""
        val status = entry["status"].metadataString() ?: return@mapNotNull null
        val updatedAt = if ("updatedAt" in entry) {
            entry["updatedAt"].wireLong() ?: return@mapNotNull null
        } else null
        val approvals = entry.count("pendingApprovalCount") ?: return@mapNotNull null
        val asks = entry.count("pendingAskCount") ?: return@mapNotNull null
        val pinned = entry.flag("pinned") ?: return@mapNotNull null
        val archived = entry.flag("archived") ?: return@mapNotNull null
        // A malformed parent must not turn a coworker into a configurable root session.
        val parentId = if ("parentId" in entry) entry["parentId"].metadataString() ?: return@mapNotNull null else null
        if (!seen.add(id)) return@mapNotNull null
        // A slim row for an unrelated subscription cannot prove that the selected queue is empty.
        if ("projectName" in entry || "queued" in entry) queues[id] = desktopQueue(entry)
        if (!archived) {
            if ("goal" in entry) desktopGoal(entry["goal"])?.let { goals[id] = it }
            else if ("projectName" in entry) goals[id] = null
        }
        // Occupancy and totals are display-only and must never invalidate the row itself.
        // A slim row carries neither key, so it can neither project nor erase them.
        if (!archived && "projectName" in entry) {
            contexts[id] = desktopContextUsage(entry["context"])
            usages[id] = desktopUsageTotals(entry["usageTotals"])
        }
        // Only a full, configurable row can describe the settings. Missing/dirty fields stay
        // unknown, not a locally chosen default, and don't affect the rest of the row.
        val configurable = !archived && parentId == null && "projectName" in entry
        if (configurable) modelTargets.add(id)
        val providerId = entry["providerId"].metadataString().takeIf { configurable }
        val modelId = entry["modelId"].metadataString().takeIf { providerId != null }
        val reasoning = when (entry["reasoningEnabled"]) {
            JsonPrimitive(true) -> true
            JsonPrimitive(false) -> false
            else -> null
        }.takeIf { configurable }
        val thinking = entry["thinkingLevel"].linkString()?.let { wire -> TaskThinkingLevel.entries.find { it.wire == wire } }
            .takeIf { configurable }
        DesktopTask(id, title, projectName, updatedAt, status, approvals, asks, pinned, archived,
            entry["projectId"].metadataString(), providerId.takeIf { modelId != null }, modelId, parentId, reasoning, thinking)
    }
    duplicates.forEach {
        queues[it] = null
        goals.remove(it)
        contexts.remove(it)
        usages.remove(it)
        modelTargets.remove(it)
    }
    val unambiguousTasks = tasks.map { if (it.id in duplicates)
        it.copy(providerId = null, modelId = null, reasoningEnabled = null, thinkingLevel = null) else it }
    return DesktopRead.Catalog(Collections.unmodifiableList(unambiguousTasks), Collections.unmodifiableMap(queues),
        Collections.unmodifiableMap(goals), Collections.unmodifiableMap(contexts), Collections.unmodifiableMap(usages),
        Collections.unmodifiableSet(modelTargets))
}

private fun desktopGoal(value: JsonElement?): DesktopGoal? {
    val goal = value as? JsonObject ?: return null
    // Validate the text without changing it: observation must compare the actual desktop value.
    val text = goal["text"].linkString()?.takeIf { sessionGoalText(it) != null } ?: return null
    val status = goal["status"].linkString()?.takeIf { it in GOAL_STATUSES } ?: return null
    val autoTurns = goal["autoTurns"].linkIndex() ?: return null
    val note = if ("note" in goal) goal["note"].linkString()?.takeIf { it.length <= SESSION_TEXT_LIMIT } ?: return null else null
    return DesktopGoal(text, status, autoTurns, note)
}

/** Only a non-negative safe integer is a real occupancy; an unusable window invalidates the pair. */
private fun desktopContextUsage(value: JsonElement?): DesktopContextUsage? {
    val context = value as? JsonObject ?: return null
    val used = context["used"].linkIndex() ?: return null
    val window = if ("window" in context) context["window"].linkIndex()?.takeIf { it > 0 } ?: return null else null
    return DesktopContextUsage(used, window)
}

/** A dirty cache share loses only itself; the token totals stay usable. */
private fun desktopUsageTotals(value: JsonElement?): DesktopUsageTotals? {
    val totals = value as? JsonObject ?: return null
    val inputTokens = totals["inputTokens"].linkIndex() ?: return null
    val outputTokens = totals["outputTokens"].linkIndex() ?: return null
    val cacheHitPercent = if ("cacheHitPercent" in totals)
        totals["cacheHitPercent"].linkIndex()?.takeIf { it <= 100 } else null
    return DesktopUsageTotals(inputTokens, outputTokens, cacheHitPercent)
}

private fun desktopQueue(entry: JsonObject): List<DesktopQueuedMessage>? {
    if ("queued" !in entry) return emptyList()
    val rows = entry["queued"] as? JsonArray ?: return null
    if (rows.size > MAX_QUEUE_ITEMS) return null
    val seen = mutableSetOf<String>()
    val result = rows.map { value ->
        val row = value as? JsonObject ?: return null
        val id = row["id"].metadataString() ?: return null
        if (!seen.add(id)) return null
        val text = row["text"].linkString()?.takeIf { it.length <= SESSION_TEXT_LIMIT } ?: return null
        val hasImages = row.flag("hasImages") ?: return null
        DesktopQueuedMessage(id, text, hasImages)
    }
    return Collections.unmodifiableList(result)
}

private fun JsonElement?.wireLong(): Long? = (this as? JsonPrimitive)
    ?.takeUnless { it.isString }?.content?.toLongOrNull()?.takeIf { it >= 0 }

private fun JsonObject.count(key: String): Int? = if (key !in this) 0 else
    this[key].wireLong()?.takeIf { it <= Int.MAX_VALUE }?.toInt()

private fun JsonObject.flag(key: String): Boolean? = if (key !in this) false else
    when ((this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.content) {
        "true" -> true
        "false" -> false
        else -> null
    }

internal fun linkBackoffMillis(attempt: Int, random: Double): Long {
    val base = (1_000L shl attempt.coerceIn(0, 5)).coerceAtMost(30_000)
    return (base * (0.7 + 0.6 * random)).roundToLong().coerceAtMost(30_000)
}
