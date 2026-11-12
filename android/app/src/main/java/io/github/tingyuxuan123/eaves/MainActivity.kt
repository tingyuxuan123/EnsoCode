package io.github.tingyuxuan123.eaves

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
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.HomeScreen
import io.github.tingyuxuan123.eaves.ui.NewTaskScreen
import io.github.tingyuxuan123.eaves.ui.NewTaskUiState
import io.github.tingyuxuan123.eaves.ui.PairScreen
import io.github.tingyuxuan123.eaves.ui.PairSpecimen
import io.github.tingyuxuan123.eaves.ui.PairUiState
import io.github.tingyuxuan123.eaves.ui.PairingScanner
import io.github.tingyuxuan123.eaves.ui.SessionHeader
import io.github.tingyuxuan123.eaves.ui.BoardScreen
import io.github.tingyuxuan123.eaves.ui.MembersScreen
import io.github.tingyuxuan123.eaves.ui.SessionScreen
import io.github.tingyuxuan123.eaves.ui.SessionSpecimen
import io.github.tingyuxuan123.eaves.mirror.DesktopLinkState
import io.github.tingyuxuan123.eaves.mirror.BotThreadCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopBotArtifactTarget
import io.github.tingyuxuan123.eaves.mirror.DesktopGoal
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.eaves.mirror.RewindBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionTaskKind
import io.github.tingyuxuan123.eaves.mirror.TaskStopBaseline
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.CreationPhase
import io.github.tingyuxuan123.eaves.mirror.QueueCommand
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.SessionImage
import io.github.tingyuxuan123.eaves.mirror.SESSION_IMAGE_LIMIT
import io.github.tingyuxuan123.eaves.mirror.TaskLaunch
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel
import io.github.tingyuxuan123.eaves.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.ui.TaskConfiguration
import io.github.tingyuxuan123.eaves.ui.NewTaskConfigSheet
import io.github.tingyuxuan123.eaves.ui.CreationNotice
import io.github.tingyuxuan123.eaves.ui.title
import io.github.tingyuxuan123.eaves.ui.PictureDraftState
import io.github.tingyuxuan123.eaves.ui.PictureTicket
import io.github.tingyuxuan123.eaves.ui.SessionPictureDraft
import io.github.tingyuxuan123.eaves.ui.importSessionPictures

class MainActivity : ComponentActivity() {
    private class Invite(val link: String)
    private val invite = mutableStateOf<Invite?>(null)
    private val notice = mutableStateOf<TaskNoticeOpen?>(null)
    private val companion get() = (application as EavesApplication).companion

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) { consumeInvite(intent); consumeNotice(intent) }
        setContent {
            val state by companion.state.collectAsStateWithLifecycle()
            var link by remember { mutableStateOf("") }
            val incoming = invite.value
            val pendingNotice = notice.value
            val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                if (granted) startWatch() else Toast.makeText(this, "未授予通知权限，后台提醒未开启。", Toast.LENGTH_SHORT).show()
            }
            LaunchedEffect(incoming) { if (incoming != null) link = incoming.link }
            EavesApp(state = state.taskUi(System.currentTimeMillis()), pairState = state.pairUi(),
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

    override fun onStart() { super.onStart(); companion.setVisible(true) }
    override fun onStop() { companion.setVisible(false); super.onStop() }
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
        catch (_: android.content.ActivityNotFoundException) { Toast.makeText(this, "请在系统设置中管理 Collabra 通知。", Toast.LENGTH_SHORT).show() }
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
        if (value.action == Intent.ACTION_VIEW && value.data?.scheme == "enso" && value.data?.host == "pair") {
            value.dataString?.takeIf { it.length <= 8192 }?.let { invite.value = Invite(it) }
            value.data = null
        }
    }
}

internal enum class EavesRoute { NewTask, Home, Pair, Session, Board, Members }
internal class TaskNoticeOpen(val sessionId: String?)

@Composable
internal fun EavesApp(
    initialRoute: EavesRoute = EavesRoute.NewTask,
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
    onSessionPreviewAction: ((String, io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction) -> Unit)? = null,
    onSessionPreviewInput: ((String, io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput) -> Unit)? = null,
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
) {
    var route by rememberSaveable { mutableStateOf(initialRoute) }
    var pairReturn by rememberSaveable { mutableStateOf(EavesRoute.Home) }
    var boardReturn by rememberSaveable { mutableStateOf(EavesRoute.NewTask) }
    var membersReturn by rememberSaveable { mutableStateOf(EavesRoute.Home) }
    var draft by remember(pairState.paired) { mutableStateOf(state.draft) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var memberSessionId by remember(pairState.paired) { mutableStateOf<String?>(null) }
    // Keep one session's draft across the drawer and reconnects; never save message text to a Bundle.
    var sessionDraft by remember(pairState.paired) { mutableStateOf("") }
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
        if (route == EavesRoute.Session && ticket?.owner == selectedId && pairState.paired) {
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
            if (cleared != null && sessionDraft == cleared) sessionDraft = ""
        }
    }
    // A confirmed rewind may hand back the removed message; never overwrite text the user typed since.
    val observedRewind = live.session?.rewind
    LaunchedEffect(selectedId, observedRewind?.id, observedRewind?.phase) {
        val owner = live.session?.timeline?.sessionId ?: return@LaunchedEffect
        val text = observedRewind?.editorText ?: return@LaunchedEffect
        if (owner == selectedId && observedRewind.phase == SessionCommandPhase.Observed && sessionDraft.isBlank()) {
            sessionDraft = text
        }
    }
    val unavailable = { Toast.makeText(context, "此开发版本尚未接入这项功能。", Toast.LENGTH_SHORT).show() }
    val openPair = {
        if (!creating) {
            pairReturn = route
            route = EavesRoute.Pair
        }
    }
    val openTask: (String) -> Unit = { id ->
        val task = state.tasks.firstOrNull { it.id == id }
        if (!creating && task != null && onSelectSession != null) {
            if (selectedId != id) sessionDraft = ""
            selectedId = id
            selectedTitle = task.title
            selectedProject = task.project
            route = EavesRoute.Session
        } else if (!creating) unavailable()
    }
    val back = {
        route = when (route) {
            EavesRoute.Pair -> pairReturn
            EavesRoute.Session -> EavesRoute.Home
            EavesRoute.Board -> boardReturn
            EavesRoute.Members -> membersReturn
            else -> EavesRoute.NewTask
        }
    }
    val openBoard = {
        if (!creating) { boardReturn = route; route = EavesRoute.Board }
    }
    val openMembers = {
        if (!creating) { membersReturn = route; route = EavesRoute.Members }
    }
    val subscribedId = if (route == EavesRoute.Members) memberSessionId else selectedId.takeIf { route == EavesRoute.Session }
    val selectable = state.tasks.any { it.id == subscribedId } || (route == EavesRoute.Members && memberSessionId != null)
    LaunchedEffect(subscribedId, pairState.paired, selectable) {
        if (subscribedId == null || !pairState.paired) onSelectSession?.invoke(null)
        else if (selectable) onSelectSession?.invoke(subscribedId)
    }
    LaunchedEffect(openPairInvite) { if (openPairInvite != null && route != EavesRoute.Pair) openPair() }
    LaunchedEffect(openTaskNotice) {
        if (openTaskNotice != null) {
            route = EavesRoute.Home
            if (openTaskNotice.sessionId == null) onNoticeConsumed()
        }
    }
    LaunchedEffect(openTaskNotice, route, live.phase, live.catalogReady, state.tasks, pairState.paired) {
        val id = openTaskNotice?.sessionId ?: return@LaunchedEffect
        if (route != EavesRoute.Home) return@LaunchedEffect
        if (!pairState.paired || live.phase in setOf(LinkPhase.Revoked, LinkPhase.Failed, LinkPhase.Replaced)) onNoticeConsumed()
        else if (live.phase == LinkPhase.Online && live.catalogReady) {
            if (state.tasks.any { it.id == id }) openTask(id)
            else Toast.makeText(context, "该任务已不在当前电脑的列表中。", Toast.LENGTH_SHORT).show()
            onNoticeConsumed()
        }
    }
    LaunchedEffect(creation?.sessionId, creation?.phase) {
        if (creation?.phase == CreationPhase.Created && creation.sessionId != null) {
            selectedId = creation.sessionId
            selectedTitle = null
            selectedProject = config.project(live.projects)?.name
            sessionDraft = launching?.text?.takeUnless {
                live.session?.textAttempt?.let { attempt -> attempt.phase == SessionCommandPhase.Observed && attempt.text == it } == true
            }.orEmpty()
            if (draft == launching?.text) draft = ""
            launching = null
            route = EavesRoute.Session
            showConfig = false
        }
    }
    BackHandler(enabled = creating || route != EavesRoute.NewTask) { if (!creating) back() }
    EnsoTheme {
        when (route) {
            EavesRoute.NewTask -> NewTaskScreen(
                state.copy(draft = draft, project = config.project(live.projects)?.name ?: state.project,
                    model = config.model(live.providers)?.label?.let { model -> config.thinkingLevel?.let { "$model · ${it.title()}" } ?: model } ?: state.model,
                    composerEnabled = !creating), onHome = { if (!creating) route = EavesRoute.Home }, onPair = openPair,
                onConfig = { if (!creating) { if (state.online) { keyboard?.hide(); showConfig = true } else openPair() } },
                onBoard = openBoard, onTask = openTask, onDraft = { draft = it },
                onSend = config.launch(live.projects, live.providers, draft)?.takeIf {
                    state.online && state.composerAvailable && !creating &&
                        (creation == null || creation.phase == CreationPhase.Created) && onCreateTask != null
                }?.let { request -> { keyboard?.hide(); launching = request; onCreateTask?.invoke(request) } },
                footer = {
                    CreationNotice(creation, draft.length > SESSION_TEXT_LIMIT,
                        onReview = { route = EavesRoute.Home }, onUnlock = { confirmNew = true })
                },
            )
            EavesRoute.Home -> HomeScreen(
                state, onNew = { route = EavesRoute.NewTask }, onPair = openPair, onTask = openTask,
                onBoard = openBoard, onMembers = openMembers, onSettings = unavailable, onUnavailable = unavailable,
            )
            EavesRoute.Members -> {
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
                    onListBotFiles = onBotListFiles, onReadBotFile = onBotReadFile, onOpenDirect = onBotOpenDirect)
            }
            EavesRoute.Board -> BoardScreen(
                live.catalog.filterNot { it.archived }, System.currentTimeMillis(), onBack = back, onTask = openTask,
            )
            EavesRoute.Pair -> PairScreen(onClose = back, specimen = pairSpecimen, state = pairState,
                link = pairLink, onLink = onPairLink, onPair = onPair, onReconnect = onReconnect,
                onUnpair = onUnpair, scanner = scanner, onWatch = onWatch, onNotificationSettings = onNotificationSettings)
            EavesRoute.Session -> {
                val task = live.catalog.firstOrNull { it.id == selectedId && !it.archived }
                val canConfigure = task != null && task.parentId == null && live.catalogReady
                val currentConfigSession = { subscribedId?.takeIf { route == EavesRoute.Session && selectedId == it } }
                val header = sessionSpecimen?.header ?: SessionHeader(
                    task?.title ?: selectedTitle ?: "会话", task?.projectName?.takeIf { it.isNotBlank() } ?: selectedProject,
                )
                SessionScreen(header, sessionSpecimen?.state ?: live.session?.takeIf { it.timeline.sessionId == selectedId },
                    if (sessionSpecimen != null) LinkPhase.Online else live.phase, live.readOnly,
                    onDrawer = { route = EavesRoute.Home }, onRetry = onSessionRetry, onHistory = onHistory,
                    onApproval = { requestId, decision -> subscribedId?.let { onApproval(it, requestId, decision) } },
                    onAsk = { requestId, answer -> subscribedId?.let { onAsk(it, requestId, answer) } }, specimen = sessionSpecimen,
                    draft = sessionDraft, onDraft = { sessionDraft = it },
                    onText = { text, steer -> subscribedId?.let { onSessionText(it, text, steer) } },
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
                        subscribedId?.let { queue(it, command, messageId, text) }
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
                            pictureDraft.sent(text, live.session?.textAttempt?.id ?: 0L)
                            submit(id, text, prepared.pictures.map { it.image })
                        }
                    } })
            }
        }
        if (showConfig && route == EavesRoute.NewTask) NewTaskConfigSheet(
            live.projects, live.providers, config, state.online && !live.readOnly && !creating,
            onChange = { config = it }, onDismiss = { showConfig = false })
        if (confirmNew) AlertDialog(onDismissRequest = { confirmNew = false },
            title = { Text("允许再次新建？") },
            text = { Text("请先确认桌面没有重复任务。此操作只解除限制，不会自动创建或重发描述。") },
            confirmButton = { TextButton(onClick = { onDismissCreation(creation?.sessionId); confirmNew = false }) {
                Text("已检查，解除限制") } },
            dismissButton = { TextButton(onClick = { confirmNew = false }) { Text("取消") } })
    }
}
