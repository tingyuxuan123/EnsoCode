package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopBotChat
import io.github.tingyuxuan123.eaves.mirror.BotThreadCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopBotsState
import io.github.tingyuxuan123.eaves.mirror.DesktopGroupEntry
import io.github.tingyuxuan123.eaves.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.botMessageText
import io.github.tingyuxuan123.eaves.mirror.activeBotThread
import java.text.DateFormat
import java.util.Date
import java.util.UUID

/**
 * Members: inbox first, then who is on the team, then the group/direct chats. Reading is passive —
 * the desktop pushes this state; outgoing drafts wait for a deliveryId-matched host receipt.
 */
@Composable
internal fun MembersScreen(
    bots: DesktopBotsState?, onBack: () -> Unit, onOpenChat: (String) -> Unit, onLoadOlder: (String, Long) -> Unit,
    writable: Boolean = false, onSend: ((String, String, String) -> Unit)? = null, onStop: ((String) -> Unit)? = null,
    onCloseChat: (String) -> Unit = {},
    onThreadChange: ((String, BotThreadCommand, String?, String) -> Unit)? = null,
) {
    val c = Enso.colors
    var openRootId by remember { mutableStateOf<String?>(null) }
    var displayedId by remember { mutableStateOf<String?>(null) }
    var showThreads by remember { mutableStateOf(false) }
    val closeChat by rememberUpdatedState(onCloseChat)
    val openChatId = displayedId
    DisposableEffect(openChatId) {
        onDispose { openChatId?.let(closeChat) }
    }
    var drafts by remember { mutableStateOf(emptyMap<String, BotMessageDraft>()) }
    val receipt = bots?.send
    LaunchedEffect(receipt) {
        if (receipt != null) drafts[receipt.chatId]?.let { draft ->
            val next = draft.observe(receipt.chatId, receipt)
            if (next != draft) drafts = drafts + (receipt.chatId to next)
        }
    }
    Column(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(24.dp)) {
        TopBar("成员", EnsoIcon.Back, "返回", onBack,
            when {
                bots == null -> "正在读取桌面成员…"
                bots.enabled == false -> "桌面未开启成员模式"
                else -> listOfNotNull(
                    bots.inbox.size.takeIf { it > 0 }?.let { "$it 条待处理" },
                    bots.members.size.takeIf { it > 0 }?.let { "${it} 位成员" },
                ).joinToString(" · ").ifBlank { "暂无待处理" }
            })
        if (bots == null || bots.enabled == null) {
            MembersHint(bots?.error ?: "正在读取桌面成员…")
            return@Column
        }
        if (bots.enabled == false) {
            MembersHint("桌面已关闭成员模式。开启后可在这里查看收件箱和群聊。")
            return@Column
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            item(key = "members-inbox-title") { MemberGroup("等你处理", bots.inbox.size) }
            items(bots.inbox.size, key = { "inbox-${bots.inbox[it].key}" }) { index ->
                val item = bots.inbox[index]
                Column(Modifier.fillMaxWidth().background(c.yellow.copy(alpha = .09f))
                    .padding(horizontal = 20.dp, vertical = 10.dp)) {
                    Label(inboxTitle(item.kind), 15, 20, weight = FontWeight.Medium)
                    item.text?.let { Label(it, 13, 18, Modifier.padding(top = 2.dp), color = c.ink2, maxLines = 3) }
                    Label(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(item.createdAt)), 12, 16,
                        Modifier.padding(top = 3.dp), color = c.dim)
                }
            }
            if (bots.inbox.isEmpty()) item(key = "members-inbox-empty") { MembersHint("没有待处理的请求") }
            item(key = "members-team-title") { MemberGroup("成员", bots.members.size) }
            items(bots.members.size, key = { "member-${bots.members[it].id}" }) { index ->
                val member = bots.members[index]
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 9.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(CircleShape).background(memberDot(member.status)))
                    Column(Modifier.weight(1f)) {
                        Label(member.name, 15, 20, weight = FontWeight.Medium, maxLines = 1)
                        Label(member.title, 12, 16, color = c.dim, maxLines = 1)
                    }
                    Label(memberStatus(member.status), 12, 16, color = c.dim)
                }
            }
            item(key = "members-chats-title") { MemberGroup("群聊与私聊", bots.chats.size) }
            items(bots.chats.size, key = { "chat-${bots.chats[it].id}" }) { index ->
                val chat = bots.chats[index]
                Column(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}
                    .clickable(role = Role.Button) {
                        openRootId = chat.id
                        val target = bots.activeBotThread(chat.id) ?: chat
                        displayedId = target.id
                        // The desktop only returns group timelines for bot-chat-open.
                        if (chat.kind == "group") onOpenChat(target.id)
                    }
                    .padding(horizontal = 20.dp, vertical = 10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Label(chat.title, 16, 22, Modifier.weight(1f), weight = FontWeight.Medium, maxLines = 1)
                        Label(if (chat.kind == "group") "群聊" else "私聊", 12, 16, color = c.dim)
                    }
                    chat.lastText?.let { Label(it, 13, 18, Modifier.padding(top = 2.dp), color = c.ink2, maxLines = 1) }
                }
            }
            if (bots.chats.isEmpty()) item(key = "members-chats-empty") { MembersHint("桌面还没有群聊或私聊") }
            bots.error?.let { item(key = "members-error") { MembersHint(it) } }
        }
    }
    val current = bots ?: return
    val root = current.chats.firstOrNull { it.id == openRootId && !it.archived } ?: return
    if (current.enabled != true) return
    val active = current.activeBotThread(root.id)
    val threadAction = current.threadAction?.takeIf { it.rootId == root.id }
    val waiting = threadAction?.phase == SessionCommandPhase.Waiting
    LaunchedEffect(active?.id, threadAction?.requestId, threadAction?.phase) {
        if (active != null && !waiting && active.id != displayedId) {
            displayedId = active.id
            onOpenChat(active.id)
        }
        if (threadAction?.phase == SessionCommandPhase.Observed && active?.id == threadAction.resultId) showThreads = false
    }
    val chat = current.chats.firstOrNull { it.id == displayedId } ?: current.threads.firstOrNull { it.id == displayedId }
        ?: return
    val threadAvailable = root.kind == "group" && current.threadsEnabled && active != null
    if (showThreads && threadAvailable) {
        BotThreadPicker(root, current.threads.filter { it.parentId == root.id }, requireNotNull(active), threadAction,
            writable = writable && onThreadChange != null && current.send?.phase != SessionCommandPhase.Waiting &&
                current.stop?.phase != SessionCommandPhase.Waiting, onDismiss = { showThreads = false }, onChoose = { command, id ->
                onThreadChange?.invoke(root.id, command, id, active.id)
            })
    } else {
        ChatTimelineSheet(chat, current, onDismiss = { openRootId = null; displayedId = null; showThreads = false },
            onOlder = { seq -> onLoadOlder(chat.id, seq) }, writable = writable && !waiting && (active == null || active.id == chat.id),
            onSend = onSend, onStop = onStop, onThreads = if (threadAvailable) ({ showThreads = true }) else null,
            draft = drafts[chat.id] ?: BotMessageDraft(), onDraft = { drafts = drafts + (chat.id to it) })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatTimelineSheet(
    chat: DesktopBotChat, bots: DesktopBotsState, onDismiss: () -> Unit, onOlder: (Long) -> Unit,
    writable: Boolean, onSend: ((String, String, String) -> Unit)?, onStop: ((String) -> Unit)?,
    draft: BotMessageDraft, onDraft: (BotMessageDraft) -> Unit,
    onThreads: (() -> Unit)?,
) {
    val c = Enso.colors
    val entries = bots.timeline.takeIf { bots.timelineChatId == chat.id }.orEmpty()
    val state = bots.chatStates[chat.id]
    val send = bots.send?.takeIf { it.chatId == chat.id }
    val stop = bots.stop?.takeIf { it.chatId == chat.id }
    val sending = bots.send?.phase == SessionCommandPhase.Waiting
    val stopping = bots.stop?.phase == SessionCommandPhase.Waiting
    val canSend = writable && onSend != null && botMessageText(draft.text) != null && !sending && !stopping
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.page, contentColor = c.ink, scrimColor = Color.Black.copy(alpha = .35f),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)) {
        Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Label(chat.threadTitle ?: chat.title, 17, 22, Modifier.weight(1f), weight = FontWeight.SemiBold, maxLines = 1)
                if (onThreads != null) Label("话题", 14, 20, Modifier.clip(CircleShape)
                    .clickable(role = Role.Button, onClick = onThreads).padding(12.dp), color = c.ink2)
                GlyphButton(EnsoIcon.Close, "关闭会话", 40.dp, 20.dp, tint = c.dim, onClick = onDismiss)
            }
            val older = bots.timelineHasOlder && bots.timelineChatId == chat.id && !bots.timelineLoading
            if (older && entries.isNotEmpty()) Box(Modifier.fillMaxWidth().heightIn(min = 40.dp)
                .clickable(role = Role.Button) { onOlder(entries.first().seq) }, contentAlignment = Alignment.Center) {
                Label("加载更早的消息", 13, 18, color = c.dim)
            }
            if (bots.timelineLoading && bots.timelineChatId == chat.id) MembersHint("正在加载会话…")
            bots.timelineError?.takeIf { bots.timelineChatId == chat.id }?.let { MembersHint(it) }
            if (chat.kind == "direct") MembersHint("私聊历史暂未接入，可以发送文字。")
            else if (entries.isEmpty() && !bots.timelineLoading && bots.timelineError == null) {
                MembersHint("这个会话还没有可显示的消息。")
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 520.dp).padding(horizontal = 16.dp)) {
                items(entries.size, key = { "entry-${entries[it].id}" }) { index ->
                    GroupEntryRow(entries[index], bots)
                }
            }
            state?.let { running ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(
                        if (running.current != null) "正在处理" + (if (running.queue.isNotEmpty()) " · 队列 ${running.queue.size}" else "")
                        else if (running.queue.isNotEmpty()) "排队 ${running.queue.size} 条" else "空闲",
                        12, 16, Modifier.weight(1f), color = c.dim,
                    )
                    if (running.current != null) Box(Modifier.heightIn(min = 34.dp).clip(CircleShape).background(c.card2)
                        .clickable(writable && onStop != null && !stopping && !sending, role = Role.Button) { onStop?.invoke(chat.id) }
                        .padding(horizontal = 12.dp, vertical = 6.dp)) {
                        Label(if (stopping) "正在停止…" else "停止", 13, 18,
                            color = if (writable) c.red else c.dim, weight = FontWeight.Medium)
                    }
                }
            }
            val notice = when (send?.phase) {
                SessionCommandPhase.Waiting -> "正在发送…"
                SessionCommandPhase.Unconfirmed -> "发送未确认，请先检查桌面。"
                SessionCommandPhase.Rejected -> "桌面拒绝发送" + (send.error?.let { "：$it" } ?: "。")
                else -> when (stop?.phase) {
                    SessionCommandPhase.Unconfirmed -> "停止未确认，请检查桌面。"
                    SessionCommandPhase.Rejected -> "桌面拒绝了停止。"
                    else -> null
                }
            }
            notice?.let { MembersHint(it) }
            if (!writable) MembersHint("只读连接：可以查看，不能发送或停止。")
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                BasicTextField(draft.text, { if (it.length <= SESSION_TEXT_LIMIT) onDraft(draft.copy(text = it)) },
                    Modifier.weight(1f).heightIn(min = 48.dp).clip(CircleShape).background(c.card)
                        .padding(horizontal = 16.dp, vertical = 12.dp)
                        .semantics { contentDescription = "群聊消息" },
                    readOnly = !writable, singleLine = false, maxLines = 4,
                    textStyle = ensoText(15, 21).copy(color = c.ink), cursorBrush = SolidColor(c.ink),
                    decorationBox = { field -> Box {
                        if (draft.text.isEmpty()) Label("发消息给成员…", 15, 21, color = c.dim, maxLines = 1)
                        field()
                    } })
                Box(Modifier.size(48.dp).clip(CircleShape).background(if (canSend) c.pill else c.card2)
                    .clickable(enabled = canSend, role = Role.Button) {
                        val deliveryId = UUID.randomUUID().toString()
                        onDraft(draft.submitted(deliveryId))
                        onSend?.invoke(chat.id, draft.text, deliveryId)
                    }.semantics { contentDescription = "发送到成员" }, contentAlignment = Alignment.Center) {
                    Glyph(EnsoIcon.ArrowUp, Modifier.size(22.dp), if (canSend) c.pillInk else c.dim)
                }
            }
        }
    }
}

@Composable
private fun GroupEntryRow(entry: DesktopGroupEntry, bots: DesktopBotsState) {
    val c = Enso.colors
    val human = entry.kind == "human"
    val system = entry.kind == "system"
    val name = if (human) "你" else entry.botId?.let { id -> bots.members.firstOrNull { it.id == id }?.name } ?: "成员"
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp),
        horizontalAlignment = if (human) Alignment.End else Alignment.Start) {
        if (!system) {
            Label(name, 11, 14, color = c.dim)
        }
        Box(Modifier.padding(top = 2.dp).clip(RoundedCornerShape(16.dp))
            .background(if (human) c.pill else c.card).padding(horizontal = 14.dp, vertical = 10.dp)) {
            Label(entry.text, 14, 20, color = if (human) c.pillInk else if (system) c.dim else c.ink)
        }
    }
}

@Composable
private fun MemberGroup(title: String, count: Int) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 4.dp),
        verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(title, 15, 20, weight = FontWeight.SemiBold, color = Enso.colors.dim)
        Label(count.toString(), 13, 18, color = Enso.colors.faint)
    }
}

@Composable
private fun MembersHint(text: String) = Label(text, 13, 18,
    Modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = Enso.colors.dim)

private fun inboxTitle(kind: String) = when (kind) {
    "approval" -> "等你审批"
    "ask" -> "在问你"
    "delegation-interrupted" -> "协作被中断"
    "budget" -> "额度提醒"
    "routine-draft" -> "例程草稿待确认"
    "routine-blocked" -> "例程被阻塞"
    "silence" -> "很久没有动静"
    "task-blocked" -> "任务受阻"
    else -> "待处理"
}

private fun memberStatus(status: String) = when (status) {
    "running" -> "进行中"
    "queued" -> "排队中"
    else -> "空闲"
}

@Composable
private fun memberDot(status: String) = when (status) {
    "running" -> Enso.colors.blue
    "queued" -> Enso.colors.yellow
    else -> Enso.colors.faint
}
