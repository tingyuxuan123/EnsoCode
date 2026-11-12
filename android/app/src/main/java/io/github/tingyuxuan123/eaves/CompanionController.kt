package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopLinkState
import io.github.tingyuxuan123.eaves.mirror.PairCredentialStore
import io.github.tingyuxuan123.eaves.mirror.PairCredentials
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.TaskLaunch
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel
import io.github.tingyuxuan123.eaves.mirror.SessionImage
import io.github.tingyuxuan123.eaves.mirror.QueueCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopGoal
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.eaves.mirror.maintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.RewindBaseline
import io.github.tingyuxuan123.eaves.mirror.rewindBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionTaskKind
import io.github.tingyuxuan123.eaves.mirror.TaskStopBaseline
import io.github.tingyuxuan123.eaves.mirror.taskStopBaseline
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput
import io.github.tingyuxuan123.eaves.mirror.BotThreadCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopBotArtifactTarget
import io.github.tingyuxuan123.eaves.mirror.PairException
import io.github.tingyuxuan123.eaves.mirror.PairFailure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

internal interface CompanionLink : AutoCloseable {
    val state: StateFlow<DesktopLinkState>
    fun setVisible(visible: Boolean)
    fun setBackgroundAllowed(allowed: Boolean) = Unit
    fun reconnect()
    fun selectSession(sessionId: String?) = Unit
    fun retrySession() = Unit
    fun loadHistory(sessionId: String) = Unit
    fun respondApproval(sessionId: String, requestId: String, decision: String) = Unit
    fun respondAsk(sessionId: String, requestId: String, answer: String) = Unit
    fun submitText(sessionId: String, text: String, steer: Boolean) = Unit
    fun submitImages(sessionId: String, text: String, images: List<SessionImage>) = Unit
    fun stopSession(sessionId: String) = Unit
    fun setSessionModel(sessionId: String, providerId: String, modelId: String) = Unit
    fun setSessionReasoning(sessionId: String, enabled: Boolean) = Unit
    fun setSessionThinking(sessionId: String, level: TaskThinkingLevel) = Unit
    fun queueAction(sessionId: String, command: QueueCommand, messageId: String?, text: String?) = Unit
    fun goalAction(sessionId: String, command: GoalCommand, expected: DesktopGoal?, text: String?) = Unit
    fun maintain(sessionId: String, command: SessionMaintenanceCommand, baseline: MaintenanceBaseline, text: String?) = Unit
    fun rewind(sessionId: String, userIndexFromEnd: Long, restoreFiles: Boolean, baseline: RewindBaseline) = Unit
    fun stopTask(sessionId: String, kind: SessionTaskKind, targetId: String, baseline: TaskStopBaseline) = Unit
    fun listFiles(sessionId: String) = Unit
    fun readFile(sessionId: String, fileId: String, offset: Long) = Unit
    fun listPreviews(sessionId: String) = Unit
    fun openPreview(sessionId: String, entryId: String, width: Int, height: Int) = Unit
    fun previewAction(sessionId: String, action: DesktopPreviewAction) = Unit
    fun previewInput(sessionId: String, input: DesktopPreviewInput) = Unit
    fun requestBots() = Unit
    fun requestInbox() = Unit
    fun openBotChat(chatId: String) = Unit
    fun loadBotTimeline(chatId: String, beforeSeq: Long?) = Unit
    fun closeBotChat(chatId: String) = Unit
    fun sendBotMessage(chatId: String, text: String, deliveryId: String) = Unit
    fun stopBotChat(chatId: String) = Unit
    fun changeBotThread(rootId: String, command: BotThreadCommand, targetId: String?, expectedActiveId: String) = Unit
    fun requestBotNewSession(chatId: String) = Unit
    fun confirmBotNewSession(chatId: String) = Unit
    fun retryBotEntry(chatId: String, entryId: String) = Unit
    fun dismissBotInboxItem(key: String) = Unit
    fun createBotGroup(title: String, memberIds: List<String>, bossBotId: String) = Unit
    fun openBotDirect(botId: String) = Unit
    fun loadBotArtifacts(target: DesktopBotArtifactTarget) = Unit
    fun loadBotArtifactImage(target: DesktopBotArtifactTarget, mediaId: String?, rel: String?) = Unit
    fun listBotFiles(target: DesktopBotArtifactTarget) = Unit
    fun readBotFile(target: DesktopBotArtifactTarget, fileId: String, offset: Long) = Unit
    fun createTask(request: TaskLaunch) = Unit
    fun dismissCreation(sessionId: String?) = Unit
}

internal enum class CompanionProblem { Storage, Pairing, InvalidLink, Denied, Network, OutcomeUnknown, Revoking, Revoked }
internal enum class WatchPhase { Off, Starting, Active, Failed }
internal data class BackgroundWatch(val phase: WatchPhase = WatchPhase.Off, val token: String? = null)

internal data class CompanionState(
    val paired: Boolean = false,
    val deviceName: String? = null,
    val link: DesktopLinkState = DesktopLinkState(),
    val busy: Boolean = false,
    val problem: CompanionProblem? = null,
    val watch: BackgroundWatch = BackgroundWatch(),
)

/** Main-thread coordinator; disk work and durable replay pins never live in Compose state. */
internal class CompanionController(
    private val store: PairCredentialStore,
    private val claim: suspend (String) -> PairCredentials,
    private val revoke: suspend (PairCredentials) -> Unit,
    private val linkFactory: (PairCredentials, () -> Unit) -> CompanionLink,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val mutable = MutableStateFlow(CompanionState(busy = true))
    val state: StateFlow<CompanionState> = mutable.asStateFlow()
    private var loaded = false
    private val mutableVisible = MutableStateFlow(false)
    val uiVisible: StateFlow<Boolean> = mutableVisible.asStateFlow()
    private val visible get() = mutableVisible.value
    private var credentials: PairCredentials? = null
    private var connection: CompanionLink? = null
    private var observing: Job? = null
    private var generation = 0L
    private var selectedSession: String? = null

    init {
        scope.launch {
            try {
                val restored = withContext(io) { store.load() }
                if (restored != null) install(restored) else mutable.value = CompanionState()
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { mutable.value = CompanionState(problem = CompanionProblem.Storage) }
            finally { loaded = true }
        }
    }

    fun setVisible(visible: Boolean) {
        mutableVisible.value = visible
        connection?.setVisible(visible)
    }

    // The UI may request a lease; the socket is only retained after Android promotes its service.
    fun requestWatch(): String? {
        val state = mutable.value
        if (!visible || !state.paired || state.busy || connection == null ||
            state.link.phase in setOf(LinkPhase.Replaced, LinkPhase.Revoked, LinkPhase.Failed)) return null
        if (state.watch.phase == WatchPhase.Starting || state.watch.phase == WatchPhase.Active) return state.watch.token
        val token = UUID.randomUUID().toString()
        mutable.value = state.copy(watch = BackgroundWatch(WatchPhase.Starting, token))
        return token
    }

    fun activateWatch(token: String): Boolean {
        val state = mutable.value
        if (state.watch.token != token || state.watch.phase !in setOf(WatchPhase.Starting, WatchPhase.Active) || !state.paired || state.busy) return false
        connection?.setBackgroundAllowed(true) ?: return false
        mutable.value = state.copy(watch = BackgroundWatch(WatchPhase.Active, token))
        return true
    }

    fun stopWatch(token: String? = null, failed: Boolean = false) {
        val state = mutable.value
        if (token != null && state.watch.token != token) return
        connection?.setBackgroundAllowed(false)
        mutable.value = state.copy(watch = BackgroundWatch(if (failed) WatchPhase.Failed else WatchPhase.Off))
    }

    fun canOpenWatch(token: String): Boolean = mutable.value.let {
        it.paired && !it.busy && it.watch.token == token && it.watch.phase == WatchPhase.Active
    }

    fun pair(link: String) {
        if (!loaded || mutable.value.busy || credentials != null || link.isBlank() || mutable.value.problem == CompanionProblem.Storage) return
        mutable.value = mutable.value.copy(busy = true, problem = null)
        scope.launch {
            var accepted: PairCredentials? = null
            var storing = false
            try {
                accepted = withContext(io) { claim(link) }
                storing = true
                withContext(io) { store.save(accepted) }
                install(accepted)
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                val problem = if (storing) CompanionProblem.Storage else when ((error as? PairException)?.reason) {
                    PairFailure.INVALID_LINK -> CompanionProblem.InvalidLink
                    PairFailure.DENIED -> CompanionProblem.Denied
                    PairFailure.NETWORK -> CompanionProblem.Network
                    PairFailure.OUTCOME_UNKNOWN -> CompanionProblem.OutcomeUnknown
                    else -> CompanionProblem.Pairing
                }
                // An authorized but unsaved room is not a usable local pairing.
                if (accepted != null) {
                    try { withContext(io) { revoke(accepted) } }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { }
                    try { withContext(io) { store.clear(accepted.pairId) } }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) { }
                }
                mutable.value = CompanionState(problem = problem)
            }
        }
    }

    fun reconnect() {
        if (!mutable.value.busy) connection?.reconnect()
    }

    fun selectSession(sessionId: String?) {
        if (sessionId == null) {
            selectedSession = null
            connection?.selectSession(null)
        } else if (!mutable.value.busy && mutable.value.paired && mutable.value.link.phase == LinkPhase.Online &&
            (mutable.value.link.catalog.any { it.id == sessionId && !it.archived } ||
                mutable.value.link.bots?.let { bots -> bots.enabled == true &&
                    ((bots.chats + bots.threads).any { !it.archived && sessionId in it.sessions.values } ||
                        bots.activity.any { it.conversationId == sessionId } ||
                        bots.inbox.any { it.conversationId == sessionId && it.kind in setOf("approval", "ask") }) } == true)) {
            selectedSession = sessionId
            connection?.selectSession(sessionId)
        }
    }

    fun retrySession() {
        if (selectedSession != null && mutable.value.link.phase == LinkPhase.Online) connection?.retrySession()
    }

    fun loadHistory() {
        val id = currentSession() ?: return
        connection?.loadHistory(id)
    }

    fun respondApproval(sessionId: String, requestId: String, decision: String) {
        if (currentSession(writing = true) != sessionId) return
        connection?.respondApproval(sessionId, requestId, decision)
    }

    fun respondAsk(sessionId: String, requestId: String, answer: String) {
        if (currentSession(writing = true) != sessionId) return
        connection?.respondAsk(sessionId, requestId, answer)
    }

    fun submitText(sessionId: String, text: String, steer: Boolean) {
        if (currentSession(writing = true) == sessionId) connection?.submitText(sessionId, text, steer)
    }

    fun submitImages(sessionId: String, text: String, images: List<SessionImage>) {
        if (currentSession(writing = true) == sessionId) connection?.submitImages(sessionId, text, images)
    }

    fun stopSession(sessionId: String) {
        if (currentSession(writing = true) == sessionId) connection?.stopSession(sessionId)
    }

    fun setSessionModel(sessionId: String, providerId: String, modelId: String) {
        if (visible && currentSession(writing = true) == sessionId) {
            connection?.setSessionModel(sessionId, providerId, modelId)
        }
    }

    fun setSessionReasoning(sessionId: String, enabled: Boolean) {
        if (visible && currentSession(writing = true) == sessionId) connection?.setSessionReasoning(sessionId, enabled)
    }

    fun setSessionThinking(sessionId: String, level: TaskThinkingLevel) {
        if (visible && currentSession(writing = true) == sessionId) connection?.setSessionThinking(sessionId, level)
    }

    fun queueAction(sessionId: String, command: QueueCommand, messageId: String?, text: String?) {
        if (currentSession(writing = true) == sessionId) connection?.queueAction(sessionId, command, messageId, text)
    }

    fun goalAction(sessionId: String, command: GoalCommand, expected: DesktopGoal?, text: String?) {
        val session = mutable.value.link.session ?: return
        if (visible && currentSession(writing = true) == sessionId && session.goalReady && session.goal == expected) {
            connection?.goalAction(sessionId, command, expected, text)
        }
    }

    fun maintain(sessionId: String, command: SessionMaintenanceCommand, baseline: MaintenanceBaseline, text: String?) {
        val session = mutable.value.link.session ?: return
        if (visible && currentSession(writing = true) == sessionId && session.maintenanceBaseline == baseline) {
            connection?.maintain(sessionId, command, baseline, text)
        }
    }

    fun rewind(sessionId: String, userIndexFromEnd: Long, restoreFiles: Boolean, baseline: RewindBaseline) {
        val session = mutable.value.link.session ?: return
        if (visible && currentSession(writing = true) == sessionId && session.rewindBaseline == baseline) {
            connection?.rewind(sessionId, userIndexFromEnd, restoreFiles, baseline)
        }
    }

    fun stopTask(sessionId: String, kind: SessionTaskKind, targetId: String, baseline: TaskStopBaseline) {
        val session = mutable.value.link.session ?: return
        if (visible && currentSession(writing = true) == sessionId && session.taskStopBaseline(kind) == baseline) {
            connection?.stopTask(sessionId, kind, targetId, baseline)
        }
    }

    fun listFiles(sessionId: String) {
        if (visible && currentSession() == sessionId) connection?.listFiles(sessionId)
    }

    fun readFile(sessionId: String, fileId: String, offset: Long) {
        if (visible && currentSession() == sessionId) connection?.readFile(sessionId, fileId, offset)
    }

    fun listPreviews(sessionId: String) {
        if (visible && currentSession() == sessionId) connection?.listPreviews(sessionId)
    }

    fun openPreview(sessionId: String, entryId: String, width: Int, height: Int) {
        if (visible && currentSession() == sessionId) connection?.openPreview(sessionId, entryId, width, height)
    }

    fun previewAction(sessionId: String, action: DesktopPreviewAction) {
        if (visible && currentSession() == sessionId) connection?.previewAction(sessionId, action)
    }

    fun previewInput(sessionId: String, input: DesktopPreviewInput) {
        if (visible && currentSession() == sessionId) connection?.previewInput(sessionId, input)
    }

    // Bot mode is push-based: requests carry no session and read-only devices may still request.
    fun requestBots() {
        if (visible && mutable.value.paired && !mutable.value.busy && mutable.value.link.phase == LinkPhase.Online) {
            connection?.requestBots()
        }
    }

    fun requestInbox() {
        if (visible && mutable.value.paired && !mutable.value.busy && mutable.value.link.phase == LinkPhase.Online) {
            connection?.requestInbox()
        }
    }

    fun openBotChat(chatId: String) {
        if (chatId.isNotBlank() && chatId.length <= 512 &&
            visible && mutable.value.paired && !mutable.value.busy && mutable.value.link.phase == LinkPhase.Online) {
            connection?.openBotChat(chatId)
        }
    }

    fun loadBotTimeline(chatId: String, beforeSeq: Long?) {
        if (chatId.isNotBlank() && chatId.length <= 512 && (beforeSeq == null || beforeSeq >= 0) &&
            visible && mutable.value.paired && !mutable.value.busy && mutable.value.link.phase == LinkPhase.Online) {
            connection?.loadBotTimeline(chatId, beforeSeq)
        }
    }

    fun closeBotChat(chatId: String) { connection?.closeBotChat(chatId) }

    fun sendBotMessage(chatId: String, text: String, deliveryId: String) {
        val state = mutable.value
        if (chatId.isNotBlank() && chatId.length <= 512 && text.isNotBlank() &&
            visible && state.paired && !state.busy && state.link.phase == LinkPhase.Online && !state.link.readOnly) {
            connection?.sendBotMessage(chatId, text, deliveryId)
        }
    }

    fun stopBotChat(chatId: String) {
        val state = mutable.value
        if (chatId.isNotBlank() && chatId.length <= 512 &&
            visible && state.paired && !state.busy && state.link.phase == LinkPhase.Online && !state.link.readOnly) {
            connection?.stopBotChat(chatId)
        }
    }

    fun changeBotThread(rootId: String, command: BotThreadCommand, targetId: String?, expectedActiveId: String) {
        val state = mutable.value
        if (visible && state.paired && !state.busy && state.link.phase == LinkPhase.Online && !state.link.readOnly) {
            connection?.changeBotThread(rootId, command, targetId, expectedActiveId)
        }
    }

    private fun botWritable(): Boolean = mutable.value.let {
        visible && it.paired && !it.busy && it.link.phase == LinkPhase.Online && !it.link.readOnly && it.link.bots?.enabled == true
    }

    fun requestBotNewSession(chatId: String) { if (botWritable()) connection?.requestBotNewSession(chatId) }
    fun confirmBotNewSession(chatId: String) { if (botWritable()) connection?.confirmBotNewSession(chatId) }
    fun retryBotEntry(chatId: String, entryId: String) { if (botWritable()) connection?.retryBotEntry(chatId, entryId) }
    fun dismissBotInboxItem(key: String) { if (botWritable()) connection?.dismissBotInboxItem(key) }
    fun createBotGroup(title: String, memberIds: List<String>, bossBotId: String) {
        if (botWritable()) connection?.createBotGroup(title, memberIds, bossBotId)
    }
    fun openBotDirect(botId: String) { if (botWritable()) connection?.openBotDirect(botId) }
    private fun botReadable(): Boolean = mutable.value.let {
        visible && it.paired && !it.busy && it.link.phase == LinkPhase.Online && it.link.bots?.enabled == true
    }
    fun loadBotArtifacts(target: DesktopBotArtifactTarget) {
        if (botReadable()) connection?.loadBotArtifacts(target)
    }
    fun loadBotArtifactImage(target: DesktopBotArtifactTarget, mediaId: String?, rel: String?) {
        if (botReadable()) connection?.loadBotArtifactImage(target, mediaId, rel)
    }
    fun listBotFiles(target: DesktopBotArtifactTarget) { if (botReadable()) connection?.listBotFiles(target) }
    fun readBotFile(target: DesktopBotArtifactTarget, fileId: String, offset: Long) {
        if (botReadable()) connection?.readBotFile(target, fileId, offset)
    }

    fun createTask(request: TaskLaunch) {
        val state = mutable.value
        if (!state.paired || state.busy || selectedSession != null || state.link.phase != LinkPhase.Online || state.link.readOnly) return
        connection?.createTask(request)
    }

    fun dismissCreation(sessionId: String?) {
        if (mutable.value.paired && !mutable.value.busy) connection?.dismissCreation(sessionId)
    }

    private fun currentSession(writing: Boolean = false): String? {
        val state = mutable.value
        val session = state.link.session ?: return null
        return selectedSession?.takeIf { state.paired && !state.busy && state.link.phase == LinkPhase.Online &&
            (!writing || !state.link.readOnly) && !session.loading && !session.error && session.timeline.sessionId == it }
    }

    fun unpair() {
        if (!loaded || mutable.value.busy) return
        val current = credentials
        if (current == null && mutable.value.problem != CompanionProblem.Storage) return
        val clearBroken = mutable.value.problem == CompanionProblem.Storage && mutable.value.link.phase == LinkPhase.Revoked
        stopWatch()
        mutable.value = mutable.value.copy(busy = true, problem = null)
        scope.launch {
            try {
                if (current != null && mutable.value.link.phase != LinkPhase.Revoked) withContext(io) { revoke(current) }
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) {
                if (mutable.value.link.phase != LinkPhase.Revoked) {
                    mutable.value = mutable.value.copy(busy = false, problem = CompanionProblem.Revoking)
                    return@launch
                }
            }
            clearAfterRevoke(current, problem = null, clearBroken = clearBroken)
        }
    }

    private fun install(saved: PairCredentials) {
        removeConnection()
        credentials = saved
        val mine = generation
        mutable.value = CompanionState(paired = true, deviceName = saved.deviceName)
        val link = try { linkFactory(saved) { store.pin(saved) } } catch (_: Exception) {
            mutable.value = mutable.value.copy(link = DesktopLinkState(phase = LinkPhase.Failed))
            return
        }
        connection = link
        observing = scope.launch {
            link.state.collect { next ->
                if (generation != mine) return@collect
                if (next.phase != LinkPhase.Revoked) {
                    mutable.value = mutable.value.copy(link = next)
                    if (next.phase == LinkPhase.Replaced || next.phase == LinkPhase.Failed) stopWatch()
                } else {
                    val alreadyClearing = mutable.value.busy
                    removeConnection()
                    mutable.value = mutable.value.copy(link = DesktopLinkState(phase = LinkPhase.Revoked), busy = true)
                    if (!alreadyClearing) scope.launch { clearAfterRevoke(saved, CompanionProblem.Revoked) }
                }
            }
        }
        link.setVisible(visible)
    }

    private suspend fun clearAfterRevoke(saved: PairCredentials?, problem: CompanionProblem?, clearBroken: Boolean = false) {
        removeConnection()
        if (saved != null) mutable.value = mutable.value.copy(link = DesktopLinkState(phase = LinkPhase.Revoked))
        try {
            withContext(io) { store.clear(saved?.pairId.takeUnless { clearBroken }) }
            credentials = null
            mutable.value = CompanionState(problem = problem)
        } catch (error: CancellationException) { throw error }
        catch (_: Exception) { mutable.value = mutable.value.copy(busy = false, problem = CompanionProblem.Storage) }
    }

    private fun removeConnection() {
        stopWatch()
        generation++
        selectedSession = null
        observing?.cancel()
        observing = null
        connection?.close()
        connection = null
    }
}
