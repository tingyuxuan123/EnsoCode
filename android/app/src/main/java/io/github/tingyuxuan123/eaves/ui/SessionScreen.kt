package io.github.tingyuxuan123.eaves.ui

import android.graphics.BitmapFactory
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.mikepenz.markdown.m3.Markdown
import com.mikepenz.markdown.m3.markdownColor
import com.mikepenz.markdown.m3.markdownTypography
import com.mikepenz.markdown.model.markdownPadding
import io.github.tingyuxuan123.eaves.R
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.QueueCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopGoal
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.eaves.mirror.RewindBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionTaskKind
import io.github.tingyuxuan123.eaves.mirror.TaskStopBaseline
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput
import io.github.tingyuxuan123.eaves.mirror.SESSION_IMAGE_LIMIT
import io.github.tingyuxuan123.eaves.mirror.sessionImagePromptFits
import io.github.tingyuxuan123.eaves.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.pair.SessionApproval
import io.github.tingyuxuan123.eaves.pair.SessionAsk
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
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
) {
    val c = Enso.colors
    val timeline = state?.timeline
    val turns = remember(timeline?.messages) { sessionTurns(timeline?.messages.orEmpty()) }
    val approval = timeline?.approvals?.firstOrNull { !it.reviewing } ?: timeline?.approvals?.firstOrNull()
    val ask = timeline?.asks?.firstOrNull()
    val terminalError = timeline?.error
    val pendingResponses = state?.pendingResponses.orEmpty()
    val online = phase == LinkPhase.Online
    val writable = online && !readOnly && state?.loading == false && !state.error
    val isSpecimen = specimen != null
    val goals = remember(timeline?.sessionId) { SessionPanels() }
    val goal = state?.goal
    val textAttempt = state?.textAttempt
    LaunchedEffect(timeline?.sessionId, textAttempt?.id, textAttempt?.phase) {
        if (textAttempt?.phase == SessionCommandPhase.Observed && textAttempt.imageFingerprints.isEmpty() &&
            pictures.pictures.isEmpty() && !pictures.loading && draft == textAttempt.text) onDraft("")
    }
    val queueAttempt = state?.queueAttempt
    LaunchedEffect(timeline?.sessionId, queueAttempt?.id, queueAttempt?.phase) {
        if (queueAttempt?.command == QueueCommand.Enqueue && queueAttempt.phase == SessionCommandPhase.Observed &&
            pictures.pictures.isEmpty() && !pictures.loading && draft == queueAttempt.text) onDraft("")
    }
    BoxWithConstraints(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(28.dp).imePadding()) {
        val panelLimit = maxHeight * .55f
        val queueLimit = maxHeight * .32f
        Column(Modifier.fillMaxSize()) {
            TopBar(header.title, EnsoIcon.Menu, "打开任务列表", onDrawer, header.detail,
                showMenu = isSpecimen && approval != null, trailing = when {
                    onGoal != null || onMaintain != null || onRewind != null || onStopTask != null ||
                        onListFiles != null || onListPreviews != null || onOpenPreview != null -> ({
                        GlyphButton(EnsoIcon.More, "会话菜单", 44.dp, 24.dp, tint = c.ink2) {
                        goals.surface = SessionSurface.Menu
                    } })
                    approval != null -> ({ GlyphButton(EnsoIcon.More, "会话菜单（未接入）", 40.dp, 24.dp, tint = c.ink2) })
                    else -> null
                })
            if (goal != null) SessionGoalBar(goal, state.goalReady && online) { goals.surface = SessionSurface.GoalDetails }
            if (goals.surface == null) (taskStopNotice(state?.taskStop) ?: rewindNotice(state?.rewind)
                ?: maintenanceNotice(state?.maintenance, state?.compaction) ?: goalNotice(state?.goalAttempt))?.let { notice ->
                Label(notice, 12, 16, Modifier.padding(horizontal = 20.dp, vertical = 4.dp), color = c.dim)
            }
            if (!online && !isSpecimen) Label("连接已暂停 · 会话暂不可操作", 13, 18,
                Modifier.padding(horizontal = 20.dp, vertical = 6.dp), color = c.dim)
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp),
                reverseLayout = true, verticalArrangement = Arrangement.Top) {
                if (terminalError != null) item(key = "session-error") {
                    Label(terminalError, 13, 18, Modifier.padding(vertical = 12.dp), color = c.red)
                }
                items(turns.asReversed(), key = { "turn-${it.index}" }) { turn ->
                    if (turn.user) UserTurn(turn)
                    else AssistantTurn(turn, approval, specimen)
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
                    Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp), horizontalArrangement = Arrangement.Center) {
                        Label(date, 11, 14, color = c.faint)
                    }
                } else if (turns.isEmpty()) item(key = "session-empty") {
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
                            onAction = { command, id, text -> onQueue?.invoke(command, id, text) })
                    }
                    SessionComposer(state, writable, readOnly, draft, onDraft, onText, onStop,
                        onEnqueue = onQueue?.let { queue -> { text -> queue(QueueCommand.Enqueue, null, text) } },
                        pictures = pictures, onPickPictures = onPickPictures, onRemovePicture = onRemovePicture,
                        onSendPictures = onSendPictures)
                }
            }
        }
        SessionMenuPanels(goals, state, writable, readOnly, onGoal, onMaintain, onRewind, onStopTask,
            onListFiles, onReadFile, onListPreviews, onOpenPreview, onPreviewAction, onPreviewInput)
    }
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
    val tooLong = draft.length > SESSION_TEXT_LIMIT
    val canSend = canEdit && draft.isNotBlank() && !tooLong && state.textAttempt?.phase != SessionCommandPhase.Waiting &&
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
    val maySubmitPictures = writable && idle && fits && !pictures.loading && !waiting &&
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
        onAttach = onPickPictures.takeIf { canPick }, attachmentAvailable = onPickPictures != null)
}

private data class PictureBudgetInput(val sessionId: String, val text: String, val pictures: List<LocalSessionPicture>)

@Composable
private fun UserTurn(turn: SessionTurn) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().padding(start = 48.dp, bottom = 20.dp), horizontalArrangement = Arrangement.End) {
        val shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp)
        Column(Modifier.clip(shape).background(c.pill).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            turn.blocks.forEach { block -> when (block) {
                is SessionBlock.Prose -> Label(block.text, 16, 22, color = c.pillInk)
                is SessionBlock.Images -> TimelineImageStrip(block.images, Modifier.padding(top = 2.dp))
                SessionBlock.ImagePlaceholder -> Label("图片附件", 14, 20, color = c.pillInk)
                is SessionBlock.Steps -> Unit
            } }
        }
    }
}

@Composable
private fun AssistantTurn(turn: SessionTurn, approval: SessionApproval?, specimen: SessionSpecimen?) {
    val c = Enso.colors
    Column(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(22.dp).background(c.card, CircleShape), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.eaves_mark), null, Modifier.size(18.dp))
            }
            Label("小满", 15, 20, weight = FontWeight.SemiBold)
            val time = specimen?.turnTime ?: turn.timestamp?.let { DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it)) }
            if (time != null) Label(time, 12, 16, color = c.dim)
        }
        turn.blocks.forEachIndexed { index, block -> when (block) {
            is SessionBlock.Prose -> SessionMarkdown(block.text)
            is SessionBlock.Steps -> StepGroup(turn.index, index, block.steps, specimen?.steps)
            is SessionBlock.Images -> TimelineImageStrip(block.images)
            SessionBlock.ImagePlaceholder -> Label("图片附件", 14, 20, color = c.dim)
        } }
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

@Composable
private fun SessionMarkdown(text: String) {
    val c = Enso.colors
    // Session content is untrusted Markdown. The renderer's image transformer is no-op, and no
    // link, remote image or deep link may launch anything from an agent message.
    val inertLinks = remember { object : UriHandler { override fun openUri(uri: String) = Unit } }
    CompositionLocalProvider(LocalUriHandler provides inertLinks) {
        val prose = ensoText(15, 24)
        Markdown(content = text, modifier = Modifier.fillMaxWidth(),
            padding = markdownPadding(list = 2.dp, listItemTop = 2.dp, listItemBottom = 2.dp, listIndent = 12.dp),
            colors = markdownColor(text = c.ink, codeBackground = c.card2),
            typography = markdownTypography(text = prose, paragraph = prose, ordered = prose, bullet = prose, list = prose,
                h1 = ensoText(24, 32, FontWeight.SemiBold), h2 = ensoText(22, 30, FontWeight.SemiBold),
                h3 = ensoText(20, 28, FontWeight.SemiBold), h4 = ensoText(18, 26, FontWeight.SemiBold),
                h5 = ensoText(17, 24, FontWeight.Medium), h6 = ensoText(16, 24, FontWeight.Medium), quote = prose,
                code = ensoText(13, 20, font = Enso.mono), inlineCode = ensoText(14, 20, font = Enso.mono)))
    }
}

@Composable
private fun StepGroup(turn: Long, index: Int, steps: List<SessionStep>, description: String?) {
    val c = Enso.colors
    var expanded by remember(turn, index) { mutableStateOf(false) }
    val shape = RoundedCornerShape(14.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.card2.copy(alpha = .6f))) {
        Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { expanded = !expanded }
            .semantics { stateDescription = if (expanded) "已展开" else "已折叠" }
            .padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Glyph(if (description != null) EnsoIcon.CircleCheck else EnsoIcon.Terminal, Modifier.size(16.dp), c.dim)
            Label(description ?: "${steps.size} 个工作步骤", 14, 20, Modifier.weight(1f), color = c.dim)
            Glyph(if (expanded) EnsoIcon.Down else EnsoIcon.Right, Modifier.size(16.dp), c.faint)
        }
        if (expanded) Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            steps.forEach { step ->
                Label(step.name, 13, 18, weight = FontWeight.Medium)
                step.detail?.let { Label(it, 13, 18, color = c.dim) }
                step.result?.let { Label(it, 13, 18, color = c.dim) }
            }
        }
    }
}

@Composable
private fun ApprovalPanel(request: SessionApproval, writable: Boolean, pending: Boolean, modifier: Modifier,
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
private fun AskPanel(request: SessionAsk, writable: Boolean, pending: Boolean, modifier: Modifier,
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
