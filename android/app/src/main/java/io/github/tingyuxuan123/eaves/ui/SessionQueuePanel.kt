package io.github.tingyuxuan123.eaves.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopQueuedMessage
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.QueueCommand
import io.github.tingyuxuan123.eaves.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase

private val disclosureEasing = CubicBezierEasing(.22f, 1f, .36f, 1f)
private data class QueuedAction(val command: QueueCommand, val item: DesktopQueuedMessage)

/** `queue.tsx`: authoritative, ordered rows. Only the expanded row exposes actions. */
@Composable
internal fun SessionQueuePanel(
    state: DesktopSessionState,
    writable: Boolean,
    maxRowsHeight: Dp,
    initialExpandedId: String? = null,
    onAction: (QueueCommand, String?, String?) -> Unit,
) {
    val c = Enso.colors
    val attempt = state.queueAttempt
    val waiting = attempt?.phase == SessionCommandPhase.Waiting
    val canAct = writable && !waiting && state.textAttempt?.phase != SessionCommandPhase.Waiting
    var expandedId by remember(state.timeline.sessionId) { mutableStateOf(initialExpandedId) }
    var modal by remember(state.timeline.sessionId) { mutableStateOf<QueuedAction?>(null) }
    var editText by remember(state.timeline.sessionId) { mutableStateOf("") }
    val action = modal
    val current = action?.let { target -> state.queued.firstOrNull { it.id == target.item.id } }
    val matchingEdit = action?.command == QueueCommand.Update && attempt?.command == QueueCommand.Update &&
        attempt.messageId == action.item.id && attempt.text == editText

    LaunchedEffect(attempt?.id, attempt?.phase) {
        if (matchingEdit && attempt.phase == SessionCommandPhase.Observed) modal = null
    }

    if (state.queued.isNotEmpty()) {
        Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(c.card)) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Glyph(EnsoIcon.ListOrdered, Modifier.size(16.dp), c.ink2)
                Label("排队中 · ${state.queued.size} 条", 15, 20, Modifier.weight(1f), weight = FontWeight.SemiBold)
                Label("本轮结束后依次发送", 12, 16, color = c.dim, maxLines = 1)
            }
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = maxRowsHeight)) {
                itemsIndexed(state.queued, key = { _, item -> item.id }) { index, item ->
                    val open = expandedId == item.id
                    Column(Modifier.fillMaxWidth().background(if (open) c.card2.copy(alpha = .6f) else c.card)) {
                        Row(Modifier.fillMaxWidth().testTag("queued-${item.id}").clickable(role = Role.Button) {
                            expandedId = if (open) null else item.id
                        }.semantics { stateDescription = if (open) "已展开" else "已折叠" }
                            .padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Label("${index + 1}", 13, 20, color = c.faint)
                            Label(item.text.ifBlank { "图片附件" }, 14, 20, Modifier.weight(1f), maxLines = if (open) 6 else 1)
                            if (!open) Glyph(EnsoIcon.More, Modifier.size(20.dp), c.ink2)
                        }
                        AnimatedVisibility(open, enter = expandVertically(animationSpec = tween(250, easing = disclosureEasing)),
                            exit = shrinkVertically(animationSpec = tween(250, easing = disclosureEasing))) {
                            FlowRow(Modifier.fillMaxWidth().padding(start = 38.dp, end = 10.dp, bottom = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                if (state.running) QueuePill("打断并发送", EnsoIcon.Zap, canAct, c.pill, c.pillInk) {
                                    modal = QueuedAction(QueueCommand.InterruptSend, item)
                                }
                                QueuePill("编辑", EnsoIcon.Pencil, canAct, c.card, c.ink) {
                                    editText = item.text
                                    modal = QueuedAction(QueueCommand.Update, item)
                                }
                                QueuePill("删除", EnsoIcon.Trash, canAct, c.card, c.red) {
                                    modal = QueuedAction(QueueCommand.Remove, item)
                                }
                                QueuePill(if (state.running) "立即插话" else "立即发送", null,
                                    canAct && (state.running || state.canPrompt), c.card, c.ink2) {
                                    onAction(QueueCommand.SendNow, item.id, null)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    val notice = when (attempt?.phase) {
        SessionCommandPhase.Waiting -> "正在等待桌面更新队列…"
        SessionCommandPhase.Unconfirmed -> "队列操作未确认，请先检查桌面。"
        SessionCommandPhase.Rejected -> "桌面拒绝了队列操作。"
        else -> null
    }
    if (notice != null) Label(notice, 12, 16, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = c.dim)
    if (action != null) {
        val editing = action.command == QueueCommand.Update
        val unchanged = current == action.item
        val interrupting = action.command == QueueCommand.InterruptSend
        val valid = canAct && unchanged && (!interrupting || state.running) &&
            (!editing || editText.isNotBlank() && editText.length <= SESSION_TEXT_LIMIT && editText != action.item.text)
        AlertDialog(onDismissRequest = { modal = null }, title = {
            Text(when (action.command) {
                QueueCommand.Update -> "编辑排队消息"
                QueueCommand.InterruptSend -> "打断当前轮并发送？"
                else -> "删除排队消息？"
            })
        }, text = {
            if (editing) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(editText, { editText = it }, Modifier.fillMaxWidth().semantics { contentDescription = "排队消息正文" }, label = { Text("消息正文") },
                    readOnly = waiting, minLines = 2, maxLines = 5, isError = editText.length > SESSION_TEXT_LIMIT)
                if (action.item.hasImages) Text("原有图片会保留。")
                if (!unchanged) Text("该消息已在桌面变化，请关闭后重新打开。")
                else if (matchingEdit && notice != null) Text(notice)
            } else Text(if (!unchanged) "这条消息已变化，不能继续操作。" else if (interrupting)
                "当前轮会停止，桌面将用这条消息开始新一轮。" else "只从队列中移除这条消息，不修改会话记录。")
        }, confirmButton = {
            TextButton(enabled = valid, onClick = {
                onAction(action.command, action.item.id, editText.takeIf { editing })
                if (!editing) modal = null
            }) { Text(if (editing) "保存" else if (interrupting) "确认打断并发送" else "确认删除") }
        }, dismissButton = { TextButton(onClick = { modal = null }) { Text("关闭") } })
    }
}

@Composable
private fun QueuePill(label: String, icon: EnsoIcon?, enabled: Boolean, ground: Color, ink: Color, onClick: () -> Unit) {
    val tint = ink.copy(alpha = if (enabled) 1f else .55f)
    Row(Modifier.heightIn(min = 40.dp).clip(CircleShape).background(ground)
        .clickable(enabled, role = Role.Button, onClick = onClick).padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (icon != null) Glyph(icon, Modifier.size(14.dp), tint)
        Label(label, 13, 18, color = tint, weight = FontWeight.Medium)
    }
}
