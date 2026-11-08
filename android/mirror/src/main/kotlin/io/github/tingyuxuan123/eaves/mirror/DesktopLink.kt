package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.FrameCrypto
import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.PairCryptoException
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import io.github.tingyuxuan123.eaves.pair.SessionSync
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.pair.SessionTimelineReducer
import io.github.tingyuxuan123.eaves.pair.isReplayBootstrapResponse
import java.net.Proxy
import java.nio.ByteBuffer
import java.util.Collections
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.random.Random
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** Single-session mirror with foreground-only writes. The actor owns authorization and projections. */
class DesktopLink internal constructor(
    credentials: PairCredentials,
    onModern: () -> Unit,
    allowLoopbackHttp: Boolean,
    dispatcher: CoroutineDispatcher,
    private val nowMillis: () -> Long,
    private val jitter: () -> Double,
    private val openSocket: (Request, WebSocketListener) -> WebSocket,
    private val wallMillis: () -> Long = System::currentTimeMillis,
) : AutoCloseable {
    constructor(credentials: PairCredentials, onModern: () -> Unit, allowLoopbackHttp: Boolean = false) :
        this(credentials, onModern, allowLoopbackHttp, Dispatchers.IO, { System.nanoTime() / 1_000_000 },
            { Random.nextDouble() }, { request, listener ->
                val client = if (allowLoopbackHttp && request.url.host == "127.0.0.1" &&
                    PairRelayUrl.isLoopback(request.url)) directClient else relayClient
                client.newWebSocket(request, listener)
            })

    private val request = try {
        relayRequest(credentials, allowLoopbackHttp)
    } catch (_: IllegalArgumentException) {
        null
    }
    // The coordinator may wipe its credentials as soon as close() is called.
    private val contentKey = credentials.contentKey.copyOf()
    private val replay = try {
        FrameReplay(contentKey, role = ReplayRole.Guest, requireModern = true, onModern = onModern)
    } catch (_: Exception) {
        null
    }
    private val mutableState = MutableStateFlow(DesktopLinkState())
    val state: StateFlow<DesktopLinkState> = mutableState.asStateFlow()
    private val scope = CoroutineScope(dispatcher + Job())
    private val disposed = AtomicBoolean()
    private val events = Channel<Event>(Channel.UNLIMITED)

    // Only the event loop below mutates connection, replay, timer, or published state.
    private var visible = false
    private var backgroundAllowed = false
    private var current: Connection? = null
    private var retry: Scheduled? = null
    private var attempt = 0
    private var disposing = false
    private var selectedSession: String? = null
    private var pendingSync: PendingSync? = null
    private var historyBefore: Long? = null
    private val pendingResponses = mutableMapOf<String, PendingResponse>()
    private val failedResponses = mutableSetOf<String>()
    private var textEvidence: TextEvidence? = null
    private var textDeadline: Long? = null
    private var stopDeadline: Long? = null
    private var authoritativeQueue: List<DesktopQueuedMessage>? = null
    private var subscriptionCatalogFloor: Long? = null
    private var queueEvidence: QueueEvidence? = null
    private var queueDeadline: Long? = null
    private var authoritativeGoal: DesktopGoal? = null
    private var goalEpochFloor = 0L
    private var goalEvidence: GoalEvidence? = null
    private var maintenanceEvidence: MaintenanceEvidence? = null
    private var rewindEvidence: RewindEvidence? = null
    private var taskStopEvidence: TaskStopEvidence? = null
    private var fileListPending: FileListPending? = null
    private var fileReadPending: FileReadPending? = null
    private var previewPending: PreviewPending? = null
    private var botCatalogSentAt: Long? = null
    private var botInboxSentAt: Long? = null
    private var botTimelineSent: BotTimelineSent? = null
    // A bot write's answer is either a delivery-id receipt or a generic scope denial; both need order.
    private val botWrites = mutableListOf<BotWrite>()
    private var attemptId = 0L
    private var pendingCreation: PendingCreation? = null
    // Caller writes cannot outlive their visible UI generation while waiting for the actor.
    @Volatile private var visibilityAuthority: Any? = null
    // These actions also capture authorization for a specific authenticated baseline.
    @Volatile private var creationAuthority: Any? = null
    @Volatile private var sessionWriteAuthority: Any? = null
    private val imageCommandQueued = AtomicBoolean()
    private var botStopWrite: BotWrite? = null

    init {
        scope.launch {
            try {
                for (event in events) {
                    if (event is Event.Text) event.connection.queued.decrementAndGet()
                    if (event is Event.Binary) event.connection.queued.decrementAndGet()
                    if (!disposed.get() || disposing || event === Event.Dispose) handle(event)
                    if (disposing && current == null) break
                }
            } finally {
                events.cancel()
                current?.let(::detach)
                contentKey.fill(0)
                scope.cancel()
            }
        }
    }

    fun setVisible(visible: Boolean) {
        if (!disposed.get()) events.trySend(Event.Visibility(visible))
    }

    /** Retains transport while hidden. Enable only while the app's foreground service is running. */
    fun setBackgroundAllowed(allowed: Boolean) {
        if (!disposed.get()) events.trySend(Event.BackgroundAllowed(allowed))
    }

    fun reconnect() {
        if (!disposed.get()) events.trySend(Event.Reconnect)
    }

    fun selectSession(sessionId: String?) {
        if (!disposed.get()) events.trySend(Event.SelectSession(sessionId))
    }

    fun createTask(request: TaskLaunch) {
        val authority = creationAuthority
        val baseline = state.value
        if (!disposed.get()) events.trySend(Event.CreateTask(request,
            authority.takeIf { baseline.phase == LinkPhase.Online && !baseline.readOnly }))
    }

    fun dismissCreation(sessionId: String?) {
        if (!disposed.get()) events.trySend(Event.DismissCreation(sessionId))
    }

    fun retrySession() {
        if (!disposed.get()) events.trySend(Event.RetrySession)
    }

    fun loadHistory(sessionId: String) {
        if (!disposed.get()) events.trySend(Event.History(sessionId))
    }

    fun respondApproval(sessionId: String, requestId: String, decision: String) {
        enqueueResponse(sessionId, requestId, "approval-respond", decision)
    }

    fun respondAsk(sessionId: String, requestId: String, answer: String) {
        enqueueResponse(sessionId, requestId, "ask-respond", answer)
    }

    private fun enqueueResponse(sessionId: String, requestId: String, command: String, value: String) {
        val authority = visibilityAuthority ?: return
        if (!disposed.get()) events.trySend(Event.Respond(sessionId, requestId, command, value, authority))
    }

    fun submitText(sessionId: String, text: String, steer: Boolean) {
        if (text.length in 1..SESSION_TEXT_LIMIT && text.isNotBlank()) {
            sessionCommand(sessionId, if (steer) SessionCommand.Steer else SessionCommand.Prompt, text)
        }
    }

    fun submitImages(sessionId: String, text: String, images: List<SessionImage>) {
        val authority = sessionWriteAuthority ?: return
        val baseline = state.value
        val session = baseline.session ?: return
        if (disposed.get() || baseline.phase != LinkPhase.Online || baseline.readOnly || session.loading || session.error ||
            session.timeline.sessionId != sessionId || session.timeline.status != "idle" ||
            images.size !in 1..SESSION_IMAGE_LIMIT) return
        val epoch = session.timeline.cursor?.get("epoch").linkString() ?: return
        // At most one validated image payload may wait in the actor's otherwise unbounded inbox.
        if (!imageCommandQueued.compareAndSet(false, true)) return
        var queued = false
        try {
            val snapshot = images.toList()
            if (!sessionImagePromptFits(sessionId, text, snapshot) || disposed.get()) return
            queued = events.trySend(Event.WriteSession(sessionId, epoch, SessionCommand.Prompt, imagePromptText(text),
                authority, snapshot)).isSuccess
        } finally {
            if (!queued) imageCommandQueued.set(false)
        }
    }

    fun stopSession(sessionId: String) = sessionCommand(sessionId, SessionCommand.Abort)

    fun queueAction(sessionId: String, command: QueueCommand, messageId: String? = null, text: String? = null) {
        val authority = sessionWriteAuthority ?: return
        val baseline = state.value
        val session = baseline.session ?: return
        if (baseline.phase != LinkPhase.Online || baseline.readOnly || session.loading || session.error ||
            session.timeline.sessionId != sessionId) return
        val epoch = session.timeline.cursor?.get("epoch").linkString() ?: return
        if (!disposed.get()) events.trySend(Event.WriteQueue(sessionId, epoch, authority, command, messageId,
            text, session.queued.find { it.id == messageId }))
    }

    private fun sessionCommand(sessionId: String, command: SessionCommand, text: String? = null) {
        val authority = visibilityAuthority ?: return
        val baseline = state.value
        if (baseline.phase != LinkPhase.Online || baseline.readOnly) return
        val epoch = baseline.session?.takeIf { !it.loading && !it.error && it.timeline.sessionId == sessionId }
            ?.timeline?.cursor?.get("epoch").linkString() ?: return
        if (!disposed.get()) events.trySend(Event.WriteSession(sessionId, epoch, command, text, authority))
    }

    fun goalAction(sessionId: String, command: GoalCommand, expected: DesktopGoal?, text: String? = null) {
        val authority = sessionWriteAuthority ?: return
        val baseline = state.value
        val session = baseline.session ?: return
        if (baseline.phase != LinkPhase.Online || baseline.readOnly || session.loading || session.error ||
            session.timeline.sessionId != sessionId || !session.goalReady || expected != session.goal) return
        val epoch = session.timeline.cursor?.get("epoch").linkString() ?: return
        val normalized = if (command == GoalCommand.Set) sessionGoalText(text ?: return) ?: return else {
            if (text != null) return
            null
        }
        if (!disposed.get()) events.trySend(Event.WriteGoal(sessionId, epoch, authority, command, expected, normalized))
    }

    /**
     * Retry or compact the selected session. The caller hands back the exact baseline it saw so an
     * old screen can never resend after the actor's epoch, attempt or compaction moved underneath it.
     */
    fun maintain(sessionId: String, command: SessionMaintenanceCommand, baseline: MaintenanceBaseline,
                 text: String? = null) {
        val authority = sessionWriteAuthority ?: return
        val state = state.value
        val session = state.session ?: return
        if (state.phase != LinkPhase.Online || state.readOnly || session.loading || session.error ||
            session.timeline.sessionId != sessionId || baseline != session.maintenanceBaseline) return
        val normalized = when (command) {
            SessionMaintenanceCommand.Retry -> {
                // A failed turn is the main reason to retry; only an active turn is excluded.
                if (text != null || session.timeline.status !in setOf("idle", "failed", "error")) return
                null
            }
            SessionMaintenanceCommand.Compact -> text?.let { compactionInstructions(it) ?: return }
        }
        if (!disposed.get()) events.trySend(Event.WriteMaintenance(sessionId, command, baseline, normalized, authority))
    }

    /**
     * Rewind the selected session to the Nth user message from the end. The caller hands back the
     * exact baseline it saw so an old screen can never resend after the timeline or attempt moved.
     */
    fun rewind(sessionId: String, userIndexFromEnd: Long, restoreFiles: Boolean, baseline: RewindBaseline) {
        val authority = sessionWriteAuthority ?: return
        val state = state.value
        val session = state.session ?: return
        if (state.phase != LinkPhase.Online || state.readOnly || session.loading || session.error ||
            session.timeline.sessionId != sessionId || baseline != session.rewindBaseline) return
        // The desktop re-orders history for an active turn, so a running session is not a rewind target.
        if (session.running || userIndexFromEnd !in 0..MAX_SAFE_INTEGER) return
        if (session.rewindPending() || session.textAttempt?.phase == SessionCommandPhase.Waiting ||
            session.queueAttempt?.phase == SessionCommandPhase.Waiting || session.goalWorkPending() ||
            session.maintenancePending() || session.taskStopPending()) return
        if (!disposed.get()) events.trySend(Event.WriteRewind(sessionId, userIndexFromEnd, restoreFiles, baseline,
            authority))
    }

    /**
     * Stop one running background task or subagent of the selected session. The caller hands back the
     * exact baseline it saw so an old screen can never stop a task that already moved.
     */
    fun stopTask(sessionId: String, kind: SessionTaskKind, targetId: String, baseline: TaskStopBaseline) {
        val authority = sessionWriteAuthority ?: return
        val state = state.value
        val session = state.session ?: return
        if (state.phase != LinkPhase.Online || state.readOnly || session.loading || session.error ||
            session.timeline.sessionId != sessionId || baseline != session.taskStopBaseline(kind) ||
            !baseline.serves(targetId)) return
        if (session.taskStopPending() || session.textAttempt?.phase == SessionCommandPhase.Waiting ||
            session.queueAttempt?.phase == SessionCommandPhase.Waiting || session.goalWorkPending() ||
            session.maintenancePending() || session.rewindPending()) return
        if (!disposed.get()) events.trySend(Event.WriteTaskStop(sessionId, kind, targetId, baseline, authority))
    }

    /** Read-only listing of the selected session's artifacts; it never needs a write scope. */
    fun listFiles(sessionId: String) {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || sessionId.length !in 1..FILE_TEXT_LIMIT ||
            baseline.session?.timeline?.sessionId != sessionId || baseline.session.files?.listing == true) return
        events.trySend(Event.ListFiles(sessionId))
    }

    /** Read one bounded block of an artifact id that the desktop authored; `rel` never travels. */
    fun readFile(sessionId: String, fileId: String, offset: Long) {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || sessionId.length !in 1..FILE_TEXT_LIMIT ||
            fileId.length !in 1..FILE_TEXT_LIMIT || fileId.isBlank() || offset !in 0..MAX_SAFE_INTEGER ||
            baseline.session?.timeline?.sessionId != sessionId || baseline.session.files?.reading == true) return
        events.trySend(Event.ReadFile(sessionId, fileId, offset))
    }

    /** Read-only listing of the selected session's preview targets; it never needs a write scope. */
    fun listPreviews(sessionId: String) {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || sessionId.length !in 1..PREVIEW_TEXT_LIMIT ||
            baseline.session?.timeline?.sessionId != sessionId || baseline.session.preview?.busy == true) return
        events.trySend(Event.ListPreviews(sessionId))
    }

    /** Open one listed entry at the requested viewport; only one preview operation may be in flight. */
    fun openPreview(sessionId: String, entryId: String, width: Int, height: Int) {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || sessionId.length !in 1..PREVIEW_TEXT_LIMIT ||
            entryId.length !in 1..PREVIEW_TEXT_LIMIT || entryId.isBlank() ||
            width !in 1..PREVIEW_SIZE_LIMIT || height !in 1..PREVIEW_SIZE_LIMIT ||
            baseline.session?.timeline?.sessionId != sessionId || baseline.session.preview?.busy == true) return
        events.trySend(Event.OpenPreview(sessionId, entryId, width, height))
    }

    /** Frame, refresh or close the established preview; without a preview id there is nothing to address. */
    fun previewAction(sessionId: String, action: DesktopPreviewAction) {
        val baseline = state.value
        val preview = baseline.session?.preview
        if (disposed.get() || baseline.phase != LinkPhase.Online || sessionId.length !in 1..PREVIEW_TEXT_LIMIT ||
            baseline.session?.timeline?.sessionId != sessionId || preview == null || preview.busy ||
            preview.previewId.isNullOrEmpty()) return
        events.trySend(Event.PreviewAction(sessionId, action))
    }

    /** One gesture inside the current frame; a stale frame id would land on a moved page. */
    fun previewInput(sessionId: String, input: DesktopPreviewInput) {
        val baseline = state.value
        val preview = baseline.session?.preview
        if (disposed.get() || baseline.phase != LinkPhase.Online || sessionId.length !in 1..PREVIEW_TEXT_LIMIT ||
            baseline.session?.timeline?.sessionId != sessionId || preview == null || preview.busy ||
            preview.previewId.isNullOrEmpty() || preview.frame == null) return
        events.trySend(Event.PreviewInput(sessionId, input))
    }

    /** The bot directory is read-only; a repeat inside one window never becomes a second request. */
    fun requestBots() {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online ||
            baseline.bots?.catalogRequested == true) return
        events.trySend(Event.RequestBots)
    }

    /** The inbox is read-only as well; the desktop answers with the whole table and no request id. */
    fun requestInbox() {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online ||
            baseline.bots?.inboxRequested == true) return
        events.trySend(Event.RequestInbox)
    }

    /** Open one bot chat: the desktop answers with the newest group timeline page. */
    fun openBotChat(chatId: String) {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || chatId.length !in 1..BOT_TEXT_LIMIT ||
            chatId.isBlank()) return
        val bots = baseline.bots
        if (bots?.timelineRequested == true && bots.timelineChatId == chatId) return
        events.trySend(Event.OpenBotChat(chatId))
    }

    fun closeBotChat(chatId: String) {
        if (!disposed.get()) events.trySend(Event.CloseBotChat(chatId))
    }

    /** Page one chat's group timeline; without [beforeSeq] the desktop answers with the newest page. */
    fun loadBotTimeline(chatId: String, beforeSeq: Long? = null) {
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || chatId.length !in 1..BOT_TEXT_LIMIT ||
            chatId.isBlank() || beforeSeq != null && beforeSeq !in 0..MAX_SAFE_INTEGER) return
        events.trySend(Event.LoadBotTimeline(chatId, beforeSeq))
    }

    /**
     * Send one human message into a bot chat. The phone owns the delivery id so the desktop's answer
     * can settle exactly this attempt, even after the timeout.
     */
    fun sendBotMessage(chatId: String, text: String, deliveryId: String = UUID.randomUUID().toString()) {
        val authority = creationAuthority ?: return
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || baseline.readOnly ||
            chatId.length !in 1..BOT_TEXT_LIMIT || chatId.isBlank() ||
            baseline.bots?.send?.phase == SessionCommandPhase.Waiting || !BOT_DELIVERY_ID.matches(deliveryId)) return
        val normalized = botMessageText(text) ?: return
        events.trySend(Event.BotSend(chatId, normalized, deliveryId, authority))
    }

    /** Ask the desktop to stop a bot chat; only the next running state can prove the stop. */
    fun stopBotChat(chatId: String) {
        val authority = creationAuthority ?: return
        val baseline = state.value
        if (disposed.get() || baseline.phase != LinkPhase.Online || baseline.readOnly ||
            chatId.length !in 1..BOT_TEXT_LIMIT || chatId.isBlank() ||
            baseline.bots?.stop?.phase == SessionCommandPhase.Waiting) return
        events.trySend(Event.BotStop(chatId, authority))
    }

    /** Changes the desktop's active topic, not merely the local view. */
    fun changeBotThread(rootId: String, command: BotThreadCommand, targetId: String?, expectedActiveId: String) {
        val authority = creationAuthority ?: return
        val baseline = state.value
        if (!disposed.get() && baseline.phase == LinkPhase.Online && !baseline.readOnly &&
            baseline.bots?.activeBotThread(rootId)?.id == expectedActiveId) {
            events.trySend(Event.ChangeBotThread(rootId, command, targetId, expectedActiveId, authority))
        }
    }

    override fun close() {
        if (disposed.compareAndSet(false, true)) events.trySend(Event.Dispose)
    }

    private fun handle(event: Event) {
        when (event) {
            is Event.Visibility -> changeVisibility(event.value)
            is Event.BackgroundAllowed -> {
                if (disposing || backgroundAllowed == event.value) return
                backgroundAllowed = event.value
                if (!visible) {
                    if (backgroundAllowed) start()
                    else hide(sendHiddenPresence = false)
                }
            }
            Event.Reconnect -> {
                if (disposing || phase == LinkPhase.Revoked || phase == LinkPhase.Failed) return
                cancelRetry()
                attempt = 0
                val connection = current
                if (connection?.terminalClose?.get() == LinkPhase.Revoked) {
                    end(connection, 1008, false)
                    return
                }
                current?.let(::detach)
                if (phase == LinkPhase.Replaced) publish(LinkPhase.Inactive)
                start()
            }
            Event.Dispose -> {
                disposing = true
                val wasVisible = visible
                visible = false
                backgroundAllowed = false
                visibilityAuthority = null
                hide(sendHiddenPresence = wasVisible)
                selectedSession = null
                mutableState.value = mutableState.value.copy(session = null)
                publish(LinkPhase.Inactive)
            }
            is Event.SelectSession -> select(event.sessionId)
            is Event.CreateTask -> create(event)
            is Event.DismissCreation -> dismiss(event.sessionId)
            Event.RetrySession -> if (mutableState.value.session?.loading == false) current?.takeIf(::online)?.let {
                requestSync(it, useCursor = pendingSync?.let { pending -> pending.cursor != null } ?: true)
            }
            is Event.History -> history(event.sessionId)
            is Event.Respond -> respond(event)
            is Event.WriteSession -> try {
                writeSession(event)
            } finally {
                if (event.images != null) imageCommandQueued.set(false)
            }
            is Event.WriteQueue -> writeQueue(event)
            is Event.WriteGoal -> writeGoal(event)
            is Event.WriteMaintenance -> writeMaintenance(event)
            is Event.WriteRewind -> writeRewind(event)
            is Event.WriteTaskStop -> writeTaskStop(event)
            is Event.ListFiles -> requestFileList(event.sessionId)
            is Event.ReadFile -> requestFileRead(event)
            is Event.ListPreviews -> requestPreviewList(event.sessionId)
            is Event.OpenPreview -> requestPreviewOpen(event)
            is Event.PreviewAction -> requestPreviewAction(event)
            is Event.PreviewInput -> requestPreviewInput(event)
            is Event.RequestBots -> requestBotCatalog()
            is Event.RequestInbox -> requestBotInbox()
            is Event.OpenBotChat -> requestBotTimeline(event.chatId, null, open = true)
            is Event.CloseBotChat -> clearBotTimeline(event.chatId)
            is Event.LoadBotTimeline -> requestBotTimeline(event.chatId, event.beforeSeq, open = false)
            is Event.BotSend -> writeBotSend(event)
            is Event.BotStop -> writeBotStop(event)
            is Event.ChangeBotThread -> writeBotThread(event)
            is Event.Open -> {
                if (active(event.connection) && phase == LinkPhase.Connecting) {
                    val connection = event.connection
                    cancelTimer(connection, Timer.Connect)
                    publish(LinkPhase.AwaitingHost)
                    ping(connection)
                }
            }
            is Event.Text -> if (current === event.connection) text(event.connection, event.value)
            is Event.Binary -> if (active(event.connection)) binary(event.connection, event.value)
            is Event.End -> if (current === event.connection) end(event.connection, event.code, event.replaced)
            is Event.Deadline -> deadline(event)
        }
    }

    private val phase get() = mutableState.value.phase
    private val terminal get() = phase == LinkPhase.Revoked || phase == LinkPhase.Failed || phase == LinkPhase.Replaced
    private val retainTransport get() = visible || backgroundAllowed

    private fun active(connection: Connection) = current === connection && !connection.retiring &&
        retainTransport && !disposed.get() && connection.accepting.get() && connection.terminalClose.get() == null

    private fun online(connection: Connection) = active(connection) && phase == LinkPhase.Online && replay?.isReady() == true

    private fun changeVisibility(value: Boolean) {
        if (disposing || visible == value) return
        visible = value
        if (!visible) {
            visibilityAuthority = null
            creationAuthority = null
            sessionWriteAuthority = null
            current?.let { cancelTimer(it, Timer.BotRefresh) }
            // Keep evidence of already-sent writes, but never continue an automated task launch.
            finishCreation(CreationPhase.Unconfirmed)
            // A hidden screen can no longer prove an in-flight rewind; the desktop may still finish it.
            mutableState.value = mutableState.value.unconfirmedRewind().unconfirmedTaskStop()
        }
        if (!retainTransport) {
            hide(sendHiddenPresence = true)
            return
        }
        current?.takeIf(::online)?.let { connection ->
            if (send(connection, presence(visible)) && visible) {
                creationAuthority = Any()
                refreshSessionWriteAuthority()
                if (selectedSession != null && connection.lastSyncSession != selectedSession) {
                    requestSync(connection, useCursor = true)
                }
            }
        }
        if (visible) {
            visibilityAuthority = Any()
            start()
        }
    }

    private fun publish(phase: LinkPhase, retainRtt: Boolean = false) {
        creationAuthority = null
        finishCreation(CreationPhase.Unconfirmed)
        // Bot pushes belong to one authenticated connection; a new generation starts with no inbox.
        botCatalogSentAt = null
        botInboxSentAt = null
        botTimelineSent = null
        // An in-flight bot write belongs to that generation too; its receipt can never arrive here.
        botWrites.clear()
        botStopWrite = null
        current?.let { connection ->
            cancelTimer(connection, Timer.BotSend)
            cancelTimer(connection, Timer.BotStop)
            cancelTimer(connection, Timer.BotThread)
        }
        val previous = mutableState.value
        if (phase == LinkPhase.Revoked || disposing) failedResponses.clear()
        else failedResponses.addAll(pendingResponses.keys)
        clearSessionTraffic()
        if (phase == LinkPhase.Revoked || disposing) textEvidence = null
        val session = previous.session.takeUnless { phase == LinkPhase.Revoked || disposing }
            ?.let { it.copy(loading = phase != LinkPhase.Failed, loadingHistory = false, pendingResponses = emptySet(),
                responseFailed = failedResponses.isNotEmpty(),
                textAttempt = it.textAttempt?.let { text -> if (text.phase == SessionCommandPhase.Waiting)
                    text.copy(phase = SessionCommandPhase.Unconfirmed) else text },
                queued = emptyList(), queueReady = false,
                queueAttempt = it.queueAttempt?.let { queue -> if (queue.phase == SessionCommandPhase.Waiting)
                    queue.copy(phase = SessionCommandPhase.Unconfirmed) else queue },
                goalReady = false,
                goalAttempt = it.goalAttempt.withoutGoalEvidence(),
                maintenance = it.maintenance?.let { attempt -> if (attempt.phase == SessionCommandPhase.Waiting)
                    attempt.copy(phase = SessionCommandPhase.Unconfirmed) else attempt },
                rewind = it.rewind?.let { attempt -> if (attempt.phase == SessionCommandPhase.Waiting)
                    attempt.copy(phase = SessionCommandPhase.Unconfirmed) else attempt },
                taskStop = it.taskStop?.let { attempt -> if (attempt.phase == SessionCommandPhase.Waiting)
                    attempt.copy(phase = SessionCommandPhase.Unconfirmed) else attempt },
                // Files belong to one authenticated connection; a new one must list again.
                files = null,
                // A preview belongs to one connection and selection as well; it is never replayed.
                preview = null,
                stopPhase = if (it.stopPhase == SessionCommandPhase.Waiting) SessionCommandPhase.Unconfirmed else it.stopPhase) }
        if (phase == LinkPhase.Revoked) selectedSession = null
        mutableState.value = DesktopLinkState(phase, rttMillis = previous.rttMillis.takeIf { retainRtt }, session = session,
            creation = previous.creation.takeUnless { disposing || phase == LinkPhase.Revoked && it?.phase == CreationPhase.Created })
    }

    private fun select(sessionId: String?, created: DesktopCreation? = null) {
        // Sync IDs have the same 512 UTF-16 code-unit bound as pairPolicy, not a UI-only bound.
        if (selectedSession == sessionId || (sessionId != null &&
                (phase == LinkPhase.Revoked || phase == LinkPhase.Failed || sessionId.length !in 1..512))) return
        // The actor's own selection must keep the pending text until the fresh session baseline.
        if (created == null) finishCreation(CreationPhase.Unconfirmed)
        clearSessionTraffic()
        failedResponses.clear()
        textEvidence = null
        selectedSession = sessionId
        val state = mutableState.value
        mutableState.value = state.copy(session = sessionId?.let { DesktopSessionState(SessionTimeline(it)) },
            creation = created ?: state.creation.takeUnless { it?.phase == CreationPhase.Created })
        current?.takeIf(::online)?.let { connection ->
            if (sessionId == null) {
                connection.lastSyncSession = null
                send(connection, buildJsonObject { put("type", "subscribe"); put("sessionId", JsonNull) })
            } else requestSync(connection, useCursor = false)
        }
    }

    private fun create(event: Event.CreateTask) {
        val state = mutableState.value
        if (selectedSession != null || pendingCreation != null || state.creation?.phase in DISMISSIBLE_CREATION_PHASES) return
        val request = event.request
        val connection = current?.takeIf(::online)
        val valid = visible && connection != null && event.authority != null && event.authority === creationAuthority &&
            !state.readOnly && request.text.length in 1..SESSION_TEXT_LIMIT && request.text.isNotBlank() &&
            state.projects?.any { it.id == request.projectId } == true &&
            state.providers?.find { it.id == request.providerId }?.models?.any { it.id == request.modelId } == true
        if (!valid) {
            unavailableCreation()
            return
        }
        val id = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", "spawn")
            put("sessionId", id)
            put("projectId", request.projectId)
            put("providerId", request.providerId)
            put("modelId", request.modelId)
            put("approvalMode", request.approvalMode.wire)
            request.thinkingLevel?.let { put("reasoningEnabled", true); put("thinkingLevel", it.wire) }
        })) {
            unavailableCreation()
            return
        }
        pendingCreation = PendingCreation(id, nowMillis() + CREATION_TIMEOUT_MS, request.text)
        mutableState.value = state.copy(creation = DesktopCreation(id, CreationPhase.Creating))
        arm(connection, Timer.Creation, CREATION_TIMEOUT_MS)
    }

    private fun unavailableCreation() {
        mutableState.value = mutableState.value.copy(creation = DesktopCreation(null, CreationPhase.Unavailable))
    }

    private fun dismiss(sessionId: String?) {
        val state = mutableState.value
        val creation = state.creation ?: return
        if (creation.sessionId == sessionId && creation.phase in DISMISSIBLE_CREATION_PHASES) {
            mutableState.value = state.copy(creation = null)
        }
    }

    /** Only a newly applied, authenticated catalog can prove the exact spawned ID. */
    private fun confirmCreation(tasks: List<DesktopTask>) {
        val pending = liveCreation() ?: return
        if (selectedSession == null && mutableState.value.creation?.phase == CreationPhase.Creating &&
            tasks.any { it.id == pending.sessionId }) {
            select(pending.sessionId, DesktopCreation(pending.sessionId, CreationPhase.Created))
        }
    }

    private fun liveCreation(): PendingCreation? {
        val pending = pendingCreation ?: return null
        if (nowMillis() < pending.deadline) return pending
        finishCreation(CreationPhase.Unconfirmed)
        return null
    }

    private fun finishCreation(phase: CreationPhase) {
        if (pendingCreation == null) return
        pendingCreation = null
        current?.let { cancelTimer(it, Timer.Creation) }
        val state = mutableState.value
        state.creation?.takeIf { it.phase == CreationPhase.Creating }?.let {
            mutableState.value = state.copy(creation = it.copy(phase = phase))
        }
    }

    private fun sendFirstText(session: DesktopSessionState) {
        val pending = liveCreation()?.takeIf { it.sessionId == session.timeline.sessionId } ?: return
        if (mutableState.value.creation?.phase != CreationPhase.Created) return
        // This is a one-shot opportunity, even when the desktop has already started using the session.
        finishCreation(CreationPhase.Unconfirmed)
        val text = pending.firstText ?: return
        val authority = visibilityAuthority ?: return
        val timeline = session.timeline
        val epoch = timeline.cursor?.get("epoch").linkString() ?: return
        if (timeline.status == "idle" && timeline.baseIndex == 0L && timeline.messages.isEmpty()) {
            writeSession(Event.WriteSession(pending.sessionId, epoch, SessionCommand.Prompt, text, authority))
        }
    }

    private fun clearSessionTraffic() {
        sessionWriteAuthority = null
        authoritativeQueue = null
        subscriptionCatalogFloor = null
        queueEvidence = null
        queueDeadline = null
        clearGoalAuthority()
        maintenanceEvidence = null
        rewindEvidence = null
        taskStopEvidence = null
        // File answers are only meaningful for the connection and selection that asked.
        fileListPending = null
        fileReadPending = null
        // A preview answer is equally bound to the connection and selection that asked.
        previewPending = null
        pendingSync = null
        historyBefore = null
        pendingResponses.clear()
        textDeadline = null
        stopDeadline = null
        current?.let { connection ->
            cancelTimer(connection, Timer.SessionSync)
            cancelTimer(connection, Timer.History)
            cancelTimer(connection, Timer.Responses)
            cancelTimer(connection, Timer.SessionCommands)
            cancelTimer(connection, Timer.QueueCommands)
            cancelTimer(connection, Timer.Maintenance)
            cancelTimer(connection, Timer.Rewind)
            cancelTimer(connection, Timer.TaskStop)
            cancelTimer(connection, Timer.FileList)
            cancelTimer(connection, Timer.FileRead)
            cancelTimer(connection, Timer.Preview)
        }
    }

    private fun requestSync(connection: Connection, useCursor: Boolean, attempts: Int = 0) {
        if (!online(connection)) return
        val session = mutableState.value.session ?: return
        val id = selectedSession ?: return
        // Keep a retained subscription live, but a fresh hidden host only needs the catalog.
        // Showing the UI resumes this selection from its preserved cursor.
        if (!visible && connection.lastSyncSession != id) return
        sessionWriteAuthority = null
        cancelHistory(connection)
        cancelTimer(connection, Timer.SessionSync)
        pendingSync = PendingSync(id, UUID.randomUUID().toString(), session.timeline.cursor.takeIf { useCursor }, attempts)
        mutableState.value = mutableState.value.copy(session = session.copy(loading = true, error = false,
            loadingHistory = false)).unconfirmedRewind().unconfirmedTaskStop()
        val elapsed = nowMillis() - connection.lastSyncAt
        if (connection.lastSyncSession == id && elapsed < SYNC_DEDUPE_MS) {
            arm(connection, Timer.SessionSync, SYNC_DEDUPE_MS - elapsed)
        } else subscribePending(connection)
    }

    private fun subscribePending(connection: Connection) {
        if (!online(connection)) return
        val pending = pendingSync?.takeIf { it.sessionId == selectedSession } ?: return
        if (pending.sent) finishCreation(CreationPhase.Unconfirmed) // Never automate text after a sync timeout/retry.
        if (pending.attempts >= SYNC_ATTEMPTS) {
            mutableState.value = mutableState.value.copy(session = mutableState.value.session?.copy(loading = false, error = true))
            return // Keep the current requestId: a late, valid response can still settle it.
        }
        val command = buildJsonObject {
            put("type", "subscribe")
            put("sessionId", pending.sessionId)
            put("sync", buildJsonObject {
                put("requestId", pending.requestId)
                pending.cursor?.let { put("cursor", it) }
            })
        }
        if (!send(connection, command)) return
        if (subscriptionCatalogFloor == null) subscriptionCatalogFloor = connection.latestSequence
        pending.attempts++
        pending.sent = true
        connection.lastSyncAt = nowMillis()
        connection.lastSyncSession = pending.sessionId
        arm(connection, Timer.SessionSync, SYNC_TIMEOUT_MS)
    }

    private fun history(sessionId: String) {
        val connection = current?.takeIf(::online) ?: return
        val session = mutableState.value.session ?: return
        if (sessionId != selectedSession || session.loading || session.error || pendingSync != null ||
            session.loadingHistory || !session.hasMoreHistory || session.timeline.cursor == null || session.timeline.baseIndex <= 0) return
        val before = session.timeline.baseIndex
        if (!send(connection, buildJsonObject {
            put("type", "history"); put("sessionId", sessionId); put("beforeIndex", before)
        })) return
        historyBefore = before
        mutableState.value = mutableState.value.copy(session = session.copy(loadingHistory = true))
        arm(connection, Timer.History, HISTORY_TIMEOUT_MS)
    }

    private fun respond(event: Event.Respond) {
        if (!visible || event.authority !== visibilityAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (state.readOnly || event.sessionId != selectedSession || session.loading || session.error ||
            pendingSync != null || session.timeline.cursor == null || event.requestId.isEmpty() ||
            event.requestId in pendingResponses || event.value.length > MAX_FRAME_BYTES) return
        when (event.command) {
            "approval-respond" -> {
                val approval = session.timeline.approvals.find { it.requestId == event.requestId } ?: return
                if (approval.reviewing || approval.expiresAt?.let { it <= wallMillis() } == true ||
                    event.value !in APPROVAL_DECISIONS || approval.protected && event.value == "allowSession") return
            }
            "ask-respond" -> {
                val ask = session.timeline.asks.find { it.requestId == event.requestId } ?: return
                // Cancellation is intentionally not part of this API. Preserve exact choice labels.
                val validAnswer = if (ask.selectionOnly) event.value.isNotEmpty() && event.value in ask.options
                    else event.value.any { !it.isWhitespace() && it != '\uFEFF' }
                if (!validAnswer || ask.expiresAt?.let { it <= wallMillis() } == true) return
            }
            else -> return
        }
        val command = buildJsonObject {
            put("type", event.command); put("sessionId", event.sessionId); put("requestId", event.requestId)
            put(if (event.command == "approval-respond") "decision" else "answer", event.value)
        }
        // pairPolicy does not impose an arbitrary text limit. The encrypted relay frame is bounded.
        if (!send(connection, command)) {
            if (mutableState.value.session?.timeline?.sessionId == event.sessionId) failedResponses.add(event.requestId)
            mutableState.value = mutableState.value.copy(session = mutableState.value.session?.copy(responseFailed = true))
            return
        }
        pendingResponses[event.requestId] = PendingResponse(event.command, nowMillis() + RESPONSE_TIMEOUT_MS)
        failedResponses.remove(event.requestId)
        mutableState.value = mutableState.value.copy(session = session.copy(
            pendingResponses = pendingResponses.keys.toSet(), responseFailed = failedResponses.isNotEmpty()))
        armResponses(connection)
    }

    private fun writeSession(event: Event.WriteSession) {
        val images = event.images
        if (!visible || event.authority !== (if (images == null) visibilityAuthority else sessionWriteAuthority)) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (state.readOnly || session.loading || session.error || pendingSync != null ||
            selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            session.timeline.cursor?.get("epoch").linkString() != event.epoch) return
        if (images != null && session.timeline.status != "idle") return
        val allowed = when (event.command) {
            SessionCommand.Prompt -> session.canPrompt
            SessionCommand.Steer, SessionCommand.Abort -> session.running
        }
        if (!allowed) return
        val stopping = event.command == SessionCommand.Abort
        if (!stopping && (session.queueAttempt?.phase == SessionCommandPhase.Waiting || session.goalWorkPending() ||
                session.maintenancePending() || session.rewindPending() || session.taskStopPending())) return
        if ((if (stopping) session.stopPhase else session.textAttempt?.phase) == SessionCommandPhase.Waiting) return
        val command = buildJsonObject {
            put("type", event.command.wire)
            put("sessionId", event.sessionId)
            event.text?.let { put("text", it) }
            if (images != null) putJsonArray("images") {
                images.forEach { image -> addJsonObject {
                    put("data", image.data)
                    put("mimeType", image.mimeType)
                } }
            }
        }
        if (!send(connection, command)) return // Draft stays intact; a local send failure is never echoed.
        val deadline = nowMillis() + RESPONSE_TIMEOUT_MS
        val next = if (stopping) {
            stopDeadline = deadline
            session.copy(stopPhase = SessionCommandPhase.Waiting)
        } else {
            val timeline = session.timeline
            textEvidence = TextEvidence(event.command, event.epoch, cursorSequence(timeline.cursor),
                (timeline.messages.lastOrNull()?.index?.plus(1) ?: timeline.baseIndex))
            textDeadline = deadline
            val fingerprints = images?.let { Collections.unmodifiableList(it.map(SessionImage::fingerprint)) }.orEmpty()
            session.copy(textAttempt = SessionTextAttempt(++attemptId, requireNotNull(event.text),
                SessionCommandPhase.Waiting, fingerprints))
        }
        mutableState.value = state.copy(session = next)
        armSessionCommands(connection)
    }

    private fun refreshSessionWriteAuthority() {
        val state = mutableState.value
        val session = state.session
        sessionWriteAuthority = if (visible && current?.let(::online) == true && !state.readOnly && session != null &&
            !session.loading && !session.error && pendingSync == null && session.timeline.cursor != null) Any() else null
    }

    private fun writeQueue(event: Event.WriteQueue) {
        if (!visible || event.authority !== sessionWriteAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        val rows = authoritativeQueue ?: return
        if (state.readOnly || session.loading || session.error || pendingSync != null ||
            selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            session.timeline.cursor?.get("epoch").linkString() != event.epoch ||
            session.queueAttempt?.phase == SessionCommandPhase.Waiting || session.textAttempt?.phase == SessionCommandPhase.Waiting ||
            session.goalWorkPending() || session.rewindPending() || session.taskStopPending()) return
        val withText = event.command == QueueCommand.Enqueue || event.command == QueueCommand.Update
        if (withText && (event.text == null || event.text.length !in 1..SESSION_TEXT_LIMIT || event.text.isBlank()) ||
            !withText && event.text != null) return
        if (event.command == QueueCommand.Enqueue) {
            if (!session.running || event.messageId != null || session.maintenancePending()) return
        } else {
            val item = rows.find { it.id == event.messageId } ?: return
            // The ID may have been edited/replaced after the caller saw it, even in the same session.
            if (item != event.item || event.command == QueueCommand.InterruptSend && !session.running) return
        }
        val command = buildJsonObject {
            put("type", event.command.wire)
            put("sessionId", event.sessionId)
            event.messageId?.let { put("messageId", it) }
            event.text?.let { put("text", it) }
        }
        if (!send(connection, command)) return
        val attempt = DesktopQueueAttempt(++attemptId, event.command, event.messageId, event.text, SessionCommandPhase.Waiting)
        queueEvidence = QueueEvidence(attempt.id, event.epoch, connection.latestSequence, rows.map { it.id }.toSet())
        queueDeadline = nowMillis() + RESPONSE_TIMEOUT_MS
        mutableState.value = state.copy(session = session.copy(queueAttempt = attempt))
        arm(connection, Timer.QueueCommands, RESPONSE_TIMEOUT_MS)
    }

    private fun finishQueue(phase: SessionCommandPhase) {
        queueDeadline = null
        current?.let { cancelTimer(it, Timer.QueueCommands) }
        val state = mutableState.value
        val session = state.session ?: return
        val attempt = session.queueAttempt ?: return
        if (phase != SessionCommandPhase.Unconfirmed) queueEvidence = null
        mutableState.value = state.copy(session = session.copy(queueAttempt = attempt.copy(phase = phase)))
    }

    /** A catalog is only an observation of queue state; disappearing does not prove delivery. */
    private fun queueCatalog(connection: Connection, catalog: DesktopRead.Catalog, sequence: Long) {
        val floor = subscriptionCatalogFloor ?: return
        if (!online(connection) || sequence <= floor) return
        val state = mutableState.value
        val session = state.session ?: return
        val rows = catalog.queues[selectedSession]
        authoritativeQueue = rows
        mutableState.value = state.copy(session = session.copy(queued = rows ?: session.queued, queueReady = rows != null))
        if (rows == null) return // Missing/slim/malformed is not evidence that any item disappeared.
        val evidence = queueEvidence ?: return
        val attempt = session.queueAttempt ?: return
        if (attempt.id != evidence.attemptId || attempt.phase != SessionCommandPhase.Waiting ||
            session.loading || session.error || pendingSync != null || sequence <= evidence.afterSequence ||
            session.timeline.cursor?.get("epoch").linkString() != evidence.epoch) return
        if (queueDeadline?.let { nowMillis() >= it } != false) {
            finishQueue(SessionCommandPhase.Unconfirmed)
            return
        }
        val observed = when (attempt.command) {
            QueueCommand.Enqueue -> rows.any { it.id !in evidence.originalIds && it.text == attempt.text }
            QueueCommand.Update -> rows.any { it.id == attempt.messageId && it.text == attempt.text }
            QueueCommand.Remove, QueueCommand.SendNow, QueueCommand.InterruptSend -> rows.none { it.id == attempt.messageId }
        }
        if (observed) finishQueue(SessionCommandPhase.Observed)
    }

    private fun DesktopSessionState.goalWorkPending(): Boolean =
        goalAttempt?.let { it.phase == SessionCommandPhase.Waiting && it.command.startsWork } == true

    private fun DesktopSessionState.maintenancePending(): Boolean =
        maintenance?.phase == SessionCommandPhase.Waiting

    private fun DesktopSessionState.rewindPending(): Boolean =
        rewind?.phase == SessionCommandPhase.Waiting

    private fun DesktopSessionState.taskStopPending(): Boolean =
        taskStop?.phase == SessionCommandPhase.Waiting

    /** A stop target must be a bounded, non-blank id the caller actually saw running. */
    private fun TaskStopBaseline.serves(targetId: String): Boolean =
        targetId.length in 1..SESSION_TASK_ID_LIMIT && targetId.isNotBlank() && targetId in runningIds

    /** A hidden, read-only or resynced screen can no longer prove an in-flight rewind receipt. */
    private fun DesktopLinkState.unconfirmedRewind(): DesktopLinkState {
        val session = session ?: return this
        val attempt = session.rewind ?: return this
        if (attempt.phase != SessionCommandPhase.Waiting) return this
        return copy(session = session.copy(rewind = attempt.copy(phase = SessionCommandPhase.Unconfirmed)))
    }

    /** A hidden, read-only or resynced screen can no longer prove an in-flight task stop. */
    private fun DesktopLinkState.unconfirmedTaskStop(): DesktopLinkState {
        val session = session ?: return this
        val attempt = session.taskStop ?: return this
        if (attempt.phase != SessionCommandPhase.Waiting) return this
        return copy(session = session.copy(taskStop = attempt.copy(phase = SessionCommandPhase.Unconfirmed)))
    }

    private fun DesktopGoalAttempt?.withoutGoalEvidence(): DesktopGoalAttempt? =
        if (this?.phase == SessionCommandPhase.Waiting) copy(phase = SessionCommandPhase.Unconfirmed) else this

    private fun clearGoalAuthority(epochFloor: Long = 0) {
        authoritativeGoal = null
        goalEpochFloor = epochFloor
        goalEvidence = null
        current?.let { cancelTimer(it, Timer.GoalCommands) }
    }

    private fun writeGoal(event: Event.WriteGoal) {
        if (!visible || event.authority !== sessionWriteAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        val goal = authoritativeGoal
        if (state.readOnly || session.loading || session.error || pendingSync != null || !session.goalReady ||
            selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            session.timeline.cursor?.get("epoch").linkString() != event.epoch || goal != event.expected ||
            session.goalAttempt?.phase == SessionCommandPhase.Waiting) return
        if (event.command.startsWork && (session.textAttempt?.phase == SessionCommandPhase.Waiting ||
                session.queueAttempt?.phase == SessionCommandPhase.Waiting ||
                session.stopPhase == SessionCommandPhase.Waiting || session.maintenancePending() ||
                session.rewindPending() || session.taskStopPending())) return
        val changesGoal = when (event.command) {
            GoalCommand.Set -> event.text != goal?.text
            GoalCommand.Pause -> goal?.status == "active"
            GoalCommand.Resume -> goal?.status in setOf("paused", "blocked", "waiting")
            GoalCommand.Clear -> goal != null
        }
        if (!changesGoal) return
        val attempt = DesktopGoalAttempt(++attemptId, event.command, event.text, SessionCommandPhase.Waiting)
        val command = buildJsonObject {
            put("type", event.command.wire)
            put("sessionId", event.sessionId)
            event.text?.let { put("text", it) }
        }
        if (!send(connection, command)) {
            // A local failure is not an observation. Preserve the draft without overwriting the
            // state transition made by send (which can retire the connection).
            val after = mutableState.value
            after.session?.takeIf { it.timeline.sessionId == event.sessionId }?.let {
                mutableState.value = after.copy(session = it.copy(goalAttempt = attempt.withoutGoalEvidence()))
            }
            return
        }
        goalEvidence = GoalEvidence(attempt.id, event.epoch, connection.latestSequence, nowMillis() + RESPONSE_TIMEOUT_MS,
            goal?.text)
        mutableState.value = state.copy(session = session.copy(goalAttempt = attempt))
        arm(connection, Timer.GoalCommands, RESPONSE_TIMEOUT_MS)
    }

    private fun finishGoal(phase: SessionCommandPhase) {
        current?.let { cancelTimer(it, Timer.GoalCommands) }
        if (phase != SessionCommandPhase.Unconfirmed) goalEvidence = null
        val state = mutableState.value
        val session = state.session ?: return
        val attempt = session.goalAttempt ?: return
        mutableState.value = state.copy(session = session.copy(goalAttempt = attempt.copy(phase = phase)))
    }

    /** A goal catalog describes desktop state only. It cannot acknowledge model work or delivery. */
    private fun goalCatalog(connection: Connection, catalog: DesktopRead.Catalog?, sequence: Long) {
        val floor = subscriptionCatalogFloor ?: return
        if (!online(connection) || sequence <= maxOf(floor, goalEpochFloor)) return
        val state = mutableState.value
        val session = state.session ?: return
        val id = selectedSession ?: return
        if (session.timeline.sessionId != id || connection.lastSyncSession != id) return
        val ready = catalog?.goals?.containsKey(id) == true
        val goal = catalog?.goals?.get(id)
        authoritativeGoal = goal
        mutableState.value = state.copy(session = session.copy(goal = if (ready) goal else session.goal, goalReady = ready))
        if (!ready) return
        val evidence = goalEvidence ?: return
        val attempt = session.goalAttempt ?: return
        if (attempt.id != evidence.attemptId || attempt.phase != SessionCommandPhase.Waiting ||
            session.loading || session.error || pendingSync != null || sequence <= evidence.afterSequence ||
            session.timeline.cursor?.get("epoch").linkString() != evidence.epoch) return
        if (nowMillis() >= evidence.deadline) {
            finishGoal(SessionCommandPhase.Unconfirmed)
            return
        }
        val observed = when (attempt.command) {
            GoalCommand.Set -> goal?.status == "active" && goal.text == attempt.text
            GoalCommand.Pause -> goal?.status == "paused" && goal.text == evidence.previousText
            GoalCommand.Resume -> goal?.status == "active" && goal.text == evidence.previousText
            GoalCommand.Clear -> goal == null
        }
        if (observed) finishGoal(SessionCommandPhase.Observed)
    }

    /** Occupancy and totals are display-only readings of the subscribed row; they never gate writes. */
    private fun usageCatalog(connection: Connection, catalog: DesktopRead.Catalog, sequence: Long) {
        val floor = subscriptionCatalogFloor ?: return
        if (!online(connection) || sequence <= floor) return
        val state = mutableState.value
        val session = state.session ?: return
        val id = selectedSession ?: return
        if (session.timeline.sessionId != id || connection.lastSyncSession != id) return
        // A slim or malformed row carries no evidence. A full row without the key proves absence.
        val context = if (catalog.contexts.containsKey(id)) catalog.contexts[id] else session.context
        val usage = if (catalog.usages.containsKey(id)) catalog.usages[id] else session.usage
        if (context == session.context && usage == session.usage) return
        mutableState.value = state.copy(session = session.copy(context = context, usage = usage))
    }

    private fun writeMaintenance(event: Event.WriteMaintenance) {
        if (!visible || event.authority !== sessionWriteAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (state.readOnly || session.loading || session.error || pendingSync != null ||
            selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            event.baseline != session.maintenanceBaseline) return
        if (session.maintenance?.phase == SessionCommandPhase.Waiting) return
        // Work that is already waiting owns the session; abort and goal pause/clear stay free.
        if (session.textAttempt?.phase == SessionCommandPhase.Waiting ||
            session.queueAttempt?.phase == SessionCommandPhase.Waiting || session.goalWorkPending() ||
            session.rewindPending() || session.taskStopPending()) return
        val text = when (event.command) {
            SessionMaintenanceCommand.Retry -> {
                // Retrying a failed turn is the primary case; only an active turn is excluded.
                if (event.text != null || session.timeline.status !in setOf("idle", "failed", "error")) return
                null
            }
            SessionMaintenanceCommand.Compact -> event.text?.let { compactionInstructions(it) ?: return }
        }
        val command = buildJsonObject {
            put("type", event.command.wire)
            put("sessionId", event.sessionId)
            text?.let { put("instructions", it) }
        }
        val attempt = DesktopMaintenanceAttempt(++attemptId, event.command, text, SessionCommandPhase.Waiting)
        if (!send(connection, command)) {
            // A local failure is not an observation: keep the attempt without claiming it landed.
            val after = mutableState.value
            after.session?.takeIf { it.timeline.sessionId == event.sessionId }?.let {
                mutableState.value = after.copy(session = it.copy(
                    maintenance = attempt.copy(phase = SessionCommandPhase.Unconfirmed)))
            }
            return
        }
        maintenanceEvidence = MaintenanceEvidence(attempt.id, event.command, event.baseline.epoch,
            cursorSequence(session.timeline.cursor), connection.latestSequence, connection)
        mutableState.value = state.copy(session = session.copy(maintenance = attempt))
        arm(connection, Timer.Maintenance, RESPONSE_TIMEOUT_MS)
    }

    private fun finishMaintenance(phase: SessionCommandPhase) {
        current?.let { cancelTimer(it, Timer.Maintenance) }
        if (phase != SessionCommandPhase.Unconfirmed) maintenanceEvidence = null
        val state = mutableState.value
        val session = state.session ?: return
        val attempt = session.maintenance ?: return
        mutableState.value = state.copy(session = session.copy(maintenance = attempt.copy(phase = phase)))
    }

    /** Only a newer cursor in the same epoch of the selected session may settle a retry. */
    private fun observeMaintenance(connection: Connection, session: DesktopSessionState,
                                   type: String?): DesktopSessionState {
        val evidence = maintenanceEvidence ?: return session
        val attempt = session.maintenance ?: return session
        if (attempt.id != evidence.attemptId || attempt.command != SessionMaintenanceCommand.Retry ||
            attempt.phase != SessionCommandPhase.Waiting || evidence.generation !== connection ||
            session.loading || session.error || pendingSync != null ||
            session.timeline.sessionId != selectedSession ||
            session.timeline.cursor?.get("epoch").linkString() != evidence.epoch) return session
        val advanced = cursorSequence(session.timeline.cursor) > evidence.afterCursor
        val observed = if (type == "turn-retry") advanced else advanced && session.timeline.status == "running"
        if (!observed) return session
        finishMaintenance(SessionCommandPhase.Observed)
        return session.copy(maintenance = attempt.copy(phase = SessionCommandPhase.Observed))
    }

    /** Compaction progress is an epoch-scoped event; abandoned means the queue was dropped, not completed. */
    private fun compactionEvent(connection: Connection, session: DesktopSessionState,
                                body: JsonObject): DesktopSessionState {
        val stage = body["state"].linkString()?.takeIf { it in COMPACTION_STATES } ?: return session
        val error = body["error"].linkString()?.takeIf { it.isNotEmpty() }
        val abandoned = body["abandoned"] == JsonPrimitive(true)
        val projection = if (abandoned) null else DesktopCompaction(stage, error)
        val attempt = session.maintenance
        val evidence = maintenanceEvidence
        val settled = attempt != null && evidence != null && evidence.generation === connection &&
            attempt.id == evidence.attemptId && attempt.command == SessionMaintenanceCommand.Compact &&
            attempt.phase == SessionCommandPhase.Waiting && !session.loading && !session.error &&
            pendingSync == null && session.timeline.sessionId == selectedSession &&
            session.timeline.cursor?.get("epoch").linkString() == evidence.epoch &&
            cursorSequence(session.timeline.cursor) > evidence.afterCursor
        val rejected = settled && stage == "end" && !abandoned && error != null
        if (settled) finishMaintenance(if (rejected) SessionCommandPhase.Rejected else SessionCommandPhase.Observed)
        return session.copy(compaction = projection,
            maintenance = if (settled) attempt.copy(phase = if (rejected) SessionCommandPhase.Rejected
                else SessionCommandPhase.Observed) else attempt)
    }

    private fun writeRewind(event: Event.WriteRewind) {
        if (!visible || event.authority !== sessionWriteAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (state.readOnly || session.loading || session.error || pendingSync != null ||
            selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            event.baseline != session.rewindBaseline || session.running ||
            event.userIndexFromEnd !in 0..MAX_SAFE_INTEGER) return
        if (session.rewindPending() || session.textAttempt?.phase == SessionCommandPhase.Waiting ||
            session.queueAttempt?.phase == SessionCommandPhase.Waiting || session.goalWorkPending() ||
            session.maintenancePending() || session.taskStopPending()) return
        val command = buildJsonObject {
            put("type", "rewind")
            put("sessionId", event.sessionId)
            put("userIndexFromEnd", event.userIndexFromEnd)
            // pairPolicy treats an absent flag and false the same; never guess on the wire.
            if (event.restoreFiles) put("restoreFiles", true)
        }
        val attempt = DesktopRewindAttempt(++attemptId, event.userIndexFromEnd, event.restoreFiles,
            SessionCommandPhase.Waiting)
        if (!send(connection, command)) {
            // A local failure is not an observation: keep the attempt without claiming it landed.
            val after = mutableState.value
            after.session?.takeIf { it.timeline.sessionId == event.sessionId }?.let {
                mutableState.value = after.copy(session = it.copy(rewind = attempt.copy(
                    phase = SessionCommandPhase.Unconfirmed)))
            }
            return
        }
        // A rewind receipt is not part of the timeline: only this attempt id and a later frame can prove it.
        rewindEvidence = RewindEvidence(attempt.id, connection.latestSequence, connection)
        mutableState.value = state.copy(session = session.copy(rewind = attempt))
        arm(connection, Timer.Rewind, REWIND_TIMEOUT_MS)
    }

    private fun finishRewind(phase: SessionCommandPhase) {
        current?.let { cancelTimer(it, Timer.Rewind) }
        // The evidence outlives the phase: a deferred filesRestored or a late scope denial still refers to it.
        val state = mutableState.value
        val session = state.session ?: return
        val attempt = session.rewind ?: return
        mutableState.value = state.copy(session = session.copy(rewind = attempt.copy(phase = phase)))
    }

    /**
     * The desktop answers a rewind with its own receipt, then truncates the timeline: the epoch may
     * change afterwards, so neither the cursor nor `messages-truncated` can confirm the attempt.
     */
    private fun observeRewind(connection: Connection, sequence: Long, body: JsonObject,
                              session: DesktopSessionState): DesktopSessionState {
        if (body["type"].linkString() != "rewind-done") return session
        val evidence = rewindEvidence ?: return session
        val attempt = session.rewind ?: return session
        if (attempt.id != evidence.attemptId || evidence.generation !== connection ||
            session.timeline.sessionId != selectedSession || sequence <= evidence.afterSequence) return session
        if ("editorText" in body || "editorImages" in body) {
            if (attempt.phase != SessionCommandPhase.Waiting) return session
            cancelTimer(connection, Timer.Rewind)
            return session.copy(rewind = attempt.copy(phase = SessionCommandPhase.Observed,
                editorText = body["editorText"].linkString()?.takeIf { it.length <= SESSION_TEXT_LIMIT },
                // Only the count is kept; the restored draft images never enter this projection.
                editorImageCount = (body["editorImages"] as? JsonArray)?.size ?: 0))
        }
        if ("filesRestored" in body) {
            val flag = body["filesRestored"] as? JsonPrimitive
            if (flag == null || flag.isString) return session
            val restored = when (flag.content) {
                "true" -> true
                "false" -> false
                else -> return session
            }
            if (attempt.phase == SessionCommandPhase.Waiting) cancelTimer(connection, Timer.Rewind)
            return session.copy(rewind = attempt.copy(filesRestored = restored,
                phase = if (attempt.phase == SessionCommandPhase.Waiting) SessionCommandPhase.Observed
                else attempt.phase))
        }
        return session
    }

    private fun writeTaskStop(event: Event.WriteTaskStop) {
        if (!visible || event.authority !== sessionWriteAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (state.readOnly || session.loading || session.error || pendingSync != null ||
            selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            event.baseline != session.taskStopBaseline(event.kind) ||
            !event.baseline.serves(event.targetId)) return
        // A stop never needs an idle session; it only has to be the one write that owns the session.
        if (session.taskStopPending() || session.textAttempt?.phase == SessionCommandPhase.Waiting ||
            session.queueAttempt?.phase == SessionCommandPhase.Waiting || session.goalWorkPending() ||
            session.maintenancePending() || session.rewindPending()) return
        val command = buildJsonObject {
            put("type", event.kind.wire)
            put("sessionId", event.sessionId)
            put(event.kind.idField, event.targetId)
        }
        val attempt = DesktopTaskStopAttempt(++attemptId, event.kind, event.targetId, SessionCommandPhase.Waiting)
        if (!send(connection, command)) {
            // A local failure is not an observation: keep the attempt without claiming it landed.
            val after = mutableState.value
            after.session?.takeIf { it.timeline.sessionId == event.sessionId }?.let {
                mutableState.value = after.copy(session = it.copy(
                    taskStop = attempt.copy(phase = SessionCommandPhase.Unconfirmed)))
            }
            return
        }
        // The desktop has no stop receipt: only a later frame of this connection can prove it.
        taskStopEvidence = TaskStopEvidence(attempt.id, event.baseline.epoch, connection.latestSequence, connection)
        mutableState.value = state.copy(session = session.copy(taskStop = attempt))
        arm(connection, Timer.TaskStop, TASK_STOP_TIMEOUT_MS)
    }

    private fun finishTaskStop(phase: SessionCommandPhase) {
        current?.let { cancelTimer(it, Timer.TaskStop) }
        // A late scope denial still names the sent attempt, so only an observed stop drops the evidence.
        if (phase != SessionCommandPhase.Unconfirmed) taskStopEvidence = null
        val state = mutableState.value
        val session = state.session ?: return
        val attempt = session.taskStop ?: return
        mutableState.value = state.copy(session = session.copy(taskStop = attempt.copy(phase = phase)))
    }

    /**
     * A stop is observed, never acknowledged: the target must simply no longer be reported running
     * by a frame of this connection that follows the write in the same epoch and session.
     */
    private fun observeTaskStop(connection: Connection, sequence: Long,
                                session: DesktopSessionState): DesktopSessionState {
        val evidence = taskStopEvidence ?: return session
        val attempt = session.taskStop ?: return session
        if (attempt.id != evidence.attemptId || evidence.generation !== connection ||
            attempt.phase != SessionCommandPhase.Waiting ||
            session.timeline.sessionId != selectedSession || sequence <= evidence.afterSequence ||
            session.timeline.cursor?.get("epoch").linkString() != evidence.epoch) return session
        val running = when (attempt.kind) {
            SessionTaskKind.Background -> session.timeline.backgroundTasks.any {
                it.taskId == attempt.targetId && it.status == "running"
            }
            SessionTaskKind.Subagent -> session.timeline.subagents.any {
                it.id == attempt.targetId && it.status == "running"
            }
        }
        if (running) return session
        finishTaskStop(SessionCommandPhase.Observed)
        return session.copy(taskStop = attempt.copy(phase = SessionCommandPhase.Observed))
    }

    /**
     * Bot requests have no request id: one send per window, and a silent window is reported locally
     * instead of being re-sent. The projection stays readable, so a hidden retained link still gets
     * the pushes it never asked for.
     */
    private fun requestBotCatalog() {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        if (bots.catalogRequested) return
        val now = nowMillis()
        if (botCatalogSentAt?.let { now - it < BOT_RESPONSE_WINDOW_MS } == true) return
        if (!send(connection, buildJsonObject { put("type", "bot-catalog-request") })) return
        botCatalogSentAt = now
        mutableState.value = state.copy(bots = bots.copy(catalogRequested = true, error = null))
        arm(connection, Timer.BotCatalog, BOT_RESPONSE_WINDOW_MS)
    }

    private fun requestBotInbox() {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        if (bots.inboxRequested) return
        val now = nowMillis()
        if (botInboxSentAt?.let { now - it < BOT_RESPONSE_WINDOW_MS } == true) return
        if (!send(connection, buildJsonObject { put("type", "bot-inbox-request") })) return
        botInboxSentAt = now
        mutableState.value = state.copy(bots = bots.copy(inboxRequested = true, error = null))
        arm(connection, Timer.BotInbox, BOT_RESPONSE_WINDOW_MS)
    }

    /** Opening a chat starts a fresh page; paging keeps the rows already shown. */
    private fun requestBotTimeline(chatId: String, beforeSeq: Long?, open: Boolean, refresh: Boolean = false) {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        val now = nowMillis()
        val repeated = botTimelineSent?.let {
            it.chatId == chatId && it.beforeSeq == beforeSeq && now - it.at < BOT_RESPONSE_WINDOW_MS
        } == true
        // One page at a time per chat: a second request would only race the answer.
        if (repeated && !refresh || bots.timelineRequested && bots.timelineChatId == chatId) return
        val command = if (open) buildJsonObject {
            put("type", "bot-chat-open")
            put("chatId", chatId)
        } else buildJsonObject {
            put("type", "bot-timeline")
            put("chatId", chatId)
            beforeSeq?.let { put("beforeSeq", it) }
        }
        if (!send(connection, command)) return
        botTimelineSent = BotTimelineSent(chatId, beforeSeq, now)
        // Rows of another chat are never kept: a paging request for a new chat starts a fresh page too.
        val fresh = !refresh && open || bots.timelineChatId != chatId
        if (bots.timelineChatId != chatId) {
            cancelTimer(connection, Timer.BotRefresh)
            connection.botTimelineDirty = false
        }
        mutableState.value = state.copy(bots = bots.copy(timelineChatId = chatId, timelineRequested = true,
            timelineLoading = !refresh, timelineError = null,
            timeline = if (fresh) emptyList() else bots.timeline,
            timelineLastSeq = if (fresh) 0 else bots.timelineLastSeq,
            timelineHasOlder = if (fresh) false else bots.timelineHasOlder))
        arm(connection, Timer.BotTimeline, BOT_RESPONSE_WINDOW_MS)
    }

    private fun clearBotTimeline(chatId: String) {
        val state = mutableState.value
        val bots = state.bots?.takeIf { it.timelineChatId == chatId } ?: return
        current?.let {
            cancelTimer(it, Timer.BotTimeline)
            cancelTimer(it, Timer.BotRefresh)
            it.botTimelineDirty = false
        }
        botTimelineSent = null
        mutableState.value = state.copy(bots = bots.copy(timelineChatId = null, timelineRequested = false,
            timelineLoading = false, timelineError = null, timeline = emptyList(), timelineLastSeq = 0,
            timelineHasOlder = false))
    }

    private fun botTimelineChanged(connection: Connection, frame: JsonObject) {
        if (!visible) return
        val event = frame["event"] as? JsonObject ?: return
        val chatId = mutableState.value.bots?.timelineChatId ?: return
        if (event["chatId"].linkString() != chatId || event["kind"].linkString() !in BOT_REFRESH_EVENTS) return
        connection.botTimelineDirty = true
        scheduleBotRefresh(connection)
    }

    private fun scheduleBotRefresh(connection: Connection) {
        if (visible && connection.botTimelineDirty && mutableState.value.bots?.timelineRequested == false &&
            Timer.BotRefresh !in connection.timers) arm(connection, Timer.BotRefresh, 200)
    }

    /**
     * A bot write is the same foreground, authenticated, non-read-only write as any other command.
     * Its reply names the delivery id, so an expired attempt is never re-sent but still settleable.
     */
    private fun writeBotSend(event: Event.BotSend) {
        if (!visible || event.authority !== creationAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val chatId = event.chatId
        if (state.readOnly || chatId.length !in 1..BOT_TEXT_LIMIT || chatId.isBlank()) return
        val text = botMessageText(event.text) ?: return
        val bots = state.bots ?: DesktopBotsState()
        if (bots.enabled == false || bots.send?.phase == SessionCommandPhase.Waiting ||
            bots.threadAction?.phase == SessionCommandPhase.Waiting) return
        val command = buildJsonObject {
            put("type", "bot-send")
            put("chatId", chatId)
            put("text", text)
            put("deliveryId", event.deliveryId)
        }
        if (!send(connection, command)) return // A local failure is never an optimistic echo.
        noteBotWrite(BotWriteKind.Send, connection, chatId, event.deliveryId)
        mutableState.value = state.copy(bots = bots.copy(
            send = DesktopBotSendAttempt(event.deliveryId, chatId, text, SessionCommandPhase.Waiting), error = null))
        arm(connection, Timer.BotSend, BOT_SEND_TIMEOUT_MS)
    }

    /** A stop carries no delivery id and no receipt: only a running state of the same chat can settle it. */
    private fun writeBotStop(event: Event.BotStop) {
        if (!visible || event.authority !== creationAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val chatId = event.chatId
        if (state.readOnly || chatId.length !in 1..BOT_TEXT_LIMIT || chatId.isBlank()) return
        val bots = state.bots ?: DesktopBotsState()
        if (bots.enabled == false || bots.stop?.phase == SessionCommandPhase.Waiting ||
            bots.threadAction?.phase == SessionCommandPhase.Waiting) return
        if (!send(connection, buildJsonObject { put("type", "bot-stop"); put("chatId", chatId) })) return
        noteBotWrite(BotWriteKind.Stop, connection, chatId, null)
        botStopWrite = botWrites.last()
        mutableState.value = state.copy(bots = bots.copy(
            stop = DesktopBotStopAttempt(chatId, SessionCommandPhase.Waiting), error = null))
        arm(connection, Timer.BotStop, BOT_STOP_TIMEOUT_MS)
    }

    /** Generic denials carry no id, so the send order is what keeps a late denial off a newer attempt. */
    private fun noteBotWrite(kind: BotWriteKind, connection: Connection, chatId: String, deliveryId: String?) {
        if (botWrites.size >= BOT_WRITE_LIMIT) botWrites.removeAt(0)
        botWrites.add(BotWrite(kind, connection, chatId, deliveryId, connection.latestSequence))
    }

    private fun writeBotThread(event: Event.ChangeBotThread) {
        if (!visible || event.authority !== creationAuthority) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val bots = state.bots ?: return
        val active = bots.activeBotThread(event.rootId) ?: return
        if (state.readOnly || bots.enabled != true || !bots.threadsEnabled || active.id != event.expectedActiveId ||
            bots.threadAction?.phase == SessionCommandPhase.Waiting || bots.send?.phase == SessionCommandPhase.Waiting ||
            bots.stop?.phase == SessionCommandPhase.Waiting || event.rootId.length !in 1..128) return
        val target = event.targetId
        when (event.command) {
            BotThreadCommand.Create -> if (target != null) return
            BotThreadCommand.Select -> if (target == null || target.length !in 1..128 || target == active.id ||
                target != event.rootId && bots.threads.none { it.id == target && it.parentId == event.rootId && !it.archived }) return
        }
        val requestId = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", event.command.wire); put("chatId", event.rootId); put("requestId", requestId)
            target?.let { put("threadId", it) }
        })) return
        mutableState.value = state.copy(bots = bots.copy(threadAction = DesktopBotThreadAction(
            requestId, event.rootId, event.command, target, SessionCommandPhase.Waiting)))
        arm(connection, Timer.BotThread, BOT_SEND_TIMEOUT_MS)
    }

    private fun botThreadResult(connection: Connection, frame: JsonObject, sequence: Long) {
        val ok = frame["ok"].desktopFlag() ?: return
        val error = frame["error"].linkString()?.takeIf { it.isNotBlank() && it.length <= BOT_TEXT_LIMIT }
        if (!ok && error == "read-only") {
            connection.noteScopeDenial(sequence)
            sessionWriteAuthority = null
            mutableState.value = mutableState.value.copy(readOnly = true)
        }
        val state = mutableState.value
        val bots = state.bots ?: return
        val action = bots.threadAction ?: return
        if (action.requestId != frame["requestId"].linkString() || action.rootId != frame["chatId"].linkString() ||
            action.phase !in setOf(SessionCommandPhase.Waiting, SessionCommandPhase.Unconfirmed)) return
        val result = if (ok) desktopFileName(frame["threadId"], 128) ?: return else null
        if (ok && (action.command == BotThreadCommand.Select && result != action.targetId ||
                action.command == BotThreadCommand.Create && result == action.rootId)) return
        cancelTimer(connection, Timer.BotThread)
        mutableState.value = state.copy(bots = bots.copy(threadAction = action.copy(
            phase = if (ok) SessionCommandPhase.Observed else SessionCommandPhase.Rejected,
            resultId = result, error = if (ok) null else error)))
    }

    private fun botThreadTimeout() {
        val state = mutableState.value
        val bots = state.bots ?: return
        val action = bots.threadAction?.takeIf { it.phase == SessionCommandPhase.Waiting } ?: return
        mutableState.value = state.copy(bots = bots.copy(threadAction = action.copy(phase = SessionCommandPhase.Unconfirmed)))
    }

    private fun botSendTimeout() {
        val state = mutableState.value
        val bots = state.bots ?: return
        val attempt = bots.send ?: return
        if (attempt.phase != SessionCommandPhase.Waiting) return
        mutableState.value = state.copy(bots = bots.copy(
            send = attempt.copy(phase = SessionCommandPhase.Unconfirmed)))
    }

    private fun botStopTimeout() {
        val state = mutableState.value
        val bots = state.bots ?: return
        val attempt = bots.stop ?: return
        if (attempt.phase != SessionCommandPhase.Waiting) return
        mutableState.value = state.copy(bots = bots.copy(
            stop = attempt.copy(phase = SessionCommandPhase.Unconfirmed)))
    }

    /** The answer names the chat and the delivery id; anything else is another attempt's business. */
    private fun botSendResult(connection: Connection, frame: JsonObject, sequence: Long) {
        val ok = frame["ok"].desktopFlag() ?: return
        val error = frame["error"].linkString()?.takeIf { it.isNotBlank() && it.length <= BOT_TEXT_LIMIT }
        val denied = !ok && error == "read-only"
        if (denied) {
            connection.noteScopeDenial(sequence)
            sessionWriteAuthority = null
            mutableState.value = mutableState.value.copy(readOnly = true)
        }
        val state = mutableState.value
        val bots = state.bots ?: return
        val attempt = bots.send ?: return
        if (frame["chatId"].linkString() != attempt.chatId ||
            frame["deliveryId"].linkString() != attempt.deliveryId) return
        if (attempt.phase != SessionCommandPhase.Waiting && attempt.phase != SessionCommandPhase.Unconfirmed) return
        cancelTimer(connection, Timer.BotSend)
        botWrites.removeAll { it.kind == BotWriteKind.Send && it.deliveryId == attempt.deliveryId }
        mutableState.value = state.copy(bots = bots.copy(send = attempt.copy(
            phase = if (ok) SessionCommandPhase.Observed else SessionCommandPhase.Rejected,
            error = if (ok) null else error)))
    }

    /** One chat's running state; a bad row is dropped without touching the other chats. */
    private fun botChatState(connection: Connection, frame: JsonObject, sequence: Long) {
        val next = desktopBotChatState(frame) ?: return
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        if (next.chatId !in bots.chatStates && bots.chatStates.size >= BOT_CHAT_STATE_LIMIT) return
        if (sequence <= (connection.botChatSequences[next.chatId] ?: 0L)) return
        connection.botChatSequences[next.chatId] = sequence
        var updated = bots.copy(chatStates = bots.chatStates + (next.chatId to next), error = null)
        val stop = updated.stop
        // current == null is the desktop's own "nothing running" answer, even with a queue still listed.
        val evidence = botStopWrite?.takeIf { it.generation === connection }
        if (stop != null && stop.phase == SessionCommandPhase.Waiting && stop.chatId == next.chatId &&
            next.current == null && evidence?.chatId == stop.chatId && sequence > evidence.afterSequence) {
            cancelTimer(connection, Timer.BotStop)
            botWrites.remove(evidence)
            updated = updated.copy(stop = stop.copy(phase = SessionCommandPhase.Observed))
        }
        mutableState.value = state.copy(bots = updated)
    }

    /**
     * The denial names only the command, so the oldest unsettled write of that command is the one it
     * answers. Without evidence, the permission downgrade is still real, but not a delivery result.
     */
    private fun rejectBotWrite(connection: Connection, sequence: Long, kind: BotWriteKind) {
        val state = mutableState.value
        val bots = state.bots ?: return
        val entry = botWrites.firstOrNull {
            it.kind == kind && it.generation === connection && it.afterSequence < sequence
        }?.also { botWrites.remove(it) }
        val settleable = setOf(SessionCommandPhase.Waiting, SessionCommandPhase.Unconfirmed)
        if (kind == BotWriteKind.Send) {
            val attempt = bots.send ?: return
            val matches = entry?.deliveryId == attempt.deliveryId
            if (!matches || attempt.phase !in settleable) return
            cancelTimer(connection, Timer.BotSend)
            mutableState.value = state.copy(bots = bots.copy(
                send = attempt.copy(phase = SessionCommandPhase.Rejected)))
        } else {
            val attempt = bots.stop ?: return
            val matches = entry != null && entry === botStopWrite
            if (!matches || attempt.phase !in settleable) return
            cancelTimer(connection, Timer.BotStop)
            mutableState.value = state.copy(bots = bots.copy(
                stop = attempt.copy(phase = SessionCommandPhase.Rejected)))
        }
    }

    /** A silent request is reported once; the association survives so a late frame still lands. */
    private fun botTimeout(kind: Timer) {
        val state = mutableState.value
        val bots = state.bots ?: return
        val next = when (kind) {
            Timer.BotCatalog -> bots.takeIf { it.catalogRequested }
                ?.copy(catalogRequested = false, error = BOT_NO_RESPONSE)
            Timer.BotInbox -> bots.takeIf { it.inboxRequested }
                ?.copy(inboxRequested = false, error = BOT_NO_RESPONSE)
            Timer.BotTimeline -> bots.takeIf { it.timelineRequested }
                ?.copy(timelineRequested = false, timelineLoading = false, timelineError = BOT_NO_RESPONSE)
            else -> null
        } ?: return
        mutableState.value = state.copy(bots = next)
    }

    /** Bot pushes are independent of the selected session and never carry a request id. */
    private fun botFrame(connection: Connection, frame: JsonObject, sequence: Long): Boolean {
        val type = frame["type"].linkString() ?: return false
        if (type !in BOT_FRAME_TYPES) return false
        if (!online(connection)) return true
        when (type) {
            "bot-catalog" -> if (sequence > connection.botCatalogSequence) {
                connection.botCatalogSequence = sequence
                botCatalog(connection, frame)
            }
            "bot-chats" -> if (sequence > connection.botChatsSequence) {
                connection.botChatsSequence = sequence
                botChats(frame)
            }
            "bot-inbox" -> botInbox(connection, frame)
            "bot-activity" -> botActivity(frame)
            "group-timeline" -> groupTimeline(connection, frame)
            "bot-chat-state" -> botChatState(connection, frame, sequence)
            "bot-send-result" -> botSendResult(connection, frame, sequence)
            "bot-event" -> botTimelineChanged(connection, frame)
            "bot-thread-result" -> botThreadResult(connection, frame, sequence)
        }
        return true
    }

    /** Any answer settles the request; a disabled catalog never lists members and never invents an error. */
    private fun botCatalog(connection: Connection, frame: JsonObject) {
        cancelTimer(connection, Timer.BotCatalog)
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        val settled = bots.copy(catalogRequested = false, error = null)
        val enabled = frame["enabled"].desktopFlag()
        if (enabled == null) {
            mutableState.value = state.copy(bots = settled)
            return
        }
        mutableState.value = state.copy(bots = settled.copy(enabled = enabled,
            threadsEnabled = enabled && frame["threads"].desktopFlag() == true,
            members = if (enabled) desktopBotMembers(frame["bots"]) ?: bots.members else emptyList()))
    }

    private fun botChats(frame: JsonObject) {
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        val chats = desktopBotChats(frame["chats"])
        val roots = chats?.filter { it.kind == "group" && it.parentId == null && !it.archived }?.map { it.id }?.toSet().orEmpty()
        val ids = chats?.map { it.id }?.toSet().orEmpty()
        val threads = desktopBotChats(frame["threads"]).orEmpty().filter {
            it.kind == "group" && !it.archived && it.id !in ids && it.parentId in roots
        }
        mutableState.value = state.copy(bots = if (chats == null) bots.copy(error = null)
        else bots.copy(chats = chats, threads = threads, error = null))
    }

    /** A whole inbox table: the previous rows are never merged into a new one. */
    private fun botInbox(connection: Connection, frame: JsonObject) {
        cancelTimer(connection, Timer.BotInbox)
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        val settled = bots.copy(inboxRequested = false, error = null)
        val items = desktopBotInbox(frame["items"])
        mutableState.value = state.copy(bots = if (items == null) settled else settled.copy(inbox = items))
    }

    /** The frame's `now` is the host clock; an unusable table leaves the previous one in place. */
    private fun botActivity(frame: JsonObject) {
        val state = mutableState.value
        val bots = state.bots ?: DesktopBotsState()
        val read = desktopBotActivity(frame)
        mutableState.value = state.copy(bots = if (read == null) bots.copy(error = null)
        else bots.copy(activityNow = read.now, activity = read.items, error = null))
    }

    /** A page for a chat that is no longer open is not this screen's answer. */
    private fun groupTimeline(connection: Connection, frame: JsonObject) {
        val state = mutableState.value
        val bots = state.bots ?: return
        val chatId = desktopFileName(frame["chatId"], BOT_TEXT_LIMIT) ?: return
        if (chatId != bots.timelineChatId) return
        cancelTimer(connection, Timer.BotTimeline)
        val settled = bots.copy(timelineRequested = false, timelineLoading = false, timelineError = null)
        val entries = desktopGroupEntries(frame["entries"])
        val lastSeq = frame["lastSeq"].linkIndex()
        val hasOlder = frame["hasOlder"].desktopFlag()
        val older = "beforeSeq" in frame
        val beforeSeq = frame["beforeSeq"].linkIndex()
        if (entries == null || lastSeq == null || hasOlder == null || older && beforeSeq == null) {
            mutableState.value = state.copy(bots = settled.copy(timelineError = BOT_INVALID_ERROR))
            return
        }
        mutableState.value = state.copy(bots = settled.copy(
            timeline = mergeGroupEntries(bots.timeline, entries, older),
            timelineLastSeq = lastSeq, timelineHasOlder = hasOlder))
        scheduleBotRefresh(connection)
    }

    /**
     * A listing is read-only, so a read-only host still answers it. It only needs the visible,
     * authenticated screen that asked and the same selected session; the answer carries no session.
     */
    private fun requestFileList(sessionId: String) {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != sessionId || session.timeline.sessionId != sessionId ||
            sessionId.length !in 1..FILE_TEXT_LIMIT) return
        val files = session.files ?: DesktopFilesState()
        if (files.listing) return // One listing in flight; a repeat click is not a second request.
        val requestId = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", "file-list")
            put("requestId", requestId)
            putJsonObject("target") { put("sessionId", sessionId) }
        })) {
            // A local failure is not an empty listing. A retired connection has already dropped the
            // projection, so only a still-live one can carry the error; never claim success either way.
            if (current === connection) localFileError(sessionId, listError = FILE_SEND_ERROR)
            return
        }
        fileListPending = FileListPending(requestId, sessionId, connection)
        mutableState.value = state.copy(session = session.copy(files = files.copy(listing = true, listError = null)))
        arm(connection, Timer.FileList, FILE_TIMEOUT_MS)
    }

    /** One block of one desktop-authored file id; the display-only `rel` never travels back. */
    private fun requestFileRead(event: Event.ReadFile) {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            event.sessionId.length !in 1..FILE_TEXT_LIMIT || event.fileId.length !in 1..FILE_TEXT_LIMIT ||
            event.fileId.isBlank() || event.offset !in 0..MAX_SAFE_INTEGER) return
        val files = session.files ?: DesktopFilesState()
        if (files.reading) return // One read in flight; the next block waits for this one.
        val requestId = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", "file-read")
            put("requestId", requestId)
            putJsonObject("target") { put("sessionId", event.sessionId) }
            put("fileId", event.fileId)
            put("offset", event.offset)
        })) {
            if (current === connection) localFileError(event.sessionId, readError = FILE_SEND_ERROR)
            return
        }
        fileReadPending = FileReadPending(requestId, event.sessionId, event.fileId, event.offset, connection)
        mutableState.value = state.copy(session = session.copy(files = files.copy(reading = true,
            readingFileId = event.fileId, readOffset = event.offset, readError = null)))
        arm(connection, Timer.FileRead, FILE_TIMEOUT_MS)
    }

    private fun finishFileList() {
        current?.let { cancelTimer(it, Timer.FileList) }
        fileListPending = null
    }

    /** A local send failure is never an answer; only the error of the still-current projection may change. */
    private fun localFileError(sessionId: String, listError: String? = null, readError: String? = null) {
        val state = mutableState.value
        val session = state.session?.takeIf { it.timeline.sessionId == sessionId } ?: return
        val files = session.files ?: DesktopFilesState()
        mutableState.value = state.copy(session = session.copy(files = files.copy(
            listing = if (listError == null) files.listing else false,
            listError = listError ?: files.listError,
            reading = if (readError == null) files.reading else false,
            readError = readError ?: files.readError)))
    }

    private fun finishFileRead() {
        current?.let { cancelTimer(it, Timer.FileRead) }
        fileReadPending = null
    }

    /** A result settles only the request it names, on the connection that sent it, for the same selection. */
    private fun fileListResult(connection: Connection, frame: JsonObject) {
        val pending = fileListPending ?: return
        if (pending.generation !== connection || frame["requestId"].linkString() != pending.requestId) return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != pending.sessionId || session.timeline.sessionId != pending.sessionId) return
        val files = session.files ?: DesktopFilesState()
        finishFileList()
        val error = frame["error"].linkString()
        if (error != null) {
            // The host's own reason is user-facing; the last good listing stays visible.
            mutableState.value = state.copy(session = session.copy(files = files.copy(listing = false,
                listError = error.takeIf { it.isNotEmpty() } ?: FILE_INVALID_ERROR)))
            return
        }
        val entries = desktopFileEntries(frame["files"])
        mutableState.value = state.copy(session = session.copy(files = files.copy(listing = false,
            listError = if (entries == null) FILE_INVALID_ERROR else null,
            entries = entries ?: files.entries)))
    }

    /** Only the requested offset, a non-negative size and one bounded standard Base64 block are a chunk. */
    private fun fileReadResult(connection: Connection, frame: JsonObject) {
        val pending = fileReadPending ?: return
        if (pending.generation !== connection || frame["requestId"].linkString() != pending.requestId) return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != pending.sessionId || session.timeline.sessionId != pending.sessionId) return
        val files = session.files ?: DesktopFilesState()
        finishFileRead()
        val error = frame["error"].linkString()
        if (error != null) {
            mutableState.value = state.copy(session = session.copy(files = files.copy(reading = false,
                readError = error.takeIf { it.isNotEmpty() } ?: FILE_INVALID_ERROR)))
            return
        }
        // A missing name falls back to the listing; a malformed one invalidates the whole answer.
        val named = "name" in frame
        val name = if (named) desktopFileName(frame["name"])
        else files.entries.find { it.id == pending.fileId }?.name
        val size = frame["size"].linkIndex()
        val offset = frame["offset"].linkIndex()
        val data = desktopFileData(frame["data"])
        val next = if ((named && name == null) || size == null || offset != pending.offset || data == null) {
            // A drifted or malformed block is an error, not a shorter file.
            files.copy(reading = false, readError = FILE_INVALID_ERROR)
        } else files.copy(reading = false, readError = null, readOffset = offset,
            chunk = DesktopFileChunk(pending.fileId, name, size, offset, data))
        mutableState.value = state.copy(session = session.copy(files = next))
    }

    /** The association survives the timeout so a late, still matching answer is accepted. */
    private fun fileListTimeout() {
        val pending = fileListPending ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != pending.sessionId || session.timeline.sessionId != pending.sessionId) return
        val files = session.files ?: DesktopFilesState()
        if (!files.listing) return
        mutableState.value = state.copy(session = session.copy(files = files.copy(listing = false,
            listError = FILE_TIMEOUT_ERROR)))
    }

    private fun fileReadTimeout() {
        val pending = fileReadPending ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != pending.sessionId || session.timeline.sessionId != pending.sessionId) return
        val files = session.files ?: DesktopFilesState()
        if (!files.reading) return
        mutableState.value = state.copy(session = session.copy(files = files.copy(reading = false,
            readError = FILE_TIMEOUT_ERROR)))
    }

    /**
     * Listing shares the single preview channel: the desktop runs one preview operation at a time, so
     * a second request while one is in flight is refused rather than queued behind it.
     */
    private fun requestPreviewList(sessionId: String) {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != sessionId || session.timeline.sessionId != sessionId ||
            sessionId.length !in 1..PREVIEW_TEXT_LIMIT) return
        val preview = session.preview ?: DesktopPreviewState()
        if (preview.busy) return
        val requestId = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", PreviewRequest.List.wire)
            put("requestId", requestId)
            putJsonObject("target") { put("sessionId", sessionId) }
        })) {
            // A local failure is not an empty listing; never claim either outcome.
            if (current === connection) localPreviewFailure(sessionId, PreviewRequest.List)
            return
        }
        previewPending = PreviewPending(requestId, sessionId, PreviewRequest.List, connection)
        mutableState.value = state.copy(session = session.copy(preview = preview.copy(listing = true, busy = true,
            listError = null)))
        arm(connection, Timer.Preview, PREVIEW_TIMEOUT_MS)
    }

    /** One listed entry at the viewport the phone asked for; the answer carries the frame to paint. */
    private fun requestPreviewOpen(event: Event.OpenPreview) {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            event.sessionId.length !in 1..PREVIEW_TEXT_LIMIT ||
            event.entryId.length !in 1..PREVIEW_TEXT_LIMIT || event.entryId.isBlank() ||
            event.width !in 1..PREVIEW_SIZE_LIMIT || event.height !in 1..PREVIEW_SIZE_LIMIT) return
        val preview = session.preview ?: DesktopPreviewState()
        if (preview.busy) return
        val requestId = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", PreviewRequest.Open.wire)
            put("requestId", requestId)
            putJsonObject("target") { put("sessionId", event.sessionId) }
            put("entryId", event.entryId)
            put("width", event.width)
            put("height", event.height)
        })) {
            if (current === connection) localPreviewFailure(event.sessionId, PreviewRequest.Open)
            return
        }
        previewPending = PreviewPending(requestId, event.sessionId, PreviewRequest.Open, connection)
        mutableState.value = state.copy(session = session.copy(preview = preview.copy(busy = true, error = null)))
        arm(connection, Timer.Preview, PREVIEW_TIMEOUT_MS)
    }

    private fun requestPreviewAction(event: Event.PreviewAction) {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            event.sessionId.length !in 1..PREVIEW_TEXT_LIMIT) return
        val preview = session.preview ?: return
        val previewId = preview.previewId?.takeIf { it.length in 1..PREVIEW_TEXT_LIMIT } ?: return
        if (preview.busy) return
        val request = when (event.action) {
            DesktopPreviewAction.Frame -> PreviewRequest.Frame
            DesktopPreviewAction.Refresh -> PreviewRequest.Refresh
            DesktopPreviewAction.Close -> PreviewRequest.Close
        }
        val requestId = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", request.wire)
            put("requestId", requestId)
            put("previewId", previewId)
        })) {
            if (current === connection) localPreviewFailure(event.sessionId, request)
            return
        }
        previewPending = PreviewPending(requestId, event.sessionId, request, connection)
        mutableState.value = state.copy(session = session.copy(preview = preview.copy(busy = true, error = null)))
        arm(connection, Timer.Preview, PREVIEW_TIMEOUT_MS)
    }

    /** A gesture names both the preview and the exact frame it was aimed at. */
    private fun requestPreviewInput(event: Event.PreviewInput) {
        if (!visible) return
        val connection = current?.takeIf(::online) ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != event.sessionId || session.timeline.sessionId != event.sessionId ||
            event.sessionId.length !in 1..PREVIEW_TEXT_LIMIT) return
        val preview = session.preview ?: return
        val previewId = preview.previewId?.takeIf { it.length in 1..PREVIEW_TEXT_LIMIT } ?: return
        val frame = preview.frame ?: return
        if (preview.busy) return
        // An input that cannot be aimed at the current frame is refused before it can move the page.
        val input = previewInputJson(event.input, frame) ?: return
        val requestId = UUID.randomUUID().toString()
        if (!send(connection, buildJsonObject {
            put("type", PreviewRequest.Input.wire)
            put("requestId", requestId)
            put("previewId", previewId)
            put("frameId", frame.frameId)
            put("input", input)
        })) {
            if (current === connection) localPreviewFailure(event.sessionId, PreviewRequest.Input)
            return
        }
        previewPending = PreviewPending(requestId, event.sessionId, PreviewRequest.Input, connection)
        mutableState.value = state.copy(session = session.copy(preview = preview.copy(busy = true, error = null)))
        arm(connection, Timer.Preview, PREVIEW_TIMEOUT_MS)
    }

    /** A local send failure is never an answer; only a still-current projection may carry the error. */
    private fun localPreviewFailure(sessionId: String, request: PreviewRequest) {
        val state = mutableState.value
        val session = state.session?.takeIf { it.timeline.sessionId == sessionId } ?: return
        val preview = session.preview ?: DesktopPreviewState()
        mutableState.value = state.copy(session = session.copy(preview = if (request == PreviewRequest.List)
            preview.copy(listing = false, busy = false, listError = PREVIEW_SEND_ERROR)
        else preview.copy(busy = false, error = PREVIEW_SEND_ERROR)))
    }

    private fun finishPreview() {
        current?.let { cancelTimer(it, Timer.Preview) }
        previewPending = null
    }

    /** A result settles only the request it names, on the connection that sent it, for the same selection. */
    private fun previewListResult(connection: Connection, frame: JsonObject) {
        val pending = previewPending ?: return
        if (pending.request != PreviewRequest.List || pending.generation !== connection ||
            frame["requestId"].linkString() != pending.requestId) return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != pending.sessionId || session.timeline.sessionId != pending.sessionId) return
        val preview = session.preview ?: DesktopPreviewState()
        finishPreview()
        val error = frame["error"].linkString()
        if (error != null) {
            // The host's own reason is user-facing; the last good listing stays visible.
            mutableState.value = state.copy(session = session.copy(preview = preview.copy(listing = false,
                busy = false, listError = error.takeIf { it.isNotEmpty() } ?: PREVIEW_INVALID_ERROR)))
            return
        }
        val entries = desktopPreviewEntries(frame["entries"])
        mutableState.value = state.copy(session = session.copy(preview = preview.copy(listing = false, busy = false,
            listError = if (entries == null) PREVIEW_INVALID_ERROR else null,
            entries = entries ?: preview.entries)))
    }

    private fun previewResult(connection: Connection, frame: JsonObject) {
        val pending = previewPending ?: return
        if (pending.request == PreviewRequest.List || pending.generation !== connection ||
            frame["requestId"].linkString() != pending.requestId) return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != pending.sessionId || session.timeline.sessionId != pending.sessionId) return
        val preview = session.preview ?: DesktopPreviewState()
        finishPreview()
        val error = frame["error"].linkString()
        if (error != null) {
            // An error keeps the last good frame: the error explains why it did not move.
            mutableState.value = state.copy(session = session.copy(preview = preview.copy(busy = false,
                error = error.takeIf { it.isNotEmpty() } ?: PREVIEW_INVALID_ERROR)))
            return
        }
        if (pending.request == PreviewRequest.Close) {
            // A closed preview names nothing; dropping the id and frame is how "no preview" is shown.
            mutableState.value = state.copy(session = session.copy(preview = preview.copy(busy = false, error = null,
                previewId = null, frame = null)))
            return
        }
        val next = desktopPreviewFrame(frame["frame"])
        if (next == null) {
            mutableState.value = state.copy(session = session.copy(preview = preview.copy(busy = false,
                error = PREVIEW_INVALID_ERROR)))
            return
        }
        val previewId = frame["previewId"].linkString()?.takeIf { it.length in 1..PREVIEW_TEXT_LIMIT }
        mutableState.value = state.copy(session = session.copy(preview = preview.copy(busy = false, error = null,
            previewId = previewId ?: preview.previewId, frame = next)))
    }

    /** The association survives the timeout so a late, still matching answer is accepted. */
    private fun previewTimeout() {
        val pending = previewPending ?: return
        val state = mutableState.value
        val session = state.session ?: return
        if (selectedSession != pending.sessionId || session.timeline.sessionId != pending.sessionId) return
        val preview = session.preview ?: return
        if (!preview.busy) return
        mutableState.value = state.copy(session = session.copy(preview = if (pending.request == PreviewRequest.List)
            preview.copy(listing = false, busy = false, listError = PREVIEW_TIMEOUT_ERROR)
        else preview.copy(busy = false, error = PREVIEW_TIMEOUT_ERROR)))
    }

    /** No wire receipt: only a new authoritative user message is evidence, never a WS send or status change. */
    private fun observeSessionCommands(connection: Connection, session: DesktopSessionState): DesktopSessionState {
        val priorTextDeadline = textDeadline
        val priorStopDeadline = stopDeadline
        val attempt = session.textAttempt
        val timeline = session.timeline
        val evidence = textEvidence
        var next = session
        if (attempt != null && evidence != null) {
            if (timeline.cursor?.get("epoch").linkString() != evidence.epoch) {
                textEvidence = null
                textDeadline = null
                next = next.copy(textAttempt = attempt.copy(phase = SessionCommandPhase.Unconfirmed))
            } else if (cursorSequence(timeline.cursor) > evidence.sequence && timeline.messages.asReversed().any { message ->
                    message.index >= evidence.firstNewIndex && message.role == "user" &&
                        attempt.matchesUserContent(message.content)
                }) {
                textEvidence = null
                textDeadline = null
                next = next.copy(textAttempt = attempt.copy(phase = SessionCommandPhase.Observed))
            }
        }
        if (!session.running) {
            stopDeadline = null
            next = next.copy(stopPhase = null)
        }
        if (textDeadline != priorTextDeadline || stopDeadline != priorStopDeadline) armSessionCommands(connection)
        return next
    }

    private fun armSessionCommands(connection: Connection) {
        cancelTimer(connection, Timer.SessionCommands)
        listOfNotNull(textDeadline, stopDeadline).minOrNull()?.let {
            arm(connection, Timer.SessionCommands, (it - nowMillis()).coerceAtLeast(1))
        }
    }

    /** Called only after both FrameReplay authentication and generation checks. No bootstrap staging. */
    private fun sessionFrame(connection: Connection, frame: JsonObject, sequence: Long) {
        if (!online(connection)) return
        val rejection = frame["command"].linkString()?.takeIf {
            frame["type"].linkString() == "command-rejected" && frame["error"].linkString() == "read-only"
        }
        val queueRejection = rejection != null && QueueCommand.entries.any { it.wire == rejection }
        val goalRejection = rejection != null && GoalCommand.entries.any { it.wire == rejection }
        val maintenanceRejection = rejection != null && SessionMaintenanceCommand.entries.any { it.wire == rejection }
        val rewindRejection = rejection == "rewind"
        val taskStopRejection = rejection != null && SessionTaskKind.entries.any { it.wire == rejection }
        val botSendRejection = rejection == "bot-send"
        val botStopRejection = rejection == "bot-stop"
        if (queueRejection || goalRejection || maintenanceRejection || rewindRejection || taskStopRejection ||
            botSendRejection || botStopRejection ||
            rejection in setOf("approval-respond", "ask-respond", "prompt", "steer", "abort", "spawn")) {
            // The denial is authoritative for this connection even if its originating request timed out.
            mutableState.value = mutableState.value.copy(readOnly = true)
            pendingCreation?.firstText = null
            sessionWriteAuthority = null
        }
        if (botSendRejection || botStopRejection) {
            connection.noteScopeDenial(sequence)
            // Bot writes are independent of the selected session, so this never waits for one.
            rejectBotWrite(connection, sequence,
                if (botSendRejection) BotWriteKind.Send else BotWriteKind.Stop)
            return
        }
        if (queueRejection) {
            // Generic scope denials lack session/message IDs. Only settle the current generation's matching attempt.
            connection.noteScopeDenial(sequence)
            val attempt = mutableState.value.session?.queueAttempt
            if (attempt != null && queueEvidence?.attemptId == attempt.id && attempt.command.wire == rejection) {
                finishQueue(SessionCommandPhase.Rejected)
            }
            return
        }
        if (goalRejection) {
            connection.noteScopeDenial(sequence)
            val attempt = mutableState.value.session?.goalAttempt
            val evidence = goalEvidence
            if (attempt != null && evidence != null && attempt.id == evidence.attemptId &&
                attempt.command.wire == rejection && sequence > evidence.afterSequence) {
                finishGoal(SessionCommandPhase.Rejected)
            }
            return
        }
        if (maintenanceRejection) {
            connection.noteScopeDenial(sequence)
            val attempt = mutableState.value.session?.maintenance
            val evidence = maintenanceEvidence
            // Matching ID and command keep an older denial from settling a newer attempt.
            if (attempt != null && evidence != null && evidence.generation === connection &&
                attempt.id == evidence.attemptId && attempt.command.wire == rejection &&
                sequence > evidence.afterFrame) {
                finishMaintenance(SessionCommandPhase.Rejected)
            }
            return
        }
        if (rewindRejection) {
            connection.noteScopeDenial(sequence)
            // The denial carries no session or attempt id, so only the sent attempt on this frame order may settle.
            val attempt = mutableState.value.session?.rewind
            val evidence = rewindEvidence
            if (attempt != null && evidence != null && evidence.generation === connection &&
                attempt.id == evidence.attemptId && sequence > evidence.afterSequence) {
                finishRewind(SessionCommandPhase.Rejected)
            }
            return
        }
        if (taskStopRejection) {
            connection.noteScopeDenial(sequence)
            // The denial carries no attempt or target id; only the sent attempt on a later frame may settle.
            val attempt = mutableState.value.session?.taskStop
            val evidence = taskStopEvidence
            if (attempt != null && evidence != null && evidence.generation === connection &&
                attempt.id == evidence.attemptId && attempt.kind.wire == rejection &&
                sequence > evidence.afterSequence) {
                finishTaskStop(SessionCommandPhase.Rejected)
            }
            return
        }
        if (rejection == "spawn") {
            // This generic rejection has no ID. It also fences off an older, reordered host-info.
            connection.noteScopeDenial(sequence)
            liveCreation()?.let { finishCreation(CreationPhase.Rejected) }
            return
        }
        val session = mutableState.value.session ?: return
        val id = selectedSession ?: return
        when (frame["type"].linkString()) {
            "file-list-result" -> fileListResult(connection, frame)
            "file-read-result" -> fileReadResult(connection, frame)
            "preview-list-result" -> previewListResult(connection, frame)
            "preview-result" -> previewResult(connection, frame)
            "session-sync" -> {
                val pending = pendingSync ?: return
                if (!pending.sent || frame["sessionId"].linkString() != id ||
                    frame["requestId"].linkString() != pending.requestId) return
                val next = SessionTimelineReducer.sync(session.timeline, frame)
                if (next == null) {
                    finishCreation(CreationPhase.Unconfirmed)
                    if (pending.attempts < SYNC_ATTEMPTS) requestSync(connection, useCursor = false, attempts = pending.attempts)
                    return
                }
                val observed = pending.observed
                val needsMore = pending.mixed || observed != null && (observed["epoch"] != next.cursor?.get("epoch") ||
                    cursorSequence(observed) > cursorSequence(next.cursor))
                pendingSync = null
                cancelTimer(connection, Timer.SessionSync)
                settleResolvedResponses(next)
                // A full snapshot replaces the projection rather than acknowledging a write.
                val unknown = frame["mode"].linkString() == "snapshot" && pendingResponses.isNotEmpty()
                if (unknown) {
                    failedResponses.addAll(pendingResponses.keys)
                    pendingResponses.clear()
                }
                armResponses(connection)
                val epochChanged = session.timeline.cursor != null &&
                    session.timeline.cursor?.get("epoch") != next.cursor?.get("epoch")
                if (epochChanged) {
                    authoritativeQueue = null
                    queueEvidence = null
                    queueDeadline = null
                    cancelTimer(connection, Timer.QueueCommands)
                    clearGoalAuthority(connection.latestSequence)
                    maintenanceEvidence = null
                    cancelTimer(connection, Timer.Maintenance)
                }
                val synced = session.copy(timeline = next, loading = needsMore,
                    queued = if (epochChanged) emptyList() else session.queued,
                    queueReady = !epochChanged && session.queueReady,
                    queueAttempt = if (epochChanged && session.queueAttempt?.phase == SessionCommandPhase.Waiting)
                        session.queueAttempt.copy(phase = SessionCommandPhase.Unconfirmed) else session.queueAttempt,
                    goalReady = !epochChanged && session.goalReady,
                    goalAttempt = if (epochChanged) session.goalAttempt.withoutGoalEvidence() else session.goalAttempt,
                    maintenance = if (epochChanged && session.maintenance?.phase == SessionCommandPhase.Waiting)
                        session.maintenance.copy(phase = SessionCommandPhase.Unconfirmed) else session.maintenance,
                    rewind = if (epochChanged && session.rewind?.phase == SessionCommandPhase.Waiting)
                        session.rewind.copy(phase = SessionCommandPhase.Unconfirmed) else session.rewind,
                    taskStop = if (epochChanged && session.taskStop?.phase == SessionCommandPhase.Waiting)
                        session.taskStop.copy(phase = SessionCommandPhase.Unconfirmed) else session.taskStop,
                    compaction = if (epochChanged) null else session.compaction,
                    error = false, loadingHistory = false, hasMoreHistory = next.baseIndex > 0,
                    pendingResponses = pendingResponses.keys.toSet(), responseFailed = failedResponses.isNotEmpty(), historyLimitReached = false)
                mutableState.value = mutableState.value.copy(session = if (needsMore) synced
                    else observeMaintenance(connection, observeSessionCommands(connection, synced), null))
                if (needsMore) requestSync(connection, useCursor = true, attempts = pending.attempts)
                else {
                    refreshSessionWriteAuthority()
                    sendFirstText(synced)
                }
            }
            "agent-event" -> {
                val body = frame["event"] as? JsonObject ?: return
                val type = body["type"].linkString()
                val eventId = body["sessionId"].linkString() ?: (body["identity"] as? JsonObject)?.get("sessionId").linkString()
                if (type == "worker-exited" && eventId == null) {
                    finishCreation(CreationPhase.Unconfirmed)
                    val attempts = pendingSync?.attempts ?: 0
                    if (attempts < SYNC_ATTEMPTS) requestSync(connection, useCursor = false, attempts = attempts)
                    return
                }
                if (eventId != id) return
                pendingSync?.let { pending ->
                    val cursor = (frame["cursor"] as? JsonObject)?.takeIf(SessionSync::isCursor) ?: return
                    // Once this session changes during the initial baseline, its draft is manual-only.
                    pendingCreation?.firstText = null
                    val observed = pending.observed
                    if (observed == null) pending.observed = cursor
                    else if (observed["epoch"] != cursor["epoch"]) pending.mixed = true
                    else if (cursorSequence(cursor) > cursorSequence(observed)) pending.observed = cursor
                    return
                }
                if (session.loading || session.error) return
                // A rewind receipt carries the restored draft instead of a timeline projection, and the
                // truncation that follows may change the epoch: settle it before the reducer short-circuits.
                val base = observeRewind(connection, sequence, body, session)
                if (base !== session) mutableState.value = mutableState.value.copy(session = base)
                val next = SessionTimelineReducer.event(base.timeline, frame)
                if (next == null) {
                    val cursor = (frame["cursor"] as? JsonObject)?.takeIf(SessionSync::isCursor)
                    val gap = type != "session-invalidated" && cursor != null &&
                        cursor["epoch"] == base.timeline.cursor?.get("epoch") &&
                        cursorSequence(cursor) > cursorSequence(base.timeline.cursor) + 1
                    requestSync(connection, useCursor = gap)
                    return
                }
                if (next === base.timeline) return
                settleResolvedResponses(next)
                val loadingHistory = base.loadingHistory && historyBefore == next.baseIndex
                if (base.loadingHistory && !loadingHistory) cancelHistory(connection)
                val updated = base.copy(timeline = next,
                    pendingResponses = pendingResponses.keys.toSet(), loadingHistory = loadingHistory,
                    responseFailed = failedResponses.isNotEmpty(),
                    historyLimitReached = base.historyLimitReached && next.baseIndex == base.timeline.baseIndex,
                    hasMoreHistory = next.baseIndex > 0 && (base.hasMoreHistory || next.baseIndex > base.timeline.baseIndex))
                var settled = observeSessionCommands(connection, updated)
                settled = observeMaintenance(connection, settled, type)
                if (type == "compaction") settled = compactionEvent(connection, settled, body)
                settled = observeTaskStop(connection, sequence, settled)
                mutableState.value = mutableState.value.copy(session = settled)
                armResponses(connection)
            }
            "history" -> {
                val before = historyBefore ?: return
                if (frame["sessionId"].linkString() != id || !session.loadingHistory || before != session.timeline.baseIndex) return
                val base = frame["baseIndex"].linkIndex() ?: return
                val page = frame["messages"] as? JsonArray ?: return
                // History has no requestId; correlate the response with the exclusive boundary sent.
                if ((page.isEmpty() && base != 0L) || (page.isNotEmpty() && base + page.size != before)) return
                val next = SessionTimelineReducer.history(session.timeline, frame) ?: return
                cancelHistory(connection)
                mutableState.value = mutableState.value.copy(session = session.copy(timeline = next, loadingHistory = false,
                    hasMoreHistory = next.baseIndex > 0 && next.baseIndex < session.timeline.baseIndex,
                    historyLimitReached = page.isNotEmpty() && next.baseIndex == session.timeline.baseIndex && next.baseIndex > 0))
            }
            "command-rejected" -> {
                if (rejection == "abort" && session.stopPhase != null) {
                    stopDeadline = null
                    mutableState.value = mutableState.value.copy(session = session.copy(stopPhase = SessionCommandPhase.Rejected))
                    armSessionCommands(connection)
                } else if (rejection != null && textEvidence?.command?.wire == rejection) {
                    textDeadline = null
                    textEvidence = null
                    mutableState.value = mutableState.value.copy(session = session.copy(
                        textAttempt = session.textAttempt?.copy(phase = SessionCommandPhase.Rejected)))
                    armSessionCommands(connection)
                }
                val command = frame["command"].linkString() ?: return
                if ((command != "approval-respond" && command != "ask-respond") ||
                    frame["error"].linkString() != "read-only") return
                // Current host's rejection has no requestId. Settle matching in-flight writes as
                // unknown and fail closed on the authenticated scope denial until fresh host-info.
                val failed = pendingResponses.filterValues { it.command == command }.keys
                if (failed.isEmpty()) return
                failedResponses.addAll(failed)
                pendingResponses.keys.removeAll(failed)
                mutableState.value = mutableState.value.copy(
                    readOnly = true,
                    session = session.copy(pendingResponses = pendingResponses.keys.toSet(), responseFailed = true))
                armResponses(connection)
            }
        }
    }

    private fun cancelHistory(connection: Connection) {
        historyBefore = null
        cancelTimer(connection, Timer.History)
    }

    private fun settleResolvedResponses(timeline: SessionTimeline) {
        pendingResponses.entries.removeAll { (requestId, pending) ->
            if (pending.command == "approval-respond") timeline.approvals.none { it.requestId == requestId }
            else timeline.asks.none { it.requestId == requestId }
        }
        failedResponses.removeAll { id -> timeline.approvals.none { it.requestId == id } && timeline.asks.none { it.requestId == id } }
    }

    private fun armResponses(connection: Connection) {
        cancelTimer(connection, Timer.Responses)
        pendingResponses.values.minOfOrNull { it.deadline }?.let {
            arm(connection, Timer.Responses, (it - nowMillis()).coerceAtLeast(1))
        }
    }

    private fun start() {
        if (!retainTransport || disposed.get() || terminal || current != null || retry != null) return
        val request = request
        if (request == null || replay == null) {
            failClosed()
            return
        }
        if (!resetPeer()) return
        val connection = Connection()
        current = connection
        publish(LinkPhase.Connecting)
        try {
            connection.socket = openSocket(request, listener(connection))
            arm(connection, Timer.Connect, CONNECT_TIMEOUT_MS)
        } catch (_: Exception) {
            end(connection, null, false)
        }
    }

    private fun hide(sendHiddenPresence: Boolean) {
        cancelRetry()
        attempt = 0
        val connection = current
        if (connection != null && !connection.retiring) {
            if (sendHiddenPresence && connection.accepting.get() && connection.terminalClose.get() == null &&
                phase == LinkPhase.Online && replay?.isReady() == true) {
                // Best effort; close also causes a relay peer-left. No send before proof.
                try {
                    connection.socket?.send(replay.seal(presence(false)).toByteString())
                } catch (_: Exception) {
                    if (replay.isFailed()) {
                        failClosed()
                        return
                    }
                }
            }
            connection.retiring = true
            connection.clearReads()
            cancelTimers(connection)
            val graceful = phase != LinkPhase.Connecting && connection.socket?.close(1000, null) == true
            if (graceful) arm(connection, Timer.Retire, CLOSE_TIMEOUT_MS) else detach(connection)
        }
        if (!terminal) publish(LinkPhase.Inactive)
    }

    private fun end(connection: Connection, code: Int?, replaced: Boolean) {
        val terminalClose = connection.terminalClose.get() ?: terminalPhase(code, replaced)
        detach(connection)
        when {
            disposing -> Unit
            terminalClose != null -> publish(terminalClose)
            connection.retiring -> start()
            retainTransport && !disposed.get() -> {
                publish(LinkPhase.Offline)
                val next = Event.Deadline(null, Timer.Retry)
                retry = schedule(next, linkBackoffMillis(attempt, jitter()))
                attempt = (attempt + 1).coerceAtMost(6)
            }
        }
    }

    private fun detach(connection: Connection) {
        current = null
        connection.accepting.set(false)
        connection.clearReads()
        cancelTimers(connection)
        connection.socket?.cancel()
    }

    private fun failClosed() {
        current?.let(::detach)
        cancelRetry()
        publish(LinkPhase.Failed)
    }

    private fun resetPeer(): Boolean {
        val replay = replay ?: return false
        try {
            replay.peerReset()
        } catch (error: Throwable) {
            if (!replay.isFailed()) throw error
        }
        if (!replay.isFailed()) return true
        failClosed()
        return false
    }

    private fun text(connection: Connection, control: String) {
        if (!active(connection)) return
        cancelTimer(connection, Timer.Pong)
        when (control) {
            "pong" -> connection.pingAt?.let { sent ->
                connection.pingAt = null
                mutableState.value = mutableState.value.copy(rttMillis = (nowMillis() - sent).coerceAtLeast(0))
            }
            "host-online" -> {
                // Go may notify an already-present host before it queues host-online for this guest.
                // Keep just the initial socket's bounded early packets, and validate them only now.
                val early = if (!connection.seenHostControl) connection.earlyPackets.toList() else emptyList()
                connection.seenHostControl = true
                connection.clearReads()
                if (!resetPeer()) return
                publish(LinkPhase.Authenticating, retainRtt = true)
                if (Timer.Authenticate !in connection.timers) arm(connection, Timer.Authenticate, AUTH_TIMEOUT_MS)
                if (drainHello(connection)) for (packet in early) {
                    if (!active(connection)) break
                    binary(connection, packet)
                }
            }
            "host-offline" -> {
                connection.seenHostControl = true
                connection.clearReads()
                cancelTimer(connection, Timer.Authenticate)
                if (resetPeer()) publish(LinkPhase.AwaitingHost, retainRtt = true)
            }
        }
    }

    private fun binary(connection: Connection, bytes: ByteString) {
        cancelTimer(connection, Timer.Pong)
        val replay = replay ?: return
        if (phase == LinkPhase.AwaitingHost && !connection.seenHostControl && connection.earlyPackets.size < MAX_EARLY_PACKETS) {
            connection.earlyPackets.add(bytes)
            return
        }
        if (phase != LinkPhase.Authenticating && phase != LinkPhase.Online) return
        val packet = bytes.toByteArray()
        val opened = try {
            replay.open(packet) { active(connection) }
        } catch (error: Throwable) {
            if (error !is PairCryptoException && !replay.isFailed()) throw error
            null
        }
        if (!active(connection)) return
        if (replay.isFailed()) {
            failClosed()
            return
        }
        if (opened == null || !drainHello(connection)) return
        val read = desktopRead(opened.payload)
        if (!opened.trusted) {
            if (!replay.isReady() && read != null && read != DesktopRead.InvalidCatalog &&
                isReplayBootstrapResponse(opened.payload["type"].linkString().orEmpty())) {
                // A pre-proof desktop can send metadata once and suppress it by fingerprint later.
                // Never expose these reads until we prove BOTH this sender and its challenge.
                val origin = bootstrapOrigin(bytes, packet) ?: return
                if (connection.staged.size < MAX_BOOTSTRAP_ORIGINS || origin in connection.staged) {
                    connection.staged.getOrPut(origin, ::BootstrapReads).add(read, sequence(packet))
                }
            }
            return
        }
        if (!replay.isReady()) return
        var next = mutableState.value
        val justAuthenticated = phase == LinkPhase.Authenticating
        if (justAuthenticated) {
            val staged = if (connection.staged.isEmpty()) null else connection.staged[bootstrapOrigin(bytes, packet)]
            connection.staged.clear()
            if (!send(connection, SNAPSHOT) || !send(connection, presence(visible))) return
            cancelTimer(connection, Timer.Authenticate)
            attempt = 0
            next = next.copy(phase = LinkPhase.Online)
            staged?.reads?.values?.forEach { next = connection.applyRead(next, it.read, it.sequence) }
        }
        val sequence = sequence(packet)
        connection.latestSequence = maxOf(connection.latestSequence, sequence)
        val beforeRead = next
        if (read != null) next = connection.applyRead(next, read, sequence)
        if (!active(connection)) return
        if (next.readOnly) pendingCreation?.firstText = null
        if (justAuthenticated && visible) creationAuthority = Any()
        // A host that just turned read-only cannot have accepted the in-flight rewind.
        if (read is DesktopRead.Host && next !== beforeRead && next.readOnly) {
            next = next.unconfirmedRewind().unconfirmedTaskStop()
        }
        mutableState.value = next
        if (justAuthenticated && selectedSession != null) requestSync(connection, useCursor = true)
        if (read is DesktopRead.Host && next !== beforeRead) refreshSessionWriteAuthority()
        if (read is DesktopRead.Catalog && next !== beforeRead) {
            confirmCreation(read.tasks)
            queueCatalog(connection, read, sequence)
            goalCatalog(connection, read, sequence)
            usageCatalog(connection, read, sequence)
        }
        if (read == DesktopRead.InvalidCatalog && next !== beforeRead) goalCatalog(connection, null, sequence)
        if (read == null && !botFrame(connection, opened.payload, sequence)) sessionFrame(connection, opened.payload, sequence)
    }

    /** FrameReplay already authenticated the wire packet and strips the replay envelope. */
    private fun bootstrapOrigin(bytes: ByteString, packet: ByteArray): Origin? {
        val payload = try { FrameCrypto.open(contentKey, packet) as? JsonObject }
        catch (_: PairCryptoException) { return null }
        val challenge = (payload?.get("replay") as? JsonObject)?.get("c").linkString() ?: return null
        return Origin(bytes.substring(1, 9), challenge)
    }

    private fun drainHello(connection: Connection): Boolean = replay?.takeHello() != true || send(connection, HELLO)

    private fun send(connection: Connection, payload: JsonObject): Boolean {
        if (!active(connection)) return false
        val frame = try {
            replay?.seal(payload)?.toByteString() ?: return false
        } catch (_: Exception) {
            failClosed()
            return false
        }
        if (!active(connection)) return false
        if (frame.size > MAX_FRAME_BYTES) return false // Refuse locally; an oversized answer is not a dead socket.
        if (connection.socket?.send(frame) == true) return true
        end(connection, null, false)
        return false
    }

    private fun ping(connection: Connection) {
        if (connection.socket?.send("ping") != true) {
            end(connection, null, false)
            return
        }
        connection.pingAt = nowMillis()
        arm(connection, Timer.Pong, PONG_TIMEOUT_MS)
        arm(connection, Timer.Ping, PING_INTERVAL_MS)
    }

    private fun deadline(event: Event.Deadline) {
        val connection = event.connection
        if (connection == null) {
            if (retry?.event !== event) return
            retry = null
            start()
            return
        }
        if (current !== connection || connection.timers[event.kind]?.event !== event) return
        connection.timers.remove(event.kind)
        if (event.kind == Timer.Retire) end(connection, null, false)
        else if (active(connection)) when (event.kind) {
            Timer.Ping -> ping(connection)
            Timer.Connect, Timer.Authenticate, Timer.Pong -> end(connection, null, false)
            Timer.SessionSync -> subscribePending(connection)
            Timer.History -> {
                historyBefore = null
                mutableState.value = mutableState.value.copy(session = mutableState.value.session?.copy(loadingHistory = false))
            }
            Timer.Responses -> {
                val now = nowMillis()
                val expired = pendingResponses.filterValues { it.deadline <= now }.keys
                failedResponses.addAll(expired)
                pendingResponses.keys.removeAll(expired)
                if (expired.isNotEmpty()) mutableState.value = mutableState.value.copy(session = mutableState.value.session?.copy(
                    pendingResponses = pendingResponses.keys.toSet(), responseFailed = true))
                armResponses(connection)
            }
            Timer.Creation -> finishCreation(CreationPhase.Unconfirmed)
            Timer.QueueCommands -> finishQueue(SessionCommandPhase.Unconfirmed)
            Timer.GoalCommands -> finishGoal(SessionCommandPhase.Unconfirmed)
            Timer.Maintenance -> finishMaintenance(SessionCommandPhase.Unconfirmed)
            Timer.Rewind -> finishRewind(SessionCommandPhase.Unconfirmed)
            Timer.TaskStop -> finishTaskStop(SessionCommandPhase.Unconfirmed)
            Timer.FileList -> fileListTimeout()
            Timer.FileRead -> fileReadTimeout()
            Timer.Preview -> previewTimeout()
            Timer.BotCatalog, Timer.BotInbox, Timer.BotTimeline -> botTimeout(event.kind)
            Timer.BotRefresh -> {
                val bots = mutableState.value.bots
                val chatId = bots?.timelineChatId
                if (visible && chatId != null && !bots.timelineRequested && connection.botTimelineDirty) {
                    connection.botTimelineDirty = false
                    requestBotTimeline(chatId, null, open = true, refresh = true)
                }
            }
            Timer.BotSend -> botSendTimeout()
            Timer.BotStop -> botStopTimeout()
            Timer.BotThread -> botThreadTimeout()
            Timer.SessionCommands -> {
                val now = nowMillis()
                val textExpired = textDeadline?.let { it <= now } == true
                val stopExpired = stopDeadline?.let { it <= now } == true
                if (textExpired) textDeadline = null
                if (stopExpired) stopDeadline = null
                if (textExpired || stopExpired) mutableState.value = mutableState.value.copy(session = mutableState.value.session?.let {
                    it.copy(textAttempt = if (textExpired) it.textAttempt?.copy(phase = SessionCommandPhase.Unconfirmed) else it.textAttempt,
                        stopPhase = if (stopExpired) SessionCommandPhase.Unconfirmed else it.stopPhase)
                })
                armSessionCommands(connection)
            }
            Timer.Retry, Timer.Retire -> Unit
        }
    }

    private fun schedule(event: Event.Deadline, millis: Long) = Scheduled(event, scope.launch {
        delay(millis)
        events.trySend(event)
    })

    private fun arm(connection: Connection, kind: Timer, millis: Long) {
        cancelTimer(connection, kind)
        connection.timers[kind] = schedule(Event.Deadline(connection, kind), millis)
    }

    private fun cancelTimer(connection: Connection, kind: Timer) {
        connection.timers.remove(kind)?.job?.cancel()
    }

    private fun cancelTimers(connection: Connection) {
        connection.timers.values.forEach { it.job.cancel() }
        connection.timers.clear()
    }

    private fun cancelRetry() {
        retry?.job?.cancel()
        retry = null
    }

    private fun listener(connection: Connection) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            events.trySend(Event.Open(connection))
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (text.length > MAX_CONTROL_CHARS || !connection.accepting.get()) return
            val control = if (text == "pong") "pong" else try {
                (Json.parseToJsonElement(text) as? JsonObject)?.get("type").linkString().orEmpty()
            } catch (_: IllegalArgumentException) {
                ""
            }
            if (control == "revoked") remoteEnd(1008, "revoked")
            else enqueue(webSocket, Event.Text(connection, control))
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            if (bytes.size <= MAX_FRAME_BYTES) enqueue(webSocket, Event.Binary(connection, bytes))
        }

        private fun enqueue(webSocket: WebSocket, event: Event) {
            if (!connection.accepting.get()) return
            if (connection.queued.incrementAndGet() <= MAX_QUEUED_FRAMES) {
                if (events.trySend(event).isFailure) connection.queued.decrementAndGet()
            } else {
                connection.queued.decrementAndGet()
                if (connection.accepting.compareAndSet(true, false)) {
                    events.trySend(Event.End(connection, null))
                    webSocket.cancel()
                }
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            remoteEnd(code, reason)
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            remoteEnd(code, reason)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            connection.accepting.set(false)
            events.trySend(Event.End(connection, null))
        }

        private fun remoteEnd(code: Int, reason: String) {
            val replaced = code == 1000 && reason == "replaced"
            // A send can fail before the queued callback is processed. Preserve a terminal close
            // observed for this exact generation instead of treating the failed send as transient.
            terminalPhase(code, replaced)?.let { connection.terminalClose.compareAndSet(null, it) }
            connection.accepting.set(false)
            events.trySend(Event.End(connection, code, replaced))
        }
    }

    private class Connection {
        val accepting = AtomicBoolean(true)
        val queued = AtomicInteger()
        val terminalClose = AtomicReference<LinkPhase?>()
        var socket: WebSocket? = null
        var retiring = false
        var pingAt: Long? = null
        var seenHostControl = false
        var lastSyncAt = 0L
        var lastSyncSession: String? = null
        var latestSequence = 0L
        val botChatSequences = mutableMapOf<String, Long>()
        var botTimelineDirty = false
        var botCatalogSequence = 0L
        var botChatsSequence = 0L
        val earlyPackets = mutableListOf<ByteString>()
        val timers = mutableMapOf<Timer, Scheduled>()
        val staged = mutableMapOf<Origin, BootstrapReads>()
        private val readSequences = mutableMapOf<DesktopRead.Kind, Long>()

        fun clearReads() {
            earlyPackets.clear()
            staged.clear()
            readSequences.clear()
            lastSyncSession = null
            latestSequence = 0L
            botChatSequences.clear()
            botTimelineDirty = false
            botCatalogSequence = 0L
            botChatsSequence = 0L
        }

        fun noteScopeDenial(sequence: Long) {
            val kind = DesktopRead.Kind.Host
            readSequences[kind] = maxOf(readSequences[kind] ?: 0, sequence)
        }

        fun applyRead(state: DesktopLinkState, read: DesktopRead, sequence: Long): DesktopLinkState {
            if (sequence <= (readSequences[read.kind] ?: 0)) return state
            readSequences[read.kind] = sequence
            return when (read) {
                is DesktopRead.Host -> state.copy(hostName = read.name ?: state.hostName, readOnly = read.readOnly)
                is DesktopRead.Catalog -> state.copy(catalog = read.tasks, catalogReady = true)
                DesktopRead.InvalidCatalog -> state.copy()
                is DesktopRead.Projects -> state.copy(projects = read.projects)
                is DesktopRead.Providers -> state.copy(providers = read.providers)
            }
        }
    }

    private sealed interface Event {
        data class Visibility(val value: Boolean) : Event
        data class BackgroundAllowed(val value: Boolean) : Event
        data object Reconnect : Event
        data object Dispose : Event
        data class SelectSession(val sessionId: String?) : Event
        data class CreateTask(val request: TaskLaunch, val authority: Any?) : Event
        data class DismissCreation(val sessionId: String?) : Event
        data object RetrySession : Event
        data class History(val sessionId: String) : Event
        data class Respond(val sessionId: String, val requestId: String, val command: String, val value: String,
            val authority: Any) : Event
        data class WriteSession(val sessionId: String, val epoch: String, val command: SessionCommand, val text: String?,
            val authority: Any, val images: List<SessionImage>? = null) : Event
        data class WriteQueue(val sessionId: String, val epoch: String, val authority: Any, val command: QueueCommand,
            val messageId: String?, val text: String?, val item: DesktopQueuedMessage?) : Event
        data class WriteGoal(val sessionId: String, val epoch: String, val authority: Any, val command: GoalCommand,
            val expected: DesktopGoal?, val text: String?) : Event
        data class WriteMaintenance(val sessionId: String, val command: SessionMaintenanceCommand,
            val baseline: MaintenanceBaseline, val text: String?, val authority: Any) : Event
        data class WriteRewind(val sessionId: String, val userIndexFromEnd: Long, val restoreFiles: Boolean,
            val baseline: RewindBaseline, val authority: Any) : Event
        data class WriteTaskStop(val sessionId: String, val kind: SessionTaskKind, val targetId: String,
            val baseline: TaskStopBaseline, val authority: Any) : Event
        data class ListFiles(val sessionId: String) : Event
        data class ReadFile(val sessionId: String, val fileId: String, val offset: Long) : Event
        data class ListPreviews(val sessionId: String) : Event
        data class OpenPreview(val sessionId: String, val entryId: String, val width: Int, val height: Int) : Event
        data class PreviewAction(val sessionId: String, val action: DesktopPreviewAction) : Event
        data class PreviewInput(val sessionId: String, val input: DesktopPreviewInput) : Event
        data object RequestBots : Event
        data object RequestInbox : Event
        data class OpenBotChat(val chatId: String) : Event
        data class CloseBotChat(val chatId: String) : Event
        data class LoadBotTimeline(val chatId: String, val beforeSeq: Long?) : Event
        data class BotSend(val chatId: String, val text: String, val deliveryId: String, val authority: Any) : Event
        data class BotStop(val chatId: String, val authority: Any) : Event
        data class ChangeBotThread(val rootId: String, val command: BotThreadCommand, val targetId: String?,
            val expectedActiveId: String, val authority: Any) : Event
        data class Open(val connection: Connection) : Event
        data class Text(val connection: Connection, val value: String) : Event
        data class Binary(val connection: Connection, val value: ByteString) : Event
        data class End(val connection: Connection, val code: Int?, val replaced: Boolean = false) : Event
        data class Deadline(val connection: Connection?, val kind: Timer) : Event
    }

    private enum class Timer { Connect, Authenticate, Ping, Pong, Retire, Retry, SessionSync, History, Responses, SessionCommands, QueueCommands, GoalCommands, Maintenance, Rewind, TaskStop, FileList, FileRead, Preview, BotCatalog, BotInbox, BotTimeline, BotRefresh, BotSend, BotStop, BotThread, Creation }
    private enum class SessionCommand(val wire: String) { Prompt("prompt"), Steer("steer"), Abort("abort") }
    private data class TextEvidence(val command: SessionCommand, val epoch: String, val sequence: Long, val firstNewIndex: Long)
    private data class QueueEvidence(val attemptId: Long, val epoch: String, val afterSequence: Long, val originalIds: Set<String>)
    private data class GoalEvidence(val attemptId: Long, val epoch: String, val afterSequence: Long, val deadline: Long,
        val previousText: String?)
    private data class MaintenanceEvidence(val attemptId: Long, val command: SessionMaintenanceCommand, val epoch: String,
        val afterCursor: Long, val afterFrame: Long, val generation: Connection)
    private data class RewindEvidence(val attemptId: Long, val afterSequence: Long, val generation: Connection)
    private data class TaskStopEvidence(val attemptId: Long, val epoch: String, val afterSequence: Long,
        val generation: Connection)
    private data class FileListPending(val requestId: String, val sessionId: String, val generation: Connection)
    private data class FileReadPending(val requestId: String, val sessionId: String, val fileId: String,
        val offset: Long, val generation: Connection)
    private data class PreviewPending(val requestId: String, val sessionId: String, val request: PreviewRequest,
        val generation: Connection)
    private data class BotTimelineSent(val chatId: String, val beforeSeq: Long?, val at: Long)
    private enum class BotWriteKind { Send, Stop }
    private data class BotWrite(val kind: BotWriteKind, val generation: Connection, val chatId: String,
        val deliveryId: String?, val afterSequence: Long)
    private enum class PreviewRequest(val wire: String) {
        List("preview-list"), Open("preview-open"), Frame("preview-frame"), Refresh("preview-refresh"),
        Close("preview-close"), Input("preview-input")
    }
    private data class Scheduled(val event: Event.Deadline, val job: Job)
    private data class Origin(val noncePrefix: ByteString, val challenge: String)
    private data class StagedRead(val read: DesktopRead, val sequence: Long)
    private data class PendingSync(val sessionId: String, val requestId: String, val cursor: JsonObject?, var attempts: Int,
        var sent: Boolean = false, var observed: JsonObject? = null, var mixed: Boolean = false)
    private data class PendingResponse(val command: String, val deadline: Long)
    private data class PendingCreation(val sessionId: String, val deadline: Long, var firstText: String?)

    private class BootstrapReads {
        val reads = mutableMapOf<DesktopRead.Kind, StagedRead>()
        fun add(read: DesktopRead, sequence: Long) {
            if (sequence > (reads[read.kind]?.sequence ?: 0)) reads[read.kind] = StagedRead(read, sequence)
        }
    }

    private companion object {
        const val MAX_CONTROL_CHARS = 256
        const val MAX_QUEUED_FRAMES = 16
        const val MAX_BOOTSTRAP_ORIGINS = 4
        const val MAX_EARLY_PACKETS = 8 // hello plus all six fingerprinted metadata channels.
        const val CONNECT_TIMEOUT_MS = 8_000L
        const val AUTH_TIMEOUT_MS = 12_000L
        const val PING_INTERVAL_MS = 15_000L
        const val PONG_TIMEOUT_MS = 8_000L
        const val CLOSE_TIMEOUT_MS = 1_000L
        const val SYNC_DEDUPE_MS = 1_501L // Desktop suppresses duplicate worker snapshot requests for 1.5s.
        const val SYNC_TIMEOUT_MS = 10_000L
        const val SYNC_ATTEMPTS = 6
        const val HISTORY_TIMEOUT_MS = 10_000L
        const val RESPONSE_TIMEOUT_MS = 10_000L
        // A rewind waits for navigateTree plus a deferred file restore; it never replays on expiry.
        const val REWIND_TIMEOUT_MS = 15_000L
        // The desktop never answers a task stop; the next frame that drops the id is the only proof.
        const val TASK_STOP_TIMEOUT_MS = 10_000L
        const val CREATION_TIMEOUT_MS = 15_000L
        // A file answer is a single bounded read; an expired request is never re-sent by itself.
        const val FILE_TIMEOUT_MS = 15_000L
        const val FILE_TIMEOUT_ERROR = "请求超时"
        const val FILE_INVALID_ERROR = "无效的响应"
        const val FILE_SEND_ERROR = "发送失败"
        // A preview answer is one browser operation; an expired request is never re-sent by itself.
        const val PREVIEW_TIMEOUT_MS = 20_000L
        const val PREVIEW_TIMEOUT_ERROR = "请求超时"
        const val PREVIEW_INVALID_ERROR = "无效的响应"
        const val PREVIEW_SEND_ERROR = "发送失败"
        // A bot push answer has no request id: one window is both the dedupe and the silence bound.
        const val BOT_RESPONSE_WINDOW_MS = 10_000L
        // A bot send has a real receipt; a stop only ever shows up as the next running state.
        const val BOT_SEND_TIMEOUT_MS = 15_000L
        const val BOT_STOP_TIMEOUT_MS = 10_000L
        // Denials carry no id, so only a bounded run of recent bot writes can be matched to them.
        const val BOT_WRITE_LIMIT = 8
        const val BOT_NO_RESPONSE = "没有收到桌面响应"
        const val BOT_INVALID_ERROR = "无效的响应"
        val BOT_FRAME_TYPES = setOf("bot-catalog", "bot-chats", "bot-inbox", "bot-activity", "group-timeline",
            "bot-chat-state", "bot-send-result", "bot-event", "bot-thread-result")
        val BOT_REFRESH_EVENTS = setOf("chat", "timeline", "queue", "delegation")
        val BOT_DELIVERY_ID = Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
        const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
        val DISMISSIBLE_CREATION_PHASES = setOf(CreationPhase.Unconfirmed, CreationPhase.Rejected, CreationPhase.Unavailable)
        val APPROVAL_DECISIONS = setOf("allow", "deny", "allowSession")
        val relayClient by lazy {
            OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
                .retryOnConnectionFailure(false).build()
        }
        val directClient by lazy { relayClient.newBuilder().proxy(Proxy.NO_PROXY).build() }
        val HELLO = buildJsonObject { put("type", "replay-hello") }
        val SNAPSHOT = buildJsonObject { put("type", "snapshot") }
        fun presence(visible: Boolean) = buildJsonObject { put("type", "presence"); put("visible", visible) }
        fun sequence(frame: ByteArray): Long = ByteBuffer.wrap(frame, 9, 4).int.toLong() and 0xffff_ffffL
        fun cursorSequence(cursor: JsonObject?): Long = cursor?.get("seq").linkIndex() ?: -1L
        fun terminalPhase(code: Int?, replaced: Boolean): LinkPhase? = when {
            code == 1008 -> LinkPhase.Revoked
            replaced -> LinkPhase.Replaced
            else -> null
        }
    }
}

internal fun relayRequest(credentials: PairCredentials, allowLoopbackHttp: Boolean): Request {
    require(credentials.pairId.isNotBlank() && credentials.pairId != "." && credentials.pairId != "..")
    require(credentials.deviceToken.isNotBlank())
    val origin = PairRelayUrl.parse(credentials.relayUrl, allowLoopbackHttp)
    val url = PairRelayUrl.endpoint(origin, credentials.pairId)
        .addQueryParameter("role", "guest").addQueryParameter("token", credentials.deviceToken).build()
    return Request.Builder().url(url).build()
}
