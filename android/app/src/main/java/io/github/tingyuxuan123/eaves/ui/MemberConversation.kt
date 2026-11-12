package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.*
import java.util.UUID

@Composable
internal fun MemberConversation(
    chat: DesktopBotChat, root: DesktopBotChat, bots: DesktopBotsState, session: DesktopSessionState?,
    conversationId: String?, process: Boolean, writable: Boolean, draft: BotMessageDraft, onDraft: (BotMessageDraft) -> Unit,
    onBack: () -> Unit, onSend: ((String, String, String) -> Unit)?, onStop: ((String) -> Unit)?, onStopSession: () -> Unit,
    onOlder: (Long) -> Unit, onHistory: () -> Unit, onSessionRetry: () -> Unit,
    onApproval: (String, String) -> Unit, onAsk: (String, String) -> Unit, onThreads: (() -> Unit)?,
    onNewSession: ((String) -> Unit)?, onConfirmNewSession: ((String) -> Unit)?, onRetryEntry: ((String, String) -> Unit)?,
    onArtifacts: ((DesktopBotArtifactTarget) -> Unit)?,
    onArtifactImage: ((DesktopBotArtifactTarget, String?, String?) -> Unit)?,
    onListBotFiles: ((DesktopBotArtifactTarget) -> Unit)?, onReadBotFile: ((DesktopBotArtifactTarget, String, Long) -> Unit)?,
) {
    val c = Enso.colors
    val group = chat.kind == "group" && !process
    val byId = remember(bots.members) { bots.members.associateBy { it.id } }
    val processBot = if (process) bots.inbox.firstOrNull { it.conversationId == conversationId }?.botId
        ?: chat.sessions.entries.firstOrNull { it.value == conversationId }?.key else null
    val member = byId[if (process) processBot else chat.members.firstOrNull()]
    val entries = bots.timeline.takeIf { bots.timelineChatId == chat.id }.orEmpty()
    val turns = remember(session?.timeline?.messages) { sessionTurns(session?.timeline?.messages.orEmpty()) }
    val approval = session?.timeline?.approvals?.firstOrNull { !it.reviewing } ?: session?.timeline?.approvals?.firstOrNull()
    val ask = session?.timeline?.asks?.firstOrNull()
    val pending = session?.pendingResponses.orEmpty()
    val groupState = bots.chatStates[chat.id]
    val running = if (group) groupState?.current != null || groupState == null && chat.status == "running" else session?.running == true
    val busy = bots.writeBusy
    val canEdit = writable && !process && onSend != null
    val canSend = canEdit && !busy && botMessageText(draft.text) != null
    val canStop = writable && !process && !busy && if (group) onStop != null else session?.loading == false && !session.error
    val reset = bots.newSession?.takeIf { it.chatId == chat.id }
    var menu by remember(chat.id) { mutableStateOf(false) }
    var artifactTarget by remember(chat.id) { mutableStateOf<DesktopBotArtifactTarget?>(null) }
    var artifactSelection by remember(chat.id) { mutableStateOf<String?>(null) }
    val latestReply = turns.lastOrNull()?.takeIf { !it.user && !running && session?.loading == false && !session.error }
    val latestTarget = if (!group && !process && conversationId != null && latestReply != null)
        DesktopBotArtifactTarget(chat.id, conversationId = conversationId, messageIndex = latestReply.index) else null
    LaunchedEffect(latestTarget) {
        if (latestTarget != null && artifactTarget == null && bots.artifacts?.target != latestTarget &&
            bots.artifacts?.phase != SessionCommandPhase.Waiting) onArtifacts?.invoke(latestTarget)
    }
    var confirmationDismissed by remember(reset?.requestId) { mutableStateOf(false) }
    BoxWithConstraints(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(24.dp).imePadding()) {
        val requestLimit = maxHeight * .55f
        Column(Modifier.fillMaxSize()) {
            val title = when {
                group -> root.title.ifBlank { "群聊" }
                process -> "${member?.name ?: "成员"} · 处理请求"
                else -> member?.name ?: chat.title.ifBlank { "单聊" }
            }
            val detail = when {
                group -> listOfNotNull("线程：${chat.threadTitle ?: "主话题"}", byId[chat.bossBotId]?.let { "${it.name}主持" }).joinToString(" · ")
                process -> root.title
                else -> member?.title
            }
            TopBar(title, EnsoIcon.Back, "返回成员列表", onBack, detail,
                showMenu = onThreads != null, onDetailClick = onThreads, detailActionLabel = "话题", trailing = {
                    if (group) GroupAvatars(chat.members.mapNotNull(byId::get))
                    if (!process && bots.newSessionEnabled && onNewSession != null) Box {
                        GlyphButton(EnsoIcon.More, "成员会话菜单", 40.dp, 20.dp, tint = c.ink2) { menu = true }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = c.card) {
                            DropdownMenuItem(text = { Label("新对话", 15, 20) }, enabled = writable && !busy && (group || !running),
                                onClick = { menu = false; onNewSession(chat.id) })
                        }
                    }
                })
            LazyColumn(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp), reverseLayout = true,
                verticalArrangement = Arrangement.Top, contentPadding = PaddingValues(top = 8.dp)) {
                if (group) {
                    val progress = entries.filter { it.kind == "progress" }.groupBy { it.delegationId }
                    val delegationIds = entries.filter { it.kind == "delegation" }.map { it.delegationId }.toSet()
                    val rendered = entries.filter { it.kind != "progress" || it.delegationId !in delegationIds }
                    items(rendered.asReversed(), key = { it.seq }) { entry ->
                        GroupMessage(entry, byId, progress[entry.delegationId]?.lastOrNull(),
                            retry = onRetryEntry?.takeIf { writable && !busy && entry.failure != null && entries.none { it.retryOf == entry.id } }
                                ?.let { retry -> { retry(chat.id, entry.id) } },
                            onArtifacts = onArtifacts?.takeIf { entry.kind == "bot" }?.let { { artifactTarget = DesktopBotArtifactTarget(chat.id, entryId = entry.id) } })
                    }
                    if (bots.timelineChatId == chat.id && bots.timelineHasOlder && entries.isNotEmpty()) item("older") {
                        MemberHistory(bots.timelineLoading) { onOlder(entries.first().seq) }
                    }
                    if (entries.isEmpty()) item("group-status") {
                        MembersHint(bots.timelineError?.takeIf { bots.timelineChatId == chat.id } ?: when {
                            bots.timelineChatId != chat.id || bots.timelineLoading -> "正在加载会话…"
                            else -> "还没有消息"
                        }, Modifier.padding(vertical = 12.dp))
                    } else item("group-date") { ConversationDate(entries.first().at) }
                } else {
                    items(turns.asReversed(), key = { it.index }) { turn ->
                        if (turn.user) MemberBubble { turn.blocks.forEach { MemberBlock(it, c.pillInk) } }
                        else Column(Modifier.fillMaxWidth().padding(bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                MemberAvatar(member, 22.dp)
                                Label(member?.name ?: "成员", 15, 20, weight = FontWeight.SemiBold)
                                turn.timestamp?.let { Label(memberClock(it), 12, 16, color = c.dim) }
                            }
                            val working = running && turn.index == turns.lastOrNull()?.index
                            sessionWorklogBlocks(turn.blocks, working).forEach { MemberBlock(it) }
                            if (!process && conversationId != null && !working && onArtifacts != null) {
                                val target = DesktopBotArtifactTarget(chat.id, conversationId = conversationId, messageIndex = turn.index)
                                val artifacts = bots.artifacts?.takeIf { it.target == target && it.phase == SessionCommandPhase.Observed }
                                if (artifacts == null) ArtifactEntry { artifactTarget = target }
                                else if (artifacts.artifacts.isNotEmpty() || artifacts.media.isNotEmpty()) {
                                    artifacts.artifacts.forEach { file -> ArtifactEntry(file.name, fileSizeLabel(file.size)) {
                                        artifactSelection = "file-${file.rel}"
                                        artifactTarget = target
                                    } }
                                    artifacts.media.forEachIndexed { index, media ->
                                        ArtifactEntry(media.name ?: "图片 ${index + 1}") {
                                            artifactSelection = "media-${media.mediaId ?: index}"
                                            artifactTarget = target
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (session != null && session.hasMoreHistory && session.timeline.baseIndex > 0) item("older") {
                        MemberHistory(session.loadingHistory, onHistory)
                    }
                    if (turns.isEmpty()) item("direct-status") {
                        MembersHint(when {
                            conversationId == null -> "还没有消息"
                            session?.error == true -> "暂时无法同步会话"
                            session?.loading != false -> "正在同步会话…"
                            else -> "还没有消息"
                        }, Modifier.padding(vertical = 12.dp))
                    }
                }
            }
            if (session?.error == true) TextButton(onClick = onSessionRetry) { Label("重新同步", 13, 18) }
            if (session?.responseFailed == true) MembersHint("未收到桌面确认，请检查当前请求后再试。")
            session?.timeline?.error?.let { MembersHint(it) }
            if (group && (running || !groupState?.queue.isNullOrEmpty())) Row(
                Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Label(if (running) "正在处理" else "排队中", 12, 16, Modifier.weight(1f), color = c.blue)
                if (!groupState?.queue.isNullOrEmpty()) Label("队列 ${groupState.queue.size}", 12, 16, color = c.dim)
                // A draft can still be sent while a group is running; stop stays separately reachable.
                if (running && canSend) TextButton(enabled = canStop, onClick = { onStop?.invoke(chat.id) }) { Label("停止", 12, 16, color = c.red) }
            }
            val status = botConversationNotice(chat.id, bots)
            status?.let { MembersHint(it) }
            if (!writable && !process) MembersHint("只读连接：可以查看，不能发送或停止。")
            val requestsWritable = writable && session?.loading == false && !session.error
            when {
                approval != null && (!approval.reviewing || ask == null) -> ApprovalPanel(approval, requestsWritable,
                    approval.requestId in pending, Modifier.heightIn(max = requestLimit), null, onApproval)
                ask != null -> AskPanel(ask, requestsWritable, ask.requestId in pending, Modifier.heightIn(max = requestLimit), null, onAsk)
                !process -> {
                    val send = {
                        val id = UUID.randomUUID().toString()
                        onDraft(draft.submitted(id))
                        onSend?.invoke(chat.id, draft.text, id)
                        Unit
                    }
                    val stop = { if (group) onStop?.invoke(chat.id) else onStopSession(); Unit }
                    val stopInComposer = running && !canSend
                    Box(Modifier.padding(bottom = 2.dp)) {
                        Composer(draft.text, { if (it.length <= SESSION_TEXT_LIMIT) onDraft(draft.copy(text = it)) },
                            onAction = when { canSend -> send; stopInComposer && canStop -> stop; else -> null },
                            placeholder = if (group) "@ 成员，或直接说" else "回复${member?.name ?: chat.title}",
                            inputLabel = if (group) "群聊消息" else "单聊消息", inputEnabled = canEdit,
                            running = stopInComposer, dimAction = !writable || busy,
                            actionLabel = if (stopInComposer) "停止" else "发送到成员")
                    }
                }
                else -> MembersHint("仅处理当前成员会话中的审批或提问。")
            }
        }
    }
    artifactTarget?.let { target -> MemberArtifactSheet(target, bots, onDismiss = { artifactTarget = null; artifactSelection = null },
        onList = onArtifacts, onImage = onArtifactImage, onListFiles = onListBotFiles, onReadFile = onReadBotFile,
        initialSelection = artifactSelection) }
    if (reset?.phase == BotNewSessionPhase.NeedsConfirmation && !confirmationDismissed && writable && onConfirmNewSession != null) {
        AlertDialog(onDismissRequest = { confirmationDismissed = true }, title = { Text("开始新对话？") },
            text = { Text("当前工作将停止，接下来的消息会使用新上下文。已有记录会保留。") },
            confirmButton = { TextButton(onClick = { confirmationDismissed = true; onConfirmNewSession(chat.id) }) { Text("开始新对话") } },
            dismissButton = { TextButton(onClick = { confirmationDismissed = true }) { Text("取消") } })
    }
}

@Composable
private fun MemberHistory(loading: Boolean, onClick: () -> Unit) = Box(Modifier.fillMaxWidth().heightIn(min = 44.dp)
    .clickable(enabled = !loading, role = Role.Button, onClick = onClick), contentAlignment = Alignment.Center) {
    Label(if (loading) "正在加载历史…" else "加载更早的消息", 13, 18, color = Enso.colors.dim)
}

@Composable
private fun ConversationDate(at: Long) = Box(Modifier.fillMaxWidth().padding(bottom = 16.dp), contentAlignment = Alignment.Center) {
    Label(memberDate(at), 11, 14, color = Enso.colors.faint)
}

@Composable
private fun GroupMessage(entry: DesktopGroupEntry, byId: Map<String, DesktopBotMember>, progress: DesktopGroupEntry?, retry: (() -> Unit)?,
    onArtifacts: (() -> Unit)?) {
    val c = Enso.colors
    when (entry.kind) {
        "human" -> MemberBubble { Label(entry.text, 16, 22, color = c.pillInk) }
        "bot" -> Row(Modifier.fillMaxWidth().padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val member = byId[entry.botId]
            MemberAvatar(member, 30.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(member?.name ?: "成员", 14, 20, weight = FontWeight.SemiBold)
                    Label(memberClock(entry.at), 12, 16, color = c.dim)
                    if (onArtifacts != null) Glyph(EnsoIcon.Files, Modifier.size(16.dp)
                        .clickable(role = Role.Button, onClick = onArtifacts), c.dim, "查看本轮产物")
                }
                SessionMarkdown(entry.text, compact = true)
            }
        }
        "delegation", "progress" -> {
            val phase = entry.state ?: entry.phase
            val status = when (phase) {
                "queued" -> "排队中"
                "running", "started" -> "进行中"
                "blocked" -> "卡住了"
                "completed", "delivered" -> "已交付"
                "failed" -> "失败"
                "canceled" -> "已取消"
                else -> "协作"
            }
            val tone = when (phase) { "running", "started" -> c.blue; "blocked" -> c.yellow; "failed" -> c.red; else -> c.dim }
            val to = byId[entry.to ?: entry.botId]
            Column(Modifier.fillMaxWidth().padding(start = 40.dp, bottom = 10.dp).background(c.card, RoundedCornerShape(18.dp))
                .padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (entry.kind == "delegation") {
                        Label(byId[entry.from]?.name ?: "成员", 12, 16, color = c.dim, maxLines = 1)
                        Label("→", 12, 16, color = c.dim)
                    }
                    MemberAvatar(to, 16.dp)
                    Label(to?.name ?: "成员", 12, 16, Modifier.weight(1f), color = c.ink2, weight = FontWeight.Medium, maxLines = 1)
                    Label(status, 11, 14, Modifier.background(tone.copy(alpha = .12f), CircleShape)
                        .padding(horizontal = 8.dp, vertical = 2.dp), color = if (phase == "blocked" && !c.dark) c.ink2 else tone)
                }
                if (entry.text.isNotBlank()) Label(entry.text, 15, 20, weight = FontWeight.Medium)
                progress?.text?.takeIf { it.isNotBlank() && it != entry.text }?.let { Label(it, 13, 18, color = c.ink2) }
            }
        }
        else -> Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Label(entry.text, 13, 18, color = if (entry.failure != null) c.red else c.dim)
            retry?.let { TextButton(onClick = it) { Label("重试", 13, 18) } }
        }
    }
}

@Composable
private fun ArtifactEntry(title: String = "查看本轮产物", detail: String? = null, onClick: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().padding(top = 6.dp).background(c.card, RoundedCornerShape(16.dp))
        .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Glyph(EnsoIcon.Files, Modifier.size(20.dp), c.ink2)
        Label(title, 15, 20, Modifier.weight(1f), weight = FontWeight.Medium, maxLines = 1)
        detail?.let { Label(it, 12, 16, color = c.dim) }
        Glyph(EnsoIcon.Right, Modifier.size(16.dp), c.faint)
    }
}

@Composable
private fun MemberBlock(block: SessionBlock, bubbleInk: androidx.compose.ui.graphics.Color? = null) {
    when (block) {
        is SessionBlock.Prose -> if (bubbleInk != null) Label(block.text, 16, 22, color = bubbleInk) else SessionMarkdown(block.text, compact = true)
        is SessionBlock.Worklog -> Box(Modifier.fillMaxWidth().background(Enso.colors.card2.copy(alpha = .6f), RoundedCornerShape(14.dp))
            .padding(horizontal = 12.dp, vertical = 4.dp)) { SessionWorklogRow(block, null) { SessionMarkdown(it, compact = true) } }
        is SessionBlock.Notice -> TimelineDisclosure(block.kind.title, block.detail, EnsoIcon.Terminal)
        is SessionBlock.Todos -> SessionTodoCard(block.items)
        is SessionBlock.Compaction -> TimelineDisclosure("上下文已压缩", block.summary, EnsoIcon.Compress)
        is SessionBlock.Images -> TimelineImageStrip(block.images)
        SessionBlock.ImagePlaceholder -> Label("图片附件", 13, 18, color = bubbleInk ?: Enso.colors.dim)
        is SessionBlock.Steps -> Unit
    }
}

private fun botConversationNotice(chatId: String, bots: DesktopBotsState): String? {
    fun notice(phase: SessionCommandPhase?, action: String) = when (phase) {
        SessionCommandPhase.Waiting -> "正在${action}…"
        SessionCommandPhase.Unconfirmed -> "${action}未确认，请先检查桌面。"
        SessionCommandPhase.Rejected -> "桌面拒绝了${action}操作。"
        else -> null
    }
    return notice(bots.send?.takeIf { it.chatId == chatId }?.phase, "发送")
        ?: notice(bots.stop?.takeIf { it.chatId == chatId }?.phase, "停止")
        ?: notice(bots.retry?.takeIf { it.chatId == chatId }?.phase, "重试")
        ?: when (bots.newSession?.takeIf { it.chatId == chatId }?.phase) {
            BotNewSessionPhase.Waiting -> "正在等待电脑开始新对话…"
            BotNewSessionPhase.Unconfirmed -> "新对话未确认，请先检查桌面。"
            BotNewSessionPhase.Rejected -> "电脑未能开始新对话。"
            else -> null
        }
}
