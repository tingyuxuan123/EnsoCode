package io.github.tingyuxuan123.codekiln.ui

import android.graphics.BitmapFactory
import android.os.SystemClock
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.codekiln.R
import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.mirror.DesktopFileEntry
import io.github.tingyuxuan123.codekiln.mirror.FileDownloadTarget
import io.github.tingyuxuan123.codekiln.mirror.SessionImageTarget
import io.github.tingyuxuan123.codekiln.mirror.DesktopProvider
import io.github.tingyuxuan123.codekiln.mirror.TaskThinkingLevel
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.mirror.QueueCommand
import io.github.tingyuxuan123.codekiln.mirror.DesktopGoal
import io.github.tingyuxuan123.codekiln.mirror.GoalCommand
import io.github.tingyuxuan123.codekiln.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.codekiln.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.codekiln.mirror.RewindBaseline
import io.github.tingyuxuan123.codekiln.mirror.SessionTaskKind
import io.github.tingyuxuan123.codekiln.mirror.TaskStopBaseline
import io.github.tingyuxuan123.codekiln.mirror.DesktopPreviewAction
import io.github.tingyuxuan123.codekiln.mirror.DesktopPreviewInput
import io.github.tingyuxuan123.codekiln.mirror.SESSION_IMAGE_LIMIT
import io.github.tingyuxuan123.codekiln.mirror.sessionImagePromptFits
import io.github.tingyuxuan123.codekiln.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.codekiln.mirror.SessionCommandPhase
import io.github.tingyuxuan123.codekiln.pair.SessionApproval
import io.github.tingyuxuan123.codekiln.pair.SessionAsk
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max

internal data class SessionHeader(val title: String, val detail: String? = null)

internal data class SessionSpecimen(
    val header: SessionHeader,
    val state: DesktopSessionState,
    val date: String? = null,
    val turnTime: String? = null,
    val steps: String? = null,
    val changeSummary: Boolean = false,
    val approvalMode: String? = null,
    val approvalNote: String? = null,
    val askImages: List<String> = emptyList(),
)

@Composable
internal fun SessionScreen(
    header: SessionHeader,
    state: DesktopSessionState?,
    phase: LinkPhase,
    readOnly: Boolean,
    onDrawer: () -> Unit,
    onRetry: () -> Unit,
    onHistory: () -> Unit,
    onApproval: (String, String) -> Unit,
    onAsk: (String, String) -> Unit,
    specimen: SessionSpecimen? = null,
    draft: String = "",
    onDraft: (String) -> Unit = {},
    onText: (String, Boolean) -> Unit = { _, _ -> },
    onStop: () -> Unit = {},
    onQueue: ((QueueCommand, String?, String?) -> Unit)? = null,
    pictures: PictureDraftState = PictureDraftState(),
    onPickPictures: (() -> Unit)? = null,
    onRemovePicture: (String) -> Unit = {},
    onSendPictures: ((String) -> Unit)? = null,
    onGoal: ((GoalCommand, DesktopGoal?, String?) -> Unit)? = null,
    onMaintain: ((SessionMaintenanceCommand, MaintenanceBaseline, String?) -> Unit)? = null,
    onRewind: ((Long, Boolean, RewindBaseline) -> Unit)? = null,
    onStopTask: ((SessionTaskKind, String, TaskStopBaseline) -> Unit)? = null,
    onListFiles: (() -> Unit)? = null,
    onReadFile: ((String, Long) -> Unit)? = null,
    onListPreviews: (() -> Unit)? = null,
    onOpenPreview: ((String, Int, Int) -> Unit)? = null,
    onPreviewAction: ((DesktopPreviewAction) -> Unit)? = null,
    onPreviewInput: ((DesktopPreviewInput) -> Unit)? = null,
    onLoadImage: (suspend (SessionImageTarget) -> String?)? = null,
    fetchFile: ArtifactChunkReader? = null,
    modelProviderId: String? = null,
    modelId: String? = null,
    modelProviders: List<DesktopProvider>? = null,
    onSetModel: ((String, String) -> Unit)? = null,
    reasoningEnabled: Boolean? = null,
    thinkingLevel: TaskThinkingLevel? = null,
    onSetReasoning: ((Boolean) -> Unit)? = null,
    onSetThinking: ((TaskThinkingLevel) -> Unit)? = null,
) {
    val c = Enso.colors
    val timeline = state?.timeline
    val downloads = LocalArtifactDownloads.current ?: if (fetchFile != null) rememberArtifactDownloads(timeline?.sessionId) else null
    val fileTarget = timeline?.sessionId?.let(FileDownloadTarget::Session)
    val turns = remember(timeline?.messages) { sessionTurns(timeline?.messages.orEmpty()) }
    val approval = timeline?.approvals?.firstOrNull { !it.reviewing } ?: timeline?.approvals?.firstOrNull()
    val ask = timeline?.asks?.firstOrNull()
    val terminalError = timeline?.error
    val pendingResponses = state?.pendingResponses.orEmpty()
    val online = phase == LinkPhase.Online
    val workStatus = remember(online, state?.loading, state?.error, state?.running, state?.compaction?.state,
        timeline?.messages, timeline?.approvals, timeline?.asks) { sessionWorkingStatus(state, online) }
    val workSince = remember(timeline?.sessionId, timeline?.cursor?.get("epoch"), workStatus?.lastOutput, workStatus?.showElapsed) {
        workStatus?.takeIf { it.showElapsed }?.let { SystemClock.elapsedRealtime() }
    }
    val writable = online && !readOnly && state?.loading == false && !state.error
    val canSetModel = writable && onSetModel != null && state.modelReady
    var showModels by remember(timeline?.sessionId, timeline?.cursor?.get("epoch"), canSetModel) { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val modelLabel = modelId?.let { id ->
        modelProviders?.firstOrNull { it.id == modelProviderId }?.models?.firstOrNull { it.id == id }?.label ?: id
    } ?: "选择模型".takeIf { canSetModel }
    val headerDetail = listOfNotNull(modelLabel, thinkingLevel?.title()?.takeIf { reasoningEnabled == true },
        header.detail).joinToString(" · ").ifEmpty { null }
    val modelPhase = state?.modelAttempt?.phase
    val thinkingPhase = state?.thinkingAttempt?.phase
    val configuring = modelPhase == SessionCommandPhase.Waiting || thinkingPhase == SessionCommandPhase.Waiting
    val modelStatus = when (modelPhase) {
        SessionCommandPhase.Waiting -> "等待电脑确认模型切换…"
        SessionCommandPhase.Unconfirmed -> "未确认模型切换，请检查电脑端后再试。"
        SessionCommandPhase.Rejected -> "电脑未接受模型切换。"
        else -> null
    }
    val thinkingStatus = when (thinkingPhase) {
        SessionCommandPhase.Waiting -> "等待电脑确认思考设置…"
        SessionCommandPhase.Unconfirmed -> "未确认思考设置，请检查电脑端后再试。"
        SessionCommandPhase.Rejected -> "电脑未接受思考设置。"
        else -> null
    }
    val configStatus = when {
        modelPhase == SessionCommandPhase.Waiting -> modelStatus
        thinkingPhase == SessionCommandPhase.Waiting -> thinkingStatus
        (state?.thinkingAttempt?.id ?: -1) > (state?.modelAttempt?.id ?: -1) -> thinkingStatus
        else -> modelStatus
    }
    val isSpecimen = specimen != null
    val goals = remember(timeline?.sessionId) { SessionPanels() }
    val imageSlots = remember(timeline?.sessionId) { Semaphore(2) }
    val loadImage: (suspend (SessionImageTarget) -> String?)? = onLoadImage?.let { read ->
        { target -> imageSlots.withPermit { read(target) } }
    }
    val newestReply = turns.lastOrNull()?.takeUnless { it.user }
    LaunchedEffect(timeline?.sessionId, newestReply?.index, online, state?.running, state?.loading) {
        if (fetchFile != null && online && state?.running == false && !state.loading && !state.error && newestReply != null) {
            onListFiles?.invoke()
        }
    }
    val handleLink: (SessionLink) -> Boolean = { link ->
        when {
            !online -> false
            link is SessionLink.Preview && onListPreviews != null && onOpenPreview != null -> {
                goals.previewLink = link
                goals.surface = SessionSurface.Preview
                onListPreviews()
                true
            }
            link is SessionLink.File && onListFiles != null -> {
                goals.openedFile = null
                goals.fileAction = null
                goals.fileLink = link
                goals.surface = SessionSurface.Files
                onListFiles()
                true
            }
            else -> false
        }
    }
    val goal = state?.goal
    // A receipt may only clear the revision that was submitted. Text equality alone cannot tell a draft
    // edited A → B → A from an untouched A, so every local edit drops the "this is the submitted text" mark.
    var submittedRevision by remember(timeline?.sessionId) { mutableStateOf(true) }
    val editDraft: (String) -> Unit = { next ->
        submittedRevision = false
        onDraft(next)
    }
    val textAttempt = state?.textAttempt
    val queueAttempt = state?.queueAttempt
    // A receipt that was already observed when this screen opened confirmed a different draft; only a
    // transition to Observed while the screen is up may clear the composer.
    val openingTextReceipt = remember(timeline?.sessionId) { textAttempt?.id to textAttempt?.phase }
    val openingQueueReceipt = remember(timeline?.sessionId) { queueAttempt?.id to queueAttempt?.phase }
    LaunchedEffect(timeline?.sessionId, textAttempt?.id, textAttempt?.phase) {
        if (textAttempt?.phase == SessionCommandPhase.Observed && textAttempt.imageFingerprints.isEmpty() &&
            pictures.pictures.isEmpty() && !pictures.loading && draft == textAttempt.text && submittedRevision &&
            (textAttempt.id to textAttempt.phase) != openingTextReceipt) {
            submittedRevision = true
            onDraft("")
        }
    }
    LaunchedEffect(timeline?.sessionId, queueAttempt?.id, queueAttempt?.phase) {
        if (queueAttempt?.command == QueueCommand.Enqueue && queueAttempt.phase == SessionCommandPhase.Observed &&
            pictures.pictures.isEmpty() && !pictures.loading && draft == queueAttempt.text && submittedRevision &&
            (queueAttempt.id to queueAttempt.phase) != openingQueueReceipt) {
            submittedRevision = true
            onDraft("")
        }
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(c.card).designTopInset().designBottomInset(16.dp).imePadding()) {
        val panelLimit = maxHeight * .55f
        val queueLimit = maxHeight * .32f
        Column(Modifier.fillMaxSize()) {
            TopBar(header.title, EnsoIcon.Menu, "打开任务列表", onDrawer, headerDetail,
                showMenu = canSetModel || isSpecimen && approval != null,
                onDetailClick = if (canSetModel) ({ keyboard?.hide(); showModels = true }) else null,
                detailActionLabel = "切换会话模型", trailing = when {
                    onGoal != null || onMaintain != null || onRewind != null || onStopTask != null ||
                        onListFiles != null || onListPreviews != null || onOpenPreview != null -> ({
                        GlyphButton(EnsoIcon.More, "会话菜单", 44.dp, 24.dp, tint = c.ink2) {
                        goals.surface = SessionSurface.Menu
                    } })
                    approval != null -> ({ GlyphButton(EnsoIcon.More, "会话菜单（未接入）", 40.dp, 24.dp, tint = c.ink2) })
                    else -> null
                })
            Hairline()
            if (goal != null) SessionGoalBar(goal, state.goalReady && online) { goals.surface = SessionSurface.GoalDetails }
            if (goals.surface == null) (taskStopNotice(state?.taskStop) ?: rewindNotice(state?.rewind)
                ?: maintenanceNotice(state?.maintenance, state?.compaction) ?: goalNotice(state?.goalAttempt))?.let { notice ->
                Label(notice, 12, 16, Modifier.padding(horizontal = 20.dp, vertical = 4.dp), color = c.dim)
            }
            if (!online && !isSpecimen) Label("连接已暂停 · 会话暂不可操作", 13, 18,
                Modifier.padding(horizontal = 20.dp, vertical = 6.dp), color = c.dim)
            if (!showModels && configStatus != null) Label(configStatus, 12, 16,
                Modifier.padding(horizontal = 20.dp, vertical = 4.dp), color = c.dim)
            LazyColumn(Modifier.weight(1f).align(Alignment.CenterHorizontally).widthIn(max = 740.dp)
                .fillMaxWidth().padding(horizontal = 16.dp),
                reverseLayout = true, verticalArrangement = Arrangement.Top) {
                if (workStatus != null && terminalError == null) item(key = "session-working") { SessionWorkingRow(workStatus, workSince) }
                if (terminalError != null) item(key = "session-error") {
                    Label(terminalError, 13, 18, Modifier.padding(vertical = 12.dp), color = c.red)
                }
                items(turns.asReversed(), key = { "turn-${it.index}" }) { turn ->
                    if (turn.user) UserTurn(turn)
                    else when (val block = turn.blocks.singleOrNull()) {
                        is SessionBlock.Compaction -> TimelineDisclosure("上下文已压缩", block.summary,
                            EnsoIcon.Compress, Modifier.padding(vertical = 8.dp))
                        is SessionBlock.Notice -> TimelineDisclosure(block.kind.title, block.detail,
                            EnsoIcon.Terminal, Modifier.padding(vertical = 8.dp))
                        else -> CompositionLocalProvider(LocalConversationLink provides handleLink) {
                            AssistantTurn(turn, approval, specimen, state?.running == true && turn.index == newestReply?.index,
                                loadImage, state?.files?.entries.orEmpty(), downloads, fileTarget, onArtifact = { entry: DesktopFileEntry ->
                                    openSessionArtifact(goals, entry, fetchFile, onReadFile, downloads, fileTarget)
                                }.takeIf { online && (onReadFile != null || fetchFile != null) })
                        }
                    }
                }
                if (state != null && (state.loadingHistory || (state.hasMoreHistory && state.timeline.baseIndex > 0))) {
                    item(key = "session-history") {
                        Row(Modifier.fillMaxWidth().padding(vertical = 6.dp)
                            .clickable(enabled = online && state.loadingHistory.not() && !state.loading && !state.error,
                                role = Role.Button, onClick = onHistory), horizontalArrangement = Arrangement.Center) {
                            Label(if (state.loadingHistory) "正在加载历史…" else "加载更早消息", 13, 20,
                                Modifier.padding(8.dp), color = c.dim)
                        }
                    }
                }
                if (state?.historyLimitReached == true) item(key = "session-history-limit") {
                    Label("已达到本机历史显示上限，更早的消息可在电脑端查看。", 13, 20,
                        Modifier.padding(vertical = 8.dp), color = c.dim)
                }
                val date = specimen?.date ?: turns.firstOrNull()?.timestamp?.let(::sessionDate)
                if (date != null) item(key = "session-date") {
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Hairline(Modifier.weight(1f))
                        Label(date, 11, 16, color = c.dim)
                        Hairline(Modifier.weight(1f))
                    }
                } else if (turns.isEmpty() && workStatus == null) item(key = "session-empty") {
                    Label(when {
                        state?.error == true -> "暂时无法同步会话"
                        !online -> "等待电脑上线"
                        state?.loading != false -> "正在同步会话…"
                        else -> "还没有消息"
                    }, 14, 20, Modifier.padding(vertical = 24.dp), color = c.dim)
                }
            }
            if (state?.error == true) {
                SessionAction("重新同步", Modifier.padding(horizontal = 12.dp).fillMaxWidth(), online, false, onClick = onRetry)
            }
            if (state?.responseFailed == true) Label("未收到桌面确认，请检查当前请求后再试。", 13, 18,
                Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = c.red)
            when {
                approval != null && (!approval.reviewing || ask == null) -> ApprovalPanel(approval, writable, approval.requestId in pendingResponses,
                    Modifier.heightIn(max = panelLimit), specimen, onApproval)
                ask != null -> AskPanel(ask, writable, ask.requestId in pendingResponses,
                    Modifier.heightIn(max = panelLimit), specimen, onAsk)
                else -> {
                    if (state != null && (state.queued.isNotEmpty() || state.queueAttempt != null)) {
                        SessionQueuePanel(state, writable && onQueue != null && state.queueReady && !state.backgroundWorkWaiting(), maxRowsHeight = queueLimit,
                            initialExpandedId = specimen?.state?.queued?.firstOrNull()?.id,
                            onAction = { command, id, text ->
                                if (command == QueueCommand.Enqueue && text == draft) submittedRevision = true
                                onQueue?.invoke(command, id, text)
                            })
                    }
                    Column(Modifier.align(Alignment.CenterHorizontally).widthIn(max = 740.dp).fillMaxWidth()) {
                        SessionComposer(state, writable, readOnly, draft, editDraft,
                            { text, runningMode -> submittedRevision = true; onText(text, runningMode) }, onStop,
                            onEnqueue = onQueue?.let { queue -> { text -> submittedRevision = true; queue(QueueCommand.Enqueue, null, text) } },
                            pictures = pictures, onPickPictures = onPickPictures, onRemovePicture = onRemovePicture,
                            onSendPictures = onSendPictures)
                    }
                }
            }
        }
        SessionMenuPanels(goals, state, writable, readOnly, onGoal, onMaintain, onRewind, onStopTask,
            onListFiles, onReadFile, onListPreviews, onOpenPreview, onPreviewAction, onPreviewInput, fetchFile, downloads)
    }
    if (showModels && canSetModel) SessionModelSheet(
        modelProviders, modelProviderId, modelId, state.running,
        enabled = !configuring, status = configStatus,
        onDismiss = { showModels = false }, onSelect = { provider, model ->
            if (provider != modelProviderId || model != modelId) onSetModel(provider, model)
        },
        reasoningEnabled = reasoningEnabled, thinkingLevel = thinkingLevel,
        onReasoning = onSetReasoning, onThinking = onSetThinking,
    )
}

@Composable
private fun SessionComposer(
    state: DesktopSessionState?, writable: Boolean, readOnly: Boolean, draft: String,
    onDraft: (String) -> Unit, onText: (String, Boolean) -> Unit, onStop: () -> Unit,
    onEnqueue: ((String) -> Unit)?,
    pictures: PictureDraftState, onPickPictures: (() -> Unit)?, onRemovePicture: (String) -> Unit,
    onSendPictures: ((String) -> Unit)?,
) {
    val c = Enso.colors
    val keyboard = LocalSoftwareKeyboardController.current
    val running = state?.running == true
    val canEdit = writable && (running || state?.canPrompt == true)
    val configWaiting = state?.modelAttempt?.phase == SessionCommandPhase.Waiting ||
        state?.thinkingAttempt?.phase == SessionCommandPhase.Waiting
    val tooLong = draft.length > SESSION_TEXT_LIMIT
    val canSend = canEdit && !configWaiting && draft.isNotBlank() && !tooLong && state.textAttempt?.phase != SessionCommandPhase.Waiting &&
        state.queueAttempt?.phase != SessionCommandPhase.Waiting && !state.goalLaunchWaiting() && !state.maintenanceWaiting()
    val canStop = writable && running && state.stopPhase != SessionCommandPhase.Waiting
    val hasPictures = pictures.pictures.isNotEmpty()
    val waiting = state?.textAttempt?.phase == SessionCommandPhase.Waiting
    val idle = state?.timeline?.status == "idle"
    val check = if (hasPictures && state != null) PictureBudgetInput(state.timeline.sessionId, draft, pictures.pictures) else null
    val budget by produceState<Pair<PictureBudgetInput, Boolean>?>(null, check) {
        value = check?.let { input -> input to withContext(Dispatchers.Default) {
            sessionImagePromptFits(input.sessionId, input.text, input.pictures.map { it.image })
        } }
    }
    val fits = check != null && budget?.first == check && budget?.second == true
    val maySubmitPictures = writable && idle && fits && !pictures.loading && !waiting && !configWaiting &&
        state.queueAttempt?.phase != SessionCommandPhase.Waiting && !state.goalLaunchWaiting() &&
            !state.maintenanceWaiting() && onSendPictures != null
    val canPick = writable && idle && !waiting && !pictures.loading && pictures.pictures.size < SESSION_IMAGE_LIMIT
    val send = { keyboard?.hide(); onText(draft, running) }
    val status = when (state?.textAttempt?.phase) {
        SessionCommandPhase.Waiting -> "正在等待桌面时间线更新…"
        SessionCommandPhase.Unconfirmed -> "未确认送达，草稿已保留。重发前请检查桌面。"
        SessionCommandPhase.Rejected -> "桌面拒绝发送，草稿已保留。"
        else -> null
    }
    if (status != null) Label(status, 12, 16, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = c.dim)
    val stopStatus = when (state?.stopPhase) {
        SessionCommandPhase.Waiting -> "正在等待桌面停止…"
        SessionCommandPhase.Unconfirmed -> "未确认停止，请检查桌面。"
        SessionCommandPhase.Rejected -> "桌面拒绝停止。"
        else -> null
    }
    if (stopStatus != null) Label(stopStatus, 12, 16, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = c.dim)
    if (tooLong) Label("消息过长，请缩短后发送。", 12, 16,
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = c.red)
    SessionPictureStrip(pictures, !waiting && !pictures.loading, onRemovePicture)
    if (hasPictures && !idle) Label("图片需等会话空闲后发送；本批不支持携带图片插话或入队。", 12, 16,
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = c.dim)
    if (check != null && budget?.first == check && !fits && !tooLong) Label("文字和图片合计超出发送上限，请减少图片或缩短文字。", 12, 16,
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = c.red)
    if (running && draft.isNotBlank() && !readOnly) Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
    ) {
        SessionAction("插话", Modifier, canSend && !hasPictures && !pictures.loading, onEnqueue == null, onClick = send)
        if (onEnqueue != null) SessionAction("加入队列", Modifier, canSend && !hasPictures && !pictures.loading && state.queueReady, true) { keyboard?.hide(); onEnqueue(draft) }
    }
    val action: (() -> Unit)? = when {
        running -> onStop.takeIf { canStop }
        hasPictures -> if (maySubmitPictures) ({ keyboard?.hide(); onSendPictures(draft) }) else null
        else -> send.takeIf { canSend && !pictures.loading }
    }
    Composer(draft, onDraft, action, placeholder = when {
        readOnly -> "只读会话"
        !canEdit -> "暂不可发送"
        running && onEnqueue != null -> if (state.queueReady) "继续说，会排进队列" else "正在同步桌面队列…"
        running -> "输入插话内容"
        else -> "继续说…"
    }, inputLabel = "会话消息", inputEnabled = canEdit, running = running, dimAction = action == null,
        onAttach = onPickPictures.takeIf { canPick }, attachmentAvailable = onPickPictures != null, actionInFrame = true)
}

private data class PictureBudgetInput(val sessionId: String, val text: String, val pictures: List<LocalSessionPicture>)

@Composable
private fun UserTurn(turn: SessionTurn) {
    val c = Enso.colors
    val images = remember(turn.blocks) { turn.blocks.filterIsInstance<SessionBlock.Images>().flatMap { it.images } }
    val bubble = remember(turn.blocks) { turn.blocks.filterNot { it is SessionBlock.Images } }
    BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 16.dp)) {
        val limit = maxWidth * .86f
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
            if (images.isNotEmpty()) TimelineImageStrip(images, Modifier.widthIn(max = limit), compact = true)
            if (bubble.isNotEmpty()) Column(Modifier.widthIn(max = limit).clip(RoundedCornerShape(16.dp))
                .background(c.card2).padding(horizontal = 13.dp, vertical = 9.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                bubble.forEach { block -> when (block) {
                    is SessionBlock.Prose -> UserMessageText(block.text)
                    is SessionBlock.Delegation -> SessionDelegationCard(block)
                    is SessionBlock.Routine -> SessionRoutineCard(block)
                    is SessionBlock.GroupMessages -> SessionGroupMessagesCard(block)
                    SessionBlock.ImagePlaceholder -> Label("图片附件", 13, 18, color = c.ink2)
                    else -> Unit
                } }
            }
            turn.timestamp?.let { Label(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)), 11, 16, color = c.dim) }
        }
    }
}

@Composable
private fun UserMessageText(text: String) {
    var expanded by remember(text) { mutableStateOf(false) }
    var clipped by remember(text) { mutableStateOf(false) }
    Column(horizontalAlignment = Alignment.End) {
        SelectionContainer {
            Text(text, style = ensoText(15, 24), color = Enso.colors.ink,
                maxLines = if (expanded) Int.MAX_VALUE else 5, overflow = TextOverflow.Ellipsis,
                onTextLayout = { if (!expanded) clipped = it.hasVisualOverflow })
        }
        if (clipped) GlyphButton(if (expanded) EnsoIcon.Up else EnsoIcon.Down,
            if (expanded) "收起用户消息" else "展开用户消息", 40.dp, 16.dp, tint = Enso.colors.dim) { expanded = !expanded }
    }
}

@Composable
private fun AssistantTurn(turn: SessionTurn, approval: SessionApproval?, specimen: SessionSpecimen?, running: Boolean,
    onLoadImage: (suspend (SessionImageTarget) -> String?)?, files: List<DesktopFileEntry>,
    downloads: ArtifactDownloads?, target: FileDownloadTarget?,
    onArtifact: ((DesktopFileEntry) -> Unit)?) {
    val c = Enso.colors
    val blocks = remember(turn.blocks, running) { sessionWorklogBlocks(turn.blocks, running) }
    val artifacts = remember(turn, files) { replyArtifacts(turn, files) }
    Column(Modifier.fillMaxWidth().padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 22.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Image(painterResource(R.drawable.codekiln_mark), null, Modifier.size(18.dp))
            Label("CodeKiln", 12, 17, weight = FontWeight.Medium)
            turn.replyModel?.let { Label(it, 11, 16, Modifier.weight(1f, fill = false), color = c.dim, maxLines = 1) }
            val time = specimen?.turnTime ?: turn.timestamp?.let { DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)) }
            if (time != null) Label(time, 11, 16, color = c.dim, maxLines = 1)
        }
        blocks.forEach { block -> when (block) {
            is SessionBlock.Prose -> SessionMarkdown(block.text)
            is SessionBlock.Worklog -> SessionWorklogRow(block, specimen?.steps) { SessionMarkdown(it) }
            is SessionBlock.Steps -> Unit // Rendered only inside a worklog.
            is SessionBlock.Todos -> SessionTodoCard(block.items)
            is SessionBlock.Notice -> TimelineDisclosure(block.kind.title, block.detail, EnsoIcon.Terminal)
            is SessionBlock.Delegation -> SessionDelegationCard(block)
            is SessionBlock.Routine -> SessionRoutineCard(block)
            is SessionBlock.GroupMessages -> SessionGroupMessagesCard(block)
            is SessionBlock.Compaction -> TimelineDisclosure("上下文已压缩", block.summary, EnsoIcon.Compress)
            is SessionBlock.Images -> TimelineImageStrip(block.images)
            is SessionBlock.RemoteImage -> if (onLoadImage != null) TimelineRemoteImage(block.target, onLoadImage)
                else Label("图片需连接支持预览的桌面端", 13, 18, color = c.dim)
            SessionBlock.ImagePlaceholder -> Label("图片附件", 14, 20, color = c.dim)
        } }
        if (!running && onArtifact != null && artifacts.isNotEmpty()) SessionTurnArtifacts(artifacts, downloads, target, onArtifact)
        if (specimen?.changeSummary == true) Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Glyph(EnsoIcon.FileDiff, Modifier.size(18.dp), c.ink2)
            Label("改动了 2 个文件", 14, 20, Modifier.weight(1f), weight = FontWeight.Medium)
            Label("+38", 13, 20, color = c.green)
            Label("−6", 13, 20, color = c.red)
            Glyph(EnsoIcon.Right, Modifier.size(16.dp), c.faint)
        }
        if (approval != null && (specimen != null || turn.blocks.filterIsInstance<SessionBlock.Steps>()
                .any { group -> group.steps.any { it.callId != null && it.callId == approval.toolCallId } })) {
            Row(Modifier.fillMaxWidth().background(c.card, RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Glyph(EnsoIcon.Terminal, Modifier.size(16.dp), c.dim)
                Text("${approval.tool}: ${approval.summary}", Modifier.weight(1f), color = c.ink,
                    style = ensoText(13, 18, font = Enso.mono), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                Label(if (approval.reviewing) "代审中" else "等你批准", 11, 14,
                    Modifier.background(c.yellow.copy(alpha = .15f), CircleShape).padding(horizontal = 10.dp, vertical = 4.dp),
                    color = c.ink2, weight = FontWeight.Medium)
            }
        }
    }
}

/** Desktop-style footer, but describes delivered files, not a diff we did not receive. */
@Composable
private fun SessionTurnArtifacts(files: List<DesktopFileEntry>, downloads: ArtifactDownloads?,
    target: FileDownloadTarget?, open: (DesktopFileEntry) -> Unit) {
    val c = Enso.colors
    val transfers = downloads?.state?.collectAsState()?.value.orEmpty()
    val shape = RoundedCornerShape(8.dp)
    var expanded by remember(files.map { it.id }) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(top = 3.dp).clip(shape).border(.75.dp, c.line, shape)) {
        Row(Modifier.fillMaxWidth().background(c.card2.copy(alpha = .70f)).padding(horizontal = 11.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Glyph(EnsoIcon.Files, Modifier.size(15.dp), c.dim)
            Label("本轮产物", 12, 17, Modifier.weight(1f), weight = FontWeight.Medium)
            Label("${files.size} 个文件", 11, 16, color = c.dim)
        }
        (if (expanded) files else files.take(3)).forEach { file ->
            Hairline()
            Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { open(file) }.heightIn(min = 44.dp)
                .padding(horizontal = 11.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Glyph(EnsoIcon.FileText, Modifier.size(15.dp), c.dim)
                Label(file.name, 13, 18, Modifier.weight(1f), maxLines = 1)
                val status = target?.let { transfers[ArtifactDownloadKey(it, file.id)].cardLabel() }
                Label(status ?: fileSizeLabel(file.size), 11, 16, color = if (status == null) c.dim else c.ink2, maxLines = 1)
                Glyph(EnsoIcon.Right, Modifier.size(14.dp), c.dim)
            }
        }
        if (files.size > 3) {
            Hairline()
            Label(if (expanded) "收起文件" else "还有 ${files.size - 3} 个文件", 12, 17,
                Modifier.fillMaxWidth().clickable(role = Role.Button) { expanded = !expanded }
                    .padding(horizontal = 11.dp, vertical = 12.dp), color = c.dim)
        }
    }
}

@Composable
internal fun ApprovalPanel(request: SessionApproval, writable: Boolean, pending: Boolean, modifier: Modifier,
    specimen: SessionSpecimen?, respond: (String, String) -> Unit) {
    val c = Enso.colors
    val remaining = secondsLeft(request.expiresAt, specimen != null)
    val enabled = writable && !pending && !request.reviewing && remaining != 0L
    SessionPanel(modifier) {
        PanelHeading(if (request.kind == "command") "它想运行一条命令" else "它需要你的批准",
            specimen?.approvalMode ?: if (request.protected) "仅可单次允许" else null)
        val command = if (request.kind == "command") "$ ${request.summary}" else request.summary
        Text(command, Modifier.padding(top = 12.dp).fillMaxWidth().background(c.card2, RoundedCornerShape(14.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp), color = c.ink, style = ensoText(14, 20, font = Enso.mono))
        specimen?.approvalNote?.let { Label(it, 12, 16, Modifier.padding(top = 8.dp), color = c.dim) }
        val notice = when {
            request.reviewing -> "正在由桌面审批策略检查"
            pending -> "正在等待桌面确认"
            remaining == 0L -> "请求已到期"
            !writable && specimen == null -> "当前连接不能提交审批"
            else -> null
        }
        notice?.let { Label(it, 12, 16, Modifier.padding(top = 8.dp), color = c.dim) }
        if (!request.reviewing) {
            Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SessionAction("拒绝", Modifier.weight(1f), enabled || specimen != null, false) { if (enabled) respond(request.requestId, "deny") }
                SessionAction("允许", Modifier.weight(1.4f), enabled || specimen != null, true, EnsoIcon.Check) {
                    if (enabled) respond(request.requestId, "allow")
                }
            }
            if (!request.protected) Row(Modifier.fillMaxWidth().padding(top = 8.dp)
                .clickable(enabled = enabled, role = Role.Button) { respond(request.requestId, "allowSession") }
                .padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center) {
                Label("本会话总是允许", 14, 20, color = c.ink2, weight = FontWeight.Medium)
            }
        }
    }
}

@Composable
internal fun AskPanel(request: SessionAsk, writable: Boolean, pending: Boolean, modifier: Modifier,
    specimen: SessionSpecimen?, respond: (String, String) -> Unit) {
    val c = Enso.colors
    val remaining = secondsLeft(request.expiresAt, specimen != null)
    val enabled = writable && !pending && remaining != 0L
    var selection by remember(request.requestId, request.options) { mutableStateOf<Int?>(if (specimen?.askImages?.isNotEmpty() == true) 0 else null) }
    var answer by remember(request.requestId) { mutableStateOf("") }
    SessionPanel(modifier) {
        val timer = remaining?.let { if (it == 0L) "已到期" else "%d:%02d 后视为未回答".format(Locale.ROOT, it / 60, it % 60) }
        PanelHeading("它在问你", timer, if (timer != null) EnsoIcon.Timer else null)
        Label(request.question, 17, 24, Modifier.padding(top = 10.dp), weight = FontWeight.Medium)
        if (specimen != null && specimen.askImages.size == 2 && request.options.size >= 2) {
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                specimen.askImages.forEachIndexed { index, asset ->
                    val shape = RoundedCornerShape(18.dp)
                    Column(Modifier.weight(1f).clip(shape).background(c.card).border(if (selection == index) 2.dp else .75.dp,
                        if (selection == index) c.ink else c.line, shape)
                        .selectable(selected = selection == index, role = Role.RadioButton) { selection = index }) {
                        PreviewOptionImage(asset)
                        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            Label(request.options[index], 14, 20, weight = FontWeight.Medium)
                            Text(asset, Modifier.weight(1f), color = c.dim, style = ensoText(11, 14, font = Enso.mono),
                                maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            if (selection == index) Glyph(EnsoIcon.Check, Modifier.size(16.dp))
                        }
                    }
                }
            }
        }
        val skip = if (specimen?.askImages?.size == 2) 2 else 0
        request.options.drop(skip).forEachIndexed { index, option ->
            val item = index + skip
            val shape = RoundedCornerShape(16.dp)
            Row(Modifier.padding(top = 10.dp).fillMaxWidth().clip(shape).background(c.card2)
                .border(if (selection == item) 2.dp else 0.dp, if (selection == item) c.ink else c.card2, shape)
                .selectable(selected = selection == item, enabled = enabled || specimen != null, role = Role.RadioButton) {
                    selection = item; answer = ""
                }
                .padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Label(option, 15, 20, Modifier.weight(1f))
                if (selection == item) Glyph(EnsoIcon.Check, Modifier.size(16.dp))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (!request.selectionOnly) Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(Enso.composerShape)
                .background(c.card).border(1.dp, c.line, Enso.composerShape).padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                BasicTextField(answer, { answer = it.take(4096); selection = null }, enabled = enabled,
                    modifier = Modifier.weight(1f).semantics { contentDescription = "自由回答" },
                    textStyle = ensoText(15, 22).copy(color = c.ink), cursorBrush = SolidColor(c.ink), maxLines = 3,
                    decorationBox = { inner -> Box {
                        if (answer.isEmpty()) Label("或者直接写你的回答", 15, 22, color = c.dim, maxLines = 1)
                        inner()
                    } })
                if (specimen != null) Glyph(EnsoIcon.Mic, Modifier.size(20.dp), label = "语音尚未接入")
            }
            val value = selection?.let(request.options::getOrNull) ?: answer.trim()
            SessionAction("回答", if (request.selectionOnly) Modifier.fillMaxWidth() else Modifier,
                (enabled && value.isNotEmpty()) || specimen != null, true, EnsoIcon.ArrowUp) {
                if (enabled && value.isNotEmpty()) respond(request.requestId, value)
            }
        }
        if (pending || (!writable && specimen == null)) Label(if (pending) "正在等待桌面确认" else "当前连接不能提交回答",
            12, 16, Modifier.padding(top = 8.dp), color = c.dim)
    }
}

@Composable
private fun PreviewOptionImage(asset: String) {
    val context = LocalContext.current
    val bitmap = remember(asset) { runCatching { context.assets.open(asset).use(BitmapFactory::decodeStream) }.getOrNull() }
    bitmap?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxWidth().aspectRatio(1.6f), contentScale = ContentScale.Crop) }
}

@Composable
private fun SessionPanel(modifier: Modifier, content: @Composable () -> Unit) {
    Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().then(modifier).glass(Enso.sheetShape)
        .verticalScroll(rememberScrollState()).padding(16.dp)) { content() }
}

@Composable
private fun PanelHeading(title: String, detail: String?, icon: EnsoIcon? = null) {
    val c = Enso.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Glyph(EnsoIcon.Waiting, Modifier.size(18.dp), c.yellow)
        Label(title, 15, 20, Modifier.weight(1f), weight = FontWeight.SemiBold)
        if (detail != null) {
            if (icon != null) Glyph(icon, Modifier.size(14.dp), c.dim)
            Label(detail, 12, 16, color = c.dim)
        }
    }
}

@Composable
private fun SessionAction(label: String, modifier: Modifier, enabled: Boolean, primary: Boolean,
    icon: EnsoIcon? = null, onClick: () -> Unit) {
    val c = Enso.colors
    val color = if (primary) c.pillInk else c.ink
    Row(modifier.heightIn(min = 48.dp).glass(inverted = primary, opacity = if (enabled) 1f else .45f)
        .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
        if (icon == EnsoIcon.Check) Glyph(icon, Modifier.size(20.dp), color)
        Label(label, 15, 20, color = color, weight = FontWeight.Medium)
        if (icon != null && icon != EnsoIcon.Check) Glyph(icon, Modifier.size(18.dp), color)
    }
}

@Composable
private fun secondsLeft(expiresAt: Long?, demo: Boolean): Long? {
    if (demo && expiresAt != null) return 292L
    if (expiresAt == null) return null
    val remaining by produceState(max(0L, (expiresAt - System.currentTimeMillis() + 999) / 1000), expiresAt) {
        while (value > 0) {
            delay(500)
            value = max(0L, (expiresAt - System.currentTimeMillis() + 999) / 1000)
        }
    }
    return remaining
}

private fun sessionDate(millis: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(millis))
