package io.github.tingyuxuan123.codekiln

import android.os.Bundle
import android.Manifest
import android.os.Build
import android.content.pm.PackageManager
import android.provider.Settings
import android.content.Intent
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.core.content.ContextCompat
import io.github.tingyuxuan123.codekiln.ui.EnsoTheme
import io.github.tingyuxuan123.codekiln.ui.HomeScreen
import io.github.tingyuxuan123.codekiln.ui.SettingsScreen
import io.github.tingyuxuan123.codekiln.mirror.DraftKey
import io.github.tingyuxuan123.codekiln.mirror.DraftKind
import io.github.tingyuxuan123.codekiln.ui.NewTaskScreen
import io.github.tingyuxuan123.codekiln.ui.NewTaskUiState
import io.github.tingyuxuan123.codekiln.ui.PairScreen
import io.github.tingyuxuan123.codekiln.ui.PairSpecimen
import io.github.tingyuxuan123.codekiln.ui.PairUiState
import io.github.tingyuxuan123.codekiln.ui.PairingScanner
import io.github.tingyuxuan123.codekiln.ui.SessionHeader
import io.github.tingyuxuan123.codekiln.ui.BoardScreen
import io.github.tingyuxuan123.codekiln.ui.MembersScreen
import io.github.tingyuxuan123.codekiln.ui.SessionScreen
import io.github.tingyuxuan123.codekiln.ui.SessionSpecimen
import io.github.tingyuxuan123.codekiln.mirror.DesktopLinkState
import io.github.tingyuxuan123.codekiln.mirror.BotThreadCommand
import io.github.tingyuxuan123.codekiln.mirror.DesktopBotArtifactTarget
import io.github.tingyuxuan123.codekiln.mirror.DesktopGoal
import io.github.tingyuxuan123.codekiln.mirror.GoalCommand
import io.github.tingyuxuan123.codekiln.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.codekiln.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.codekiln.mirror.RewindBaseline
import io.github.tingyuxuan123.codekiln.mirror.SessionTaskKind
import io.github.tingyuxuan123.codekiln.mirror.TaskStopBaseline
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.mirror.CreationPhase
import io.github.tingyuxuan123.codekiln.mirror.QueueCommand
import io.github.tingyuxuan123.codekiln.mirror.SessionCommandPhase
import io.github.tingyuxuan123.codekiln.mirror.SessionImage
import io.github.tingyuxuan123.codekiln.mirror.SessionImageTarget
import io.github.tingyuxuan123.codekiln.mirror.FileDownloadTarget
import io.github.tingyuxuan123.codekiln.ui.ArtifactFetcher
import io.github.tingyuxuan123.codekiln.ui.LocalArtifactDownloads
import io.github.tingyuxuan123.codekiln.ui.rememberArtifactDownloads
import io.github.tingyuxuan123.codekiln.mirror.SESSION_IMAGE_LIMIT
import io.github.tingyuxuan123.codekiln.mirror.TaskLaunch
import io.github.tingyuxuan123.codekiln.mirror.TaskThinkingLevel
import io.github.tingyuxuan123.codekiln.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.codekiln.pair.PairEncoding
import io.github.tingyuxuan123.codekiln.ui.TaskConfiguration
import io.github.tingyuxuan123.codekiln.ui.NewTaskConfigSheet
import io.github.tingyuxuan123.codekiln.ui.CreationNotice
import io.github.tingyuxuan123.codekiln.ui.title
import io.github.tingyuxuan123.codekiln.ui.PictureDraftState
import io.github.tingyuxuan123.codekiln.ui.PictureTicket
import io.github.tingyuxuan123.codekiln.ui.SessionPictureDraft
import io.github.tingyuxuan123.codekiln.ui.importSessionPictures

class MainActivity : ComponentActivity() {
    private class Invite(val link: String)
    private val invite = mutableStateOf<Invite?>(null)
    private val notice = mutableStateOf<TaskNoticeOpen?>(null)
    private val notificationsAllowed = mutableStateOf(false)
    private val companion get() = (application as CodeKilnApplication).companion

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) { consumeInvite(intent); consumeNotice(intent) }
        setContent {
            val state by companion.state.collectAsStateWithLifecycle()
            val book = (application as CodeKilnApplication).drafts
            val drafts by book.drafts.collectAsStateWithLifecycle()
            var link by remember { mutableStateOf("") }
            val incoming = invite.value
            val pendingNotice = notice.value
            val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                notificationsAllowed.value = LinkNotifications(this).permitted()
                if (granted) startWatch() else Toast.makeText(this, "未授予通知权限，后台提醒未开启。", Toast.LENGTH_SHORT).show()
            }
            LaunchedEffect(state.pairId, state.paired) { book.bind(state.pairId.takeIf { state.paired }) }
            LaunchedEffect(incoming) { if (incoming != null) link = incoming.link }
            CodeKilnApp(state = state.taskUi(System.currentTimeMillis()), pairState = state.pairUi(),
                settings = state.settingsUi(notificationsAllowed.value),
                drafts = drafts, onDraftEdit = book::edit,
                onDraftPin = { key -> book.pin(key) },
                onDraftConfirmed = { key, text -> book.confirm(key, text) },
                pairLink = link, onPairLink = { link = it.take(8192) },
                onPair = { companion.pair(link) }, onReconnect = companion::reconnect,
                onUnpair = companion::unpair, openPairInvite = incoming,
                scanner = { PairingScanner { link = it } }, live = state.link,
                onSelectSession = companion::selectSession, onSessionRetry = companion::retrySession,
                onHistory = companion::loadHistory, onApproval = companion::respondApproval, onAsk = companion::respondAsk,
                onSessionText = companion::submitText, onSessionStop = companion::stopSession,
                onSessionModel = companion::setSessionModel,
                onSessionReasoning = companion::setSessionReasoning, onSessionThinking = companion::setSessionThinking,
                onCreateTask = companion::createTask, onDismissCreation = companion::dismissCreation,
                onSessionQueue = companion::queueAction, onSessionImages = companion::submitImages,
                onSessionGoal = companion::goalAction,
                onSessionMaintain = companion::maintain,
                onSessionRewind = companion::rewind,
                onSessionStopTask = companion::stopTask,
                onSessionListFiles = companion::listFiles,
                onSessionReadFile = companion::readFile,
                fetchArtifact = companion::fetchFileChunk,
                downloadPairId = state.pairId,
                loadSessionImage = companion::loadSessionImage,
                onSessionListPreviews = companion::listPreviews,
                onSessionOpenPreview = companion::openPreview,
                onSessionPreviewAction = companion::previewAction,
                onSessionPreviewInput = companion::previewInput,
                onRequestBots = companion::requestBots,
                onRequestInbox = companion::requestInbox,
                onOpenBotChat = companion::openBotChat,
                onCloseBotChat = companion::closeBotChat,
                onLoadBotTimeline = companion::loadBotTimeline,
                onSendBotMessage = companion::sendBotMessage,
                onStopBotChat = companion::stopBotChat,
                onChangeBotThread = companion::changeBotThread,
                onBotNewSession = companion::requestBotNewSession,
                onBotConfirmNewSession = companion::confirmBotNewSession,
                onBotRetryEntry = companion::retryBotEntry,
                onBotDismissInbox = companion::dismissBotInboxItem,
                onBotCreateGroup = companion::createBotGroup,
                onBotOpenDirect = companion::openBotDirect,
                onBotArtifacts = companion::loadBotArtifacts,
                onBotArtifactImage = companion::loadBotArtifactImage,
                onBotListFiles = companion::listBotFiles,
                onBotReadFile = companion::readBotFile,
                onWatch = {
                    if (state.watch.phase == WatchPhase.Active) companion.stopWatch()
                    else if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else startWatch()
                }, onNotificationSettings = ::openNotificationSettings,
                openTaskNotice = pendingNotice, onNoticeConsumed = { if (notice.value == pendingNotice) notice.value = null })
            LaunchedEffect(state.paired) {
                if (state.paired) { link = ""; invite.value = null }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        companion.setVisible(true)
        notificationsAllowed.value = LinkNotifications(this).permitted()
    }
    override fun onStop() {
        companion.setVisible(false)
        (application as CodeKilnApplication).drafts.flush()
        super.onStop()
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); consumeInvite(intent); consumeNotice(intent) }

    private fun startWatch() {
        if (!LinkNotifications(this).permitted()) {
            Toast.makeText(this, "请在通知设置中允许后台连接通知。", Toast.LENGTH_SHORT).show()
            return
        }
        val token = companion.requestWatch() ?: return
        try {
            ContextCompat.startForegroundService(this, Intent(this, LinkService::class.java).setAction(LinkService.START)
                .putExtra(LinkNotifications.EXTRA_TOKEN, token))
        } catch (_: RuntimeException) { companion.stopWatch(token, failed = true) }
    }

    private fun openNotificationSettings() {
        try { startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) }
        catch (_: android.content.ActivityNotFoundException) { Toast.makeText(this, "请在系统设置中管理 CodeKiln 通知。", Toast.LENGTH_SHORT).show() }
    }

    private fun consumeNotice(value: Intent) {
        if (value.action != LinkNotifications.OPEN || value.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        val token = value.getStringExtra(LinkNotifications.EXTRA_TOKEN)
        val sessionId = value.getStringExtra(LinkNotifications.EXTRA_SESSION)
        value.action = null
        value.removeExtra(LinkNotifications.EXTRA_TOKEN)
        value.removeExtra(LinkNotifications.EXTRA_SESSION)
        if (token != null && companion.canOpenWatch(token) &&
            (sessionId == null || sessionId.length in 1..512 && sessionId.none { it.isISOControl() })) {
            notice.value = TaskNoticeOpen(sessionId)
        }
    }

    private fun consumeInvite(value: Intent) {
        if (value.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        val uri = value.data ?: return
        if (value.action == Intent.ACTION_VIEW && uri.scheme == PairEncoding.PAIR_SCHEME && uri.host == PairEncoding.PAIR_HOST) {
            value.dataString?.takeIf { it.length <= 8192 }?.let { invite.value = Invite(it) }
            value.data = null
        }
    }
}

internal enum class CodeKilnRoute { NewTask, Home, Pair, Session, Board, Members, Settings }
internal class TaskNoticeOpen(val sessionId: String?)

@Composable
internal fun CodeKilnApp(
    initialRoute: CodeKilnRoute = CodeKilnRoute.NewTask,
    state: NewTaskUiState = NewTaskUiState(),
    pairSpecimen: PairSpecimen? = null,
    pairState: PairUiState = PairUiState(),
    pairLink: String = "",
    onPairLink: (String) -> Unit = {},
    onPair: (() -> Unit)? = null,
    onReconnect: (() -> Unit)? = null,
    onUnpair: (() -> Unit)? = null,
    openPairInvite: Any? = null,
    scanner: (@Composable () -> Unit)? = null,
    live: DesktopLinkState = DesktopLinkState(),
    settings: SettingsUiState = SettingsUiState(),
    drafts: Map<DraftKey, String> = emptyMap(),
    onDraftEdit: (DraftKey, String) -> Unit = { _, _ -> },
    /** 显式登记一次真实提交；读草稿文本永远不会调用它。 */
    onDraftPin: (DraftKey) -> Unit = {},
    onDraftConfirmed: (DraftKey, String) -> Unit = { _, _ -> },
    onSelectSession: ((String?) -> Unit)? = null,
    onSessionRetry: () -> Unit = {},
    onHistory: () -> Unit = {},
    onApproval: (String, String, String) -> Unit = { _, _, _ -> },
    onAsk: (String, String, String) -> Unit = { _, _, _ -> },
    sessionSpecimen: SessionSpecimen? = null,
    onSessionText: (String, String, Boolean) -> Unit = { _, _, _ -> },
    onSessionStop: (String) -> Unit = {},
    onCreateTask: ((TaskLaunch) -> Unit)? = null,
    onDismissCreation: (String?) -> Unit = {},
    initialShowConfig: Boolean = false,
    onSessionQueue: ((String, QueueCommand, String?, String?) -> Unit)? = null,
    onSessionImages: ((String, String, List<SessionImage>) -> Unit)? = null,
    onWatch: (() -> Unit)? = null,
    onNotificationSettings: (() -> Unit)? = null,
    openTaskNotice: TaskNoticeOpen? = null,
    onNoticeConsumed: () -> Unit = {},
    onSessionGoal: ((String, GoalCommand, DesktopGoal?, String?) -> Unit)? = null,
    onSessionMaintain: ((String, SessionMaintenanceCommand, MaintenanceBaseline, String?) -> Unit)? = null,
    onSessionRewind: ((String, Long, Boolean, RewindBaseline) -> Unit)? = null,
    onSessionStopTask: ((String, SessionTaskKind, String, TaskStopBaseline) -> Unit)? = null,
    onSessionListFiles: ((String) -> Unit)? = null,
    onSessionReadFile: ((String, String, Long) -> Unit)? = null,
    onSessionListPreviews: ((String) -> Unit)? = null,
    onSessionOpenPreview: ((String, String, Int, Int) -> Unit)? = null,
    onSessionPreviewAction: ((String, io.github.tingyuxuan123.codekiln.mirror.DesktopPreviewAction) -> Unit)? = null,
    onSessionPreviewInput: ((String, io.github.tingyuxuan123.codekiln.mirror.DesktopPreviewInput) -> Unit)? = null,
    onRequestBots: (() -> Unit)? = null,
    onRequestInbox: (() -> Unit)? = null,
    onOpenBotChat: ((String) -> Unit)? = null,
    onCloseBotChat: ((String) -> Unit)? = null,
    onLoadBotTimeline: ((String, Long?) -> Unit)? = null,
    onSendBotMessage: ((String, String, String) -> Unit)? = null,
    onStopBotChat: ((String) -> Unit)? = null,
    onChangeBotThread: ((String, BotThreadCommand, String?, String) -> Unit)? = null,
    onSessionModel: ((String, String, String) -> Unit)? = null,
    onSessionReasoning: ((String, Boolean) -> Unit)? = null,
    onSessionThinking: ((String, TaskThinkingLevel) -> Unit)? = null,
    onBotNewSession: ((String) -> Unit)? = null,
    onBotConfirmNewSession: ((String) -> Unit)? = null,
    onBotRetryEntry: ((String, String) -> Unit)? = null,
    onBotDismissInbox: ((String) -> Unit)? = null,
    onBotCreateGroup: ((String, List<String>, String) -> Unit)? = null,
    onBotOpenDirect: ((String) -> Unit)? = null,
    onBotArtifacts: ((DesktopBotArtifactTarget) -> Unit)? = null,
    onBotArtifactImage: ((DesktopBotArtifactTarget, String?, String?) -> Unit)? = null,
    onBotListFiles: ((DesktopBotArtifactTarget) -> Unit)? = null,
    onBotReadFile: ((DesktopBotArtifactTarget, String, Long) -> Unit)? = null,
    fetchArtifact: ArtifactFetcher? = null,
    downloadPairId: String? = null,
    loadSessionImage: (suspend (String, SessionImageTarget) -> String?)? = null,
) {
    var route by rememberSaveable { mutableStateOf(initialRoute) }
    var pairReturn by rememberSaveable { mutableStateOf(CodeKilnRoute.Home) }
    var settingsReturn by rememberSaveable { mutableStateOf(CodeKilnRoute.Home) }
    var boardReturn by rememberSaveable { mutableStateOf(CodeKilnRoute.NewTask) }
    var membersReturn by rememberSaveable { mutableStateOf(CodeKilnRoute.Home) }
    val descriptionKey = DraftKey(DraftKind.NewTask, "new-task")
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var memberSessionId by remember(pairState.paired) { mutableStateOf<String?>(null) }
    // Drafts live in DraftBook: per session, bounded, encrypted at rest and never in a Bundle.
    val sessionKey = selectedId?.let { DraftKey(DraftKind.Session, it) }
    val sessionDraft = sessionKey?.let { drafts[it] }.orEmpty()
    val onSessionDraft: (String) -> Unit = { text -> sessionKey?.let { onDraftEdit(it, text) } }
    val draft = drafts[descriptionKey] ?: state.draft
    var config by remember(pairState.paired) { mutableStateOf(TaskConfiguration()) }
    var showConfig by remember { mutableStateOf(initialShowConfig) }
    var confirmNew by remember { mutableStateOf(false) }
    var launching by remember(pairState.paired) { mutableStateOf<TaskLaunch?>(null) }
    val creation = live.creation
    val creating = creation?.phase == CreationPhase.Creating
    val keyboard = LocalSoftwareKeyboardController.current
    var selectedTitle by remember { mutableStateOf<String?>(null) }
    var selectedProject by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val pictureScope = rememberCoroutineScope()
    val resolver = context.applicationContext.contentResolver
    val pictureDraft = remember(pictureScope, resolver) {
        SessionPictureDraft(pictureScope) { sources, remaining -> importSessionPictures(resolver, sources, remaining) }
    }
    val imageState by pictureDraft.state.collectAsStateWithLifecycle()
    var pickerTicket by remember { mutableStateOf<PictureTicket?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(SESSION_IMAGE_LIMIT)) { uris ->
        val ticket = pickerTicket
        pickerTicket = null
        if (route == CodeKilnRoute.Session && ticket?.owner == selectedId && pairState.paired) {
            pictureDraft.select(ticket, uris.map { it.toString() })
        }
    }
    LaunchedEffect(pairState.paired, selectedId) {
        pictureDraft.bind(selectedId.takeIf { pairState.paired })
        if (pickerTicket?.owner != selectedId || !pairState.paired) pickerTicket = null
    }
    val observedImages = live.session?.textAttempt
    LaunchedEffect(selectedId, observedImages?.id, observedImages?.phase) {
        val owner = live.session?.timeline?.sessionId ?: return@LaunchedEffect
        if (owner == selectedId && observedImages?.phase == SessionCommandPhase.Observed && observedImages.imageFingerprints.isNotEmpty()) {
            val cleared = pictureDraft.observed(owner, observedImages.text, observedImages.imageFingerprints, observedImages.id)
            if (cleared != null && sessionDraft == cleared) onSessionDraft("")
        }
    }
    // A confirmed rewind may hand back the removed message; never overwrite text the user typed since.
    val observedRewind = live.session?.rewind
    LaunchedEffect(selectedId, observedRewind?.id, observedRewind?.phase) {
        val owner = live.session?.timeline?.sessionId ?: return@LaunchedEffect
        val text = observedRewind?.editorText ?: return@LaunchedEffect
        if (owner == selectedId && observedRewind.phase == SessionCommandPhase.Observed && sessionDraft.isBlank()) {
            onSessionDraft(text)
        }
    }
    val unavailable = { Toast.makeText(context, "此开发版本尚未接入这项功能。", Toast.LENGTH_SHORT).show() }
    val openPair = {
        if (!creating) {
            pairReturn = route
            route = CodeKilnRoute.Pair
        }
    }
    val openTask: (String) -> Unit = { id ->
        val task = state.tasks.firstOrNull { it.id == id }
        if (!creating && task != null && onSelectSession != null) {
            selectedId = id
            selectedTitle = task.title
            selectedProject = task.project
            route = CodeKilnRoute.Session
        } else if (!creating) unavailable()
    }
    val back = {
        route = when (route) {
            CodeKilnRoute.Pair -> pairReturn
            CodeKilnRoute.Session -> CodeKilnRoute.Home
            CodeKilnRoute.Board -> boardReturn
            CodeKilnRoute.Members -> membersReturn
            CodeKilnRoute.Settings -> settingsReturn
            else -> CodeKilnRoute.NewTask
        }
    }
    val openBoard = {
        if (!creating) { boardReturn = route; route = CodeKilnRoute.Board }
    }
    val openMembers = {
        if (!creating) { membersReturn = route; route = CodeKilnRoute.Members }
    }
    val openSettings = {
        if (!creating) { settingsReturn = route; route = CodeKilnRoute.Settings }
    }
    val subscribedId = if (route == CodeKilnRoute.Members) memberSessionId else selectedId.takeIf { route == CodeKilnRoute.Session }
    val selectable = state.tasks.any { it.id == subscribedId } || (route == CodeKilnRoute.Members && memberSessionId != null)
    val sessionSendKey = { id: String -> DraftKey(DraftKind.Session, id) }
    // 逐字匹配回执并清掉「用户真的提交过」的那次草稿。pin 是跨页面的提交凭据：
    // 回执在离开会话页期间到达时仍能清除已投递内容，而从没 pin 过的同文草稿不会被误清。
    val textReceipt = live.session?.let { it.timeline.sessionId to it.textAttempt }
    LaunchedEffect(textReceipt?.first, textReceipt?.second?.id, textReceipt?.second?.phase) {
        val owner = textReceipt?.first ?: return@LaunchedEffect
        val attempt = textReceipt.second ?: return@LaunchedEffect
        if (attempt.phase == SessionCommandPhase.Observed && attempt.imageFingerprints.isEmpty()) {
            onDraftConfirmed(sessionSendKey(owner), attempt.text)
        }
    }
    val queueReceipt = live.session?.let { it.timeline.sessionId to it.queueAttempt }
    LaunchedEffect(queueReceipt?.first, queueReceipt?.second?.id, queueReceipt?.second?.phase) {
        val owner = queueReceipt?.first ?: return@LaunchedEffect
        val attempt = queueReceipt.second ?: return@LaunchedEffect
        val text = attempt.text ?: return@LaunchedEffect
        if (attempt.command == QueueCommand.Enqueue && attempt.phase == SessionCommandPhase.Observed) {
            onDraftConfirmed(sessionSendKey(owner), text)
        }
    }
    LaunchedEffect(subscribedId, pairState.paired, selectable) {
        if (subscribedId == null || !pairState.paired) onSelectSession?.invoke(null)
        else if (selectable) onSelectSession?.invoke(subscribedId)
    }
    LaunchedEffect(openPairInvite) { if (openPairInvite != null && route != CodeKilnRoute.Pair) openPair() }
    LaunchedEffect(openTaskNotice) {
        if (openTaskNotice != null) {
            route = CodeKilnRoute.Home
            if (openTaskNotice.sessionId == null) onNoticeConsumed()
        }
    }
    LaunchedEffect(openTaskNotice, route, live.phase, live.catalogReady, state.tasks, pairState.paired) {
        val id = openTaskNotice?.sessionId ?: return@LaunchedEffect
        if (route != CodeKilnRoute.Home) return@LaunchedEffect
        if (!pairState.paired || live.phase in setOf(LinkPhase.Revoked, LinkPhase.Failed, LinkPhase.Replaced)) onNoticeConsumed()
        else if (live.phase == LinkPhase.Online && live.catalogReady) {
            if (state.tasks.any { it.id == id }) openTask(id)
            else Toast.makeText(context, "该任务已不在当前电脑的列表中。", Toast.LENGTH_SHORT).show()
            onNoticeConsumed()
        }
    }
    LaunchedEffect(creation?.sessionId, creation?.phase) {
        val created = creation?.takeIf { it.phase == CreationPhase.Created }?.sessionId ?: return@LaunchedEffect
        run {
            selectedId = created
            selectedTitle = null
            selectedProject = config.project(live.projects)?.name
            val creationKey = DraftKey(DraftKind.Session, created)
            onDraftEdit(creationKey, launching?.text?.takeUnless {
                live.session?.textAttempt?.let { attempt -> attempt.phase == SessionCommandPhase.Observed && attempt.text == it } == true
            }.orEmpty())
            if (draft == launching?.text) onDraftEdit(descriptionKey, "")
            launching = null
            route = CodeKilnRoute.Session
            showConfig = false
        }
    }
    BackHandler(enabled = creating || route != CodeKilnRoute.NewTask) { if (!creating) back() }
    val downloads = if (fetchArtifact != null) rememberArtifactDownloads(downloadPairId.takeIf { pairState.paired }) else null
    CompositionLocalProvider(LocalArtifactDownloads provides downloads) { EnsoTheme {
        when (route) {
            CodeKilnRoute.NewTask -> NewTaskScreen(
                state.copy(draft = draft, project = config.project(live.projects)?.name ?: state.project,
                    model = config.model(live.providers)?.label?.let { model -> config.thinkingLevel?.let { "$model · ${it.title()}" } ?: model } ?: state.model,
                    composerEnabled = !creating), onHome = { if (!creating) route = CodeKilnRoute.Home }, onPair = openPair,
                onConfig = { if (!creating) { if (state.online) { keyboard?.hide(); showConfig = true } else openPair() } },
                onBoard = openBoard, onTask = openTask, onDraft = { onDraftEdit(descriptionKey, it) },
                onSend = config.launch(live.projects, live.providers, draft)?.takeIf {
                    state.online && state.composerAvailable && !creating &&
                        (creation == null || creation.phase == CreationPhase.Created) && onCreateTask != null
                }?.let { request -> { keyboard?.hide(); launching = request; onCreateTask?.invoke(request) } },
                footer = {
                    CreationNotice(creation, draft.length > SESSION_TEXT_LIMIT,
                        onReview = { route = CodeKilnRoute.Home }, onUnlock = { confirmNew = true })
                },
            )
            CodeKilnRoute.Home -> HomeScreen(
                state, onNew = { route = CodeKilnRoute.NewTask }, onPair = openPair, onTask = openTask,
                onBoard = openBoard, onMembers = openMembers, onSettings = openSettings, onUnavailable = unavailable,
            )
            CodeKilnRoute.Members -> {
                LaunchedEffect(live.phase) {
                    if (live.phase == LinkPhase.Online) {
                        onRequestBots?.invoke()
                        onRequestInbox?.invoke()
                    }
                }
                MembersScreen(live.bots, onBack = back,
                    onOpenChat = { chatId -> onOpenBotChat?.invoke(chatId) },
                    onLoadOlder = { chatId, seq -> onLoadBotTimeline?.invoke(chatId, seq) },
                    writable = !live.readOnly && live.phase == LinkPhase.Online,
                    onSend = onSendBotMessage, onStop = onStopBotChat,
                    onCloseChat = { chatId -> onCloseBotChat?.invoke(chatId) }, onThreadChange = onChangeBotThread,
                    session = live.session, onSelectSession = { memberSessionId = it }, onHistory = onHistory,
                    onSessionRetry = onSessionRetry,
                    onApproval = { requestId, decision -> subscribedId?.let { onApproval(it, requestId, decision) } },
                    onAsk = { requestId, answer -> subscribedId?.let { onAsk(it, requestId, answer) } },
                    onStopSession = { subscribedId?.let(onSessionStop) },
                    onNewSession = onBotNewSession, onConfirmNewSession = onBotConfirmNewSession,
                    onRetryEntry = onBotRetryEntry, onDismissInbox = onBotDismissInbox, onCreateGroup = onBotCreateGroup,
                    onArtifacts = onBotArtifacts, onArtifactImage = onBotArtifactImage,
                    onListBotFiles = onBotListFiles, onReadBotFile = onBotReadFile, onOpenDirect = onBotOpenDirect,
                    fetchArtifact = fetchArtifact,
                    drafts = drafts, onDraftEdit = onDraftEdit, onDraftPin = onDraftPin,
                    onDraftConfirmed = onDraftConfirmed)
            }
            CodeKilnRoute.Board -> BoardScreen(
                live.catalog.filterNot { it.archived }, System.currentTimeMillis(), onBack = back, onTask = openTask,
            )
            CodeKilnRoute.Pair -> PairScreen(onClose = back, specimen = pairSpecimen, state = pairState,
                link = pairLink, onLink = onPairLink, onPair = onPair, onReconnect = onReconnect,
                onUnpair = onUnpair, scanner = scanner, onWatch = onWatch, onNotificationSettings = onNotificationSettings)
            CodeKilnRoute.Settings -> SettingsScreen(settings, onBack = back,
                onReconnect = onReconnect.takeIf { pairState.paired && !pairState.busy },
                onWatch = onWatch, onNotificationSettings = onNotificationSettings,
                onUnpair = onUnpair, onPair = openPair)
            CodeKilnRoute.Session -> {
                val task = live.catalog.firstOrNull { it.id == selectedId && !it.archived }
                val canConfigure = task != null && task.parentId == null && live.catalogReady
                val currentConfigSession = { subscribedId?.takeIf { route == CodeKilnRoute.Session && selectedId == it } }
                val header = sessionSpecimen?.header ?: SessionHeader(
                    task?.title ?: selectedTitle ?: "会话", task?.projectName?.takeIf { it.isNotBlank() } ?: selectedProject,
                )
                SessionScreen(header, sessionSpecimen?.state ?: live.session?.takeIf { it.timeline.sessionId == selectedId },
                    if (sessionSpecimen != null) LinkPhase.Online else live.phase, live.readOnly,
                    onDrawer = { route = CodeKilnRoute.Home }, onRetry = onSessionRetry, onHistory = onHistory,
                    onApproval = { requestId, decision -> subscribedId?.let { onApproval(it, requestId, decision) } },
                    onAsk = { requestId, answer -> subscribedId?.let { onAsk(it, requestId, answer) } }, specimen = sessionSpecimen,
                    draft = sessionDraft, onDraft = onSessionDraft,
                    onText = { text, steer -> subscribedId?.let { id -> onDraftPin(sessionSendKey(id)); onSessionText(id, text, steer) } },
                    onStop = { subscribedId?.let(onSessionStop) },
                    modelProviderId = task?.providerId, modelId = task?.modelId, modelProviders = live.providers,
                    reasoningEnabled = task?.reasoningEnabled, thinkingLevel = task?.thinkingLevel,
                    onSetModel = onSessionModel?.takeIf { canConfigure }?.let { action -> { providerId, modelId ->
                        currentConfigSession()?.let { action(it, providerId, modelId) }
                    } },
                    onSetReasoning = onSessionReasoning?.takeIf { canConfigure }?.let { action -> { enabled ->
                        currentConfigSession()?.let { action(it, enabled) }
                    } },
                    onSetThinking = onSessionThinking?.takeIf { canConfigure }?.let { action -> { level ->
                        currentConfigSession()?.let { action(it, level) }
                    } },
                    onQueue = onSessionQueue?.let { queue -> { command, messageId, text ->
                        subscribedId?.let { id ->
                            if (command == QueueCommand.Enqueue && text != null) onDraftPin(sessionSendKey(id))
                            queue(id, command, messageId, text)
                        }
                    } },
                    onGoal = onSessionGoal?.let { action -> { command, expected, text ->
                        subscribedId?.let { action(it, command, expected, text) }
                    } },
                    onMaintain = onSessionMaintain?.let { action -> { command, baseline, text ->
                        subscribedId?.let { action(it, command, baseline, text) }
                    } },
                    onRewind = onSessionRewind?.let { action -> { index, restore, baseline ->
                        subscribedId?.let { action(it, index, restore, baseline) }
                    } },
                    onStopTask = onSessionStopTask?.let { action -> { kind, target, baseline ->
                        subscribedId?.let { action(it, kind, target, baseline) }
                    } },
                    onListFiles = onSessionListFiles?.let { action -> { subscribedId?.let(action) } },
                    onReadFile = onSessionReadFile?.let { action -> { fileId, offset ->
                        subscribedId?.let { action(it, fileId, offset) }
                    } },
                    fetchFile = fetchArtifact?.let { fetch -> subscribedId?.let { id -> { fileId, offset ->
                        fetch(FileDownloadTarget.Session(id), fileId, offset)
                    } } },
                    onLoadImage = loadSessionImage?.takeIf { live.sessionImages && live.phase == LinkPhase.Online }
                        ?.let { load -> subscribedId?.let { id -> { target -> load(id, target) } } },
                    onListPreviews = onSessionListPreviews?.let { action -> { subscribedId?.let(action) } },
                    onOpenPreview = onSessionOpenPreview?.let { action -> { entryId, width, height ->
                        subscribedId?.let { action(it, entryId, width, height) }
                    } },
                    onPreviewAction = onSessionPreviewAction?.let { action -> { next ->
                        subscribedId?.let { action(it, next) }
                    } },
                    onPreviewInput = onSessionPreviewInput?.let { action -> { input ->
                        subscribedId?.let { action(it, input) }
                    } },
                    pictures = imageState.takeIf { it.owner == subscribedId } ?: PictureDraftState(),
                    onPickPictures = onSessionImages?.let { {
                        if (pickerTicket == null) pictureDraft.ticket()?.takeIf { it.owner == subscribedId }?.let { ticket ->
                            pickerTicket = ticket
                            try { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
                            catch (_: android.content.ActivityNotFoundException) {
                                pickerTicket = null
                                Toast.makeText(context, "此设备无法打开系统图片选择器。", Toast.LENGTH_SHORT).show()
                            }
                        }
                    } },
                    onRemovePicture = pictureDraft::remove,
                    onSendPictures = onSessionImages?.let { submit -> { text ->
                        val prepared = pictureDraft.state.value
                        subscribedId?.takeIf { it == prepared.owner && !prepared.loading && prepared.pictures.isNotEmpty() }?.let { id ->
                            onDraftPin(sessionSendKey(id))
                            pictureDraft.sent(text, live.session?.textAttempt?.id ?: 0L)
                            submit(id, text, prepared.pictures.map { it.image })
                        }
                    } })
            }
        }
        if (showConfig && route == CodeKilnRoute.NewTask) NewTaskConfigSheet(
            live.projects, live.providers, config, state.online && !live.readOnly && !creating,
            onChange = { config = it }, onDismiss = { showConfig = false })
        if (confirmNew) AlertDialog(onDismissRequest = { confirmNew = false },
            title = { Text("允许再次新建？") },
            text = { Text("请先确认桌面没有重复任务。此操作只解除限制，不会自动创建或重发描述。") },
            confirmButton = { TextButton(onClick = { onDismissCreation(creation?.sessionId); confirmNew = false }) {
                Text("已检查，解除限制") } },
            dismissButton = { TextButton(onClick = { confirmNew = false }) { Text("取消") } })
    } }
}
