package io.github.tingyuxuan123.eaves.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.*

/** One directory, one full-screen conversation. All rows come from the authenticated desktop. */
@Composable
internal fun MembersScreen(
    bots: DesktopBotsState?, onBack: () -> Unit, onOpenChat: (String) -> Unit, onLoadOlder: (String, Long) -> Unit,
    writable: Boolean = false, onSend: ((String, String, String) -> Unit)? = null, onStop: ((String) -> Unit)? = null,
    onCloseChat: (String) -> Unit = {}, onThreadChange: ((String, BotThreadCommand, String?, String) -> Unit)? = null,
    session: DesktopSessionState? = null, onSelectSession: (String?) -> Unit = {},
    onHistory: () -> Unit = {}, onSessionRetry: () -> Unit = {},
    onApproval: (String, String) -> Unit = { _, _ -> }, onAsk: (String, String) -> Unit = { _, _ -> },
    onStopSession: () -> Unit = {}, onNewSession: ((String) -> Unit)? = null,
    onConfirmNewSession: ((String) -> Unit)? = null, onRetryEntry: ((String, String) -> Unit)? = null,
    onDismissInbox: ((String) -> Unit)? = null, onCreateGroup: ((String, List<String>, String) -> Unit)? = null,
    onArtifacts: ((DesktopBotArtifactTarget) -> Unit)? = null,
    onArtifactImage: ((DesktopBotArtifactTarget, String?, String?) -> Unit)? = null,
    onListBotFiles: ((DesktopBotArtifactTarget) -> Unit)? = null,
    onReadBotFile: ((DesktopBotArtifactTarget, String, Long) -> Unit)? = null,
    onOpenDirect: ((String) -> Unit)? = null,
    initialChatId: String? = null,
) {
    var openRootId by remember { mutableStateOf(initialChatId) }
    var displayedId by remember { mutableStateOf(initialChatId) }
    var processId by remember { mutableStateOf<String?>(null) }
    var showThreads by remember { mutableStateOf(false) }
    var showCreate by remember { mutableStateOf(false) }
    var priorCreateId by remember { mutableStateOf<String?>(null) }
    var openingDirect by remember { mutableStateOf<Pair<String, String?>?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var drafts by remember { mutableStateOf(emptyMap<String, BotMessageDraft>()) }
    val closeChat by rememberUpdatedState(onCloseChat)
    val openChat by rememberUpdatedState(onOpenChat)
    val selectSession by rememberUpdatedState(onSelectSession)
    val receipt = bots?.send
    LaunchedEffect(receipt) {
        if (receipt != null) drafts[receipt.chatId]?.let { draft ->
            val next = draft.observe(receipt.chatId, receipt)
            if (next != draft) drafts = drafts + (receipt.chatId to next)
        }
    }
    val root = bots?.chats?.firstOrNull { it.id == openRootId && !it.archived }
    val active = root?.let { bots.activeBotThread(it.id) }
    val action = bots?.threadAction?.takeIf { it.rootId == root?.id }
    val threadWaiting = action?.phase == SessionCommandPhase.Waiting
    LaunchedEffect(active?.id, action?.requestId, action?.phase) {
        if (active != null && !threadWaiting && active.id != displayedId && processId == null) displayedId = active.id
        if (action?.phase == SessionCommandPhase.Observed && active?.id == action.resultId) showThreads = false
    }
    val chat = if (root == null) null else (bots.chats + bots.threads).firstOrNull { it.id == displayedId && !it.archived }
    val enabledChat = chat?.takeIf { bots?.enabled == true }
    val directId = enabledChat?.takeIf { it.kind == "direct" }?.let { it.sessions[it.members.firstOrNull()] }
    val conversationId = enabledChat?.let { processId ?: directId }
    DisposableEffect(enabledChat?.id, conversationId) {
        if (enabledChat?.kind == "group" && conversationId == null) openChat(enabledChat.id)
        if (conversationId != null) selectSession(conversationId)
        onDispose {
            if (enabledChat?.kind == "group" && conversationId == null) closeChat(enabledChat.id)
            if (conversationId != null) selectSession(null)
        }
    }
    val close = { openRootId = null; displayedId = null; processId = null; showThreads = false }
    val chatBack = { if (processId != null) { processId = null; displayedId = active?.id ?: displayedId } else close() }
    BackHandler(enabled = enabledChat != null && !showThreads, onBack = chatBack)
    val open: (DesktopBotChat, String?) -> Unit = { target, requestSession ->
        openingDirect = null
        processId = requestSession
        openRootId = target.parentId ?: target.id
        displayedId = if (requestSession == null) bots?.activeBotThread(target.id)?.id ?: target.id else target.id
    }
    val created = bots?.groupCreate
    LaunchedEffect(created?.requestId, created?.phase, bots?.chats, showCreate) {
        if (showCreate && created?.phase == SessionCommandPhase.Observed && created.requestId != priorCreateId) {
            bots.chats.firstOrNull { it.id == created.chatId }?.let { showCreate = false; open(it, null) }
        }
    }
    val direct = bots?.directOpen
    LaunchedEffect(direct, bots?.chats, openingDirect) {
        val requested = openingDirect ?: return@LaunchedEffect
        if (direct?.botId != requested.first || direct.requestId == requested.second) return@LaunchedEffect
        when (direct.phase) {
            SessionCommandPhase.Observed -> bots.chats.firstOrNull { it.id == direct.chatId && it.kind == "direct" &&
                !it.archived && it.members.firstOrNull() == direct.botId }?.let { open(it, null) }
            SessionCommandPhase.Rejected -> {
                openingDirect = null
                notice = if (direct.error == "chat-archived") "这段单聊已归档，请先在电脑端恢复。" else "电脑未能打开单聊。"
            }
            SessionCommandPhase.Unconfirmed -> { openingDirect = null; notice = "打开单聊未确认，请先检查电脑。" }
            else -> Unit
        }
    }
    if (enabledChat != null && root != null) {
        val threadAvailable = root.kind == "group" && bots.threadsEnabled && active != null && processId == null
        MemberConversation(enabledChat, root, bots, session?.takeIf { it.timeline.sessionId == conversationId },
            conversationId = conversationId, process = processId != null, writable = writable && !threadWaiting,
            draft = drafts[enabledChat.id] ?: BotMessageDraft(), onDraft = { drafts = drafts + (enabledChat.id to it) },
            onBack = chatBack, onSend = onSend, onStop = onStop, onStopSession = onStopSession,
            onOlder = { onLoadOlder(enabledChat.id, it) }, onHistory = onHistory, onSessionRetry = onSessionRetry,
            onApproval = onApproval, onAsk = onAsk, onThreads = if (threadAvailable) ({ showThreads = true }) else null,
            onNewSession = onNewSession, onConfirmNewSession = onConfirmNewSession, onRetryEntry = onRetryEntry,
            onArtifacts = onArtifacts, onArtifactImage = onArtifactImage, onListBotFiles = onListBotFiles, onReadBotFile = onReadBotFile)
        if (showThreads && threadAvailable) BotThreadPicker(root, bots.threads.filter { it.parentId == root.id },
            requireNotNull(active), action, writable && onThreadChange != null && (!bots.writeBusy || threadWaiting),
            onDismiss = { showThreads = false }, onChoose = { command, id -> onThreadChange?.invoke(root.id, command, id, active.id) })
    } else {
        MembersDirectory(bots, onBack, onOpen = open, onNotice = { notice = it }, onOpenMember = { member ->
            when {
                !writable -> notice = "当前连接不可写，不能首次打开单聊。"
                bots?.directOpenEnabled != true || onOpenDirect == null -> notice = "请先在电脑端打开与${member.name}的单聊。"
                !bots.writeBusy -> { openingDirect = member.id to direct?.requestId; onOpenDirect(member.id) }
            }
        },
            onNewGroup = {
                when {
                    !writable -> notice = "当前连接不可写，请先连接电脑。"
                    bots?.groupCreateEnabled != true || onCreateGroup == null -> notice = "请升级电脑端以支持手机新建群聊。"
                    else -> { priorCreateId = created?.requestId; showCreate = true }
                }
            }, onDismissInbox = onDismissInbox.takeIf { writable })
    }
    if (showCreate && bots?.enabled == true) NewBotGroupSheet(bots, writable && onCreateGroup != null,
        onDismiss = { showCreate = false }, onCreate = { title, members, boss -> onCreateGroup?.invoke(title, members, boss) })
    notice?.let { text -> AlertDialog(onDismissRequest = { notice = null }, title = { Text("成员") }, text = { Text(text) },
        confirmButton = { TextButton(onClick = { notice = null }) { Text("知道了") } }) }
}

@Composable
private fun MembersDirectory(bots: DesktopBotsState?, onBack: () -> Unit, onOpen: (DesktopBotChat, String?) -> Unit,
    onOpenMember: (DesktopBotMember) -> Unit,
    onNotice: (String) -> Unit, onNewGroup: () -> Unit, onDismissInbox: ((String) -> Unit)?) {
    val c = Enso.colors
    val members = bots?.members.orEmpty().filterNot { it.archived }
    val groups = bots?.chats.orEmpty().filter { it.kind == "group" && it.parentId == null && !it.archived }
    Box(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(24.dp)) {
        Column(Modifier.fillMaxSize()) {
            TopBar("成员", EnsoIcon.Back, "返回", onBack, when (bots?.enabled) {
                false -> "桌面未开启成员模式"
                true -> "${members.size} 位成员 · ${groups.size} 个群聊"
                null -> "正在读取桌面成员…"
            })
            when (bots?.enabled) {
                null -> MembersHint(bots?.error ?: "正在读取桌面成员…")
                false -> MembersHint("桌面已关闭成员模式。开启后可在这里查看收件箱和群聊。")
                true -> LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(bottom = 100.dp)) {
                    item { MemberSection("收件箱", first = true) }
                    itemsIndexed(bots.inbox, key = { _, item -> "inbox-${item.key}" }) { index, item ->
                        if (index > 0) Hairline()
                        val member = members.firstOrNull { it.id == item.botId }
                        val target = (bots.chats + bots.threads).firstOrNull { it.id == item.chatId && !it.archived }
                        Row(Modifier.fillMaxWidth().background(c.yellow.copy(alpha = .09f)).clickable(role = Role.Button) {
                            if (target != null) {
                                val requestSession = if (item.kind in setOf("approval", "ask"))
                                    item.conversationId ?: target.sessions[item.botId] else null
                                val directSession = target.takeIf { it.kind == "direct" }?.let { it.sessions[it.members.firstOrNull()] }
                                onOpen(target, requestSession?.takeUnless { it == directSession })
                            }
                            else onNotice("此提醒没有可打开的会话，请在电脑端处理。")
                        }.padding(horizontal = 20.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            MemberAvatar(member, 36.dp)
                            Column(Modifier.weight(1f)) {
                                Label(listOfNotNull(member?.name, inboxTitle(item.kind)).joinToString(" "), 13, 18, color = c.ink2)
                                Label(item.text ?: inboxTitle(item.kind), 15, 20, weight = FontWeight.Medium, maxLines = 1)
                            }
                            if (item.dismissible && onDismissInbox != null) GlyphButton(EnsoIcon.Close, "忽略提醒", 40.dp, 16.dp,
                                tint = c.dim, onClick = if (bots.inboxDismiss?.phase != SessionCommandPhase.Waiting)
                                    ({ onDismissInbox(item.key) }) else null)
                            else Glyph(EnsoIcon.Waiting, Modifier.size(16.dp), c.yellow)
                        }
                    }
                    if (bots.inbox.isEmpty()) item { MembersHint("没有待处理的请求") }
                    item { MemberSection("群聊") }
                    items(groups, key = { "group-${it.id}" }) { group ->
                        DirectoryRow(group.title.ifBlank { "群聊" }, null, group.lastText ?: "还没有消息", group.updatedAt, onClick = { onOpen(group, null) }) {
                            GroupAvatars(group.members.mapNotNull { id -> members.firstOrNull { it.id == id } }, diagonal = true)
                        }
                    }
                    if (groups.isEmpty()) item { MembersHint("还没有群聊") }
                    item { MemberSection("单聊") }
                    items(members, key = { "member-${it.id}" }) { member ->
                        val direct = bots.chats.firstOrNull { it.kind == "direct" && !it.archived && it.members.firstOrNull() == member.id }
                        DirectoryRow(member.name, member.title,
                            direct?.lastText ?: if (direct == null) "尚未开始单聊" else "点击继续单聊",
                            direct?.updatedAt, member.status, onClick = {
                                if (direct != null) onOpen(direct, null)
                                else onOpenMember(member)
                            }) { MemberAvatar(member, 44.dp) }
                    }
                    if (members.isEmpty()) item { MembersHint("电脑端还没有成员。") }
                    bots.error?.let { item { MembersHint(it) } }
                    bots.inboxDismiss?.takeIf { it.phase == SessionCommandPhase.Unconfirmed }?.let {
                        item { MembersHint("忽略操作未确认，请先检查电脑。") }
                    }
                }
            }
        }
        if (bots?.enabled == true) Row(Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 8.dp)
            .height(56.dp).glass().clickable(role = Role.Button, onClick = onNewGroup).padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Glyph(EnsoIcon.Plus, Modifier.size(20.dp))
            Label("新群聊", 15, 20, weight = FontWeight.Medium)
        }
    }
}

@Composable
private fun DirectoryRow(title: String, detail: String?, summary: String, time: Long?, status: String? = null,
    onClick: () -> Unit, avatar: @Composable () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onClick).padding(horizontal = 20.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        avatar()
        Column(Modifier.weight(1f)) {
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val titleLimit = maxWidth * .54f
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(title, 16, 22, if (detail.isNullOrEmpty()) Modifier.weight(1f) else Modifier.widthIn(max = titleLimit),
                        weight = FontWeight.Medium, maxLines = 1)
                    if (!detail.isNullOrEmpty()) Label(detail, 13, 18, Modifier.weight(1f), color = c.dim, maxLines = 1)
                    time?.takeIf { it > 0 }?.let { Label(memberTime(it), 12, 16, color = c.dim) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (status == "running" || status == "queued") Label(if (status == "running") "运行中" else "排队中",
                    13, 18, color = if (status == "running") c.blue else c.dim)
                Label(summary, 13, 18, color = c.ink2, maxLines = 1)
            }
        }
    }
}

@Composable
private fun MemberSection(title: String, first: Boolean = false) = Label(title, 15, 20,
    Modifier.padding(start = 20.dp, end = 20.dp, top = if (first) 8.dp else 24.dp, bottom = 6.dp),
    color = Enso.colors.dim, weight = FontWeight.SemiBold)

private fun inboxTitle(kind: String) = when (kind) {
    "approval" -> "请求批准"
    "ask" -> "在问你"
    "delegation-interrupted" -> "协作被中断"
    "budget" -> "额度提醒"
    "routine-draft" -> "例程草稿待确认"
    "routine-blocked" -> "例程被阻塞"
    "silence" -> "很久没有动静"
    "task-blocked" -> "任务受阻"
    else -> "待处理"
}
