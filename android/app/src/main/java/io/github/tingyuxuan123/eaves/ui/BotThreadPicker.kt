package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.BotThreadCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopBotChat
import io.github.tingyuxuan123.eaves.mirror.DesktopBotThreadAction
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase

/** `frames/threads.tsx`. Choosing a topic changes the desktop too; do not navigate optimistically. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun BotThreadPicker(
    root: DesktopBotChat, threads: List<DesktopBotChat>, active: DesktopBotChat,
    action: DesktopBotThreadAction?, writable: Boolean,
    onDismiss: () -> Unit, onChoose: (BotThreadCommand, String?) -> Unit,
) {
    val c = Enso.colors
    val waiting = action?.phase == SessionCommandPhase.Waiting
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.page, contentColor = c.ink, shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Label("${root.title} · 线程", 17, 22, Modifier.weight(1f), weight = FontWeight.SemiBold, maxLines = 1)
                GlyphButton(EnsoIcon.Close, "关闭线程列表", 40.dp, 20.dp, tint = c.dim, onClick = onDismiss)
            }
            Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.card)) {
                (listOf(root) + threads.filter { !it.archived }).forEachIndexed { index, topic ->
                    if (index > 0) Hairline()
                    Row(Modifier.fillMaxWidth().clickable(enabled = writable && !waiting && topic.id != active.id,
                        role = Role.Button) { onChoose(BotThreadCommand.Select, topic.id) }
                        .padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Glyph(EnsoIcon.ListOrdered, Modifier.size(20.dp), c.ink2)
                        Column(Modifier.weight(1f)) {
                            Label(topic.threadTitle ?: if (topic.id == root.id) "主话题" else topic.title,
                                16, 22, weight = FontWeight.Medium, maxLines = 1)
                            Label(if (topic.lastSeq == 0L) "还没有消息" else "已更新", 12, 16, color = c.dim)
                        }
                        if (topic.id == active.id) Glyph(EnsoIcon.Check, Modifier.size(20.dp))
                    }
                }
            }
            Label("新线程里成员从空白上下文开始，群成员和主持人不变。切换会同步电脑的当前话题，不会中断旧话题正在进行的轮次。",
                13, 18, Modifier.padding(horizontal = 24.dp, vertical = 12.dp), color = c.dim)
            val enabled = writable && !waiting
            Box(Modifier.padding(horizontal = 16.dp).fillMaxWidth().heightIn(min = 52.dp)
                .glass(inverted = enabled).clickable(enabled, role = Role.Button) { onChoose(BotThreadCommand.Create, null) },
                contentAlignment = Alignment.Center) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    val tint = if (enabled) c.pillInk else c.dim
                    Glyph(EnsoIcon.Plus, Modifier.size(20.dp), tint)
                    Label("新线程", 15, 20, color = tint, weight = FontWeight.Medium)
                }
            }
            val notice = when (action?.phase) {
                SessionCommandPhase.Waiting -> "正在等待桌面切换话题…"
                SessionCommandPhase.Unconfirmed -> "话题操作未确认，请先检查电脑。不会自动重试。"
                SessionCommandPhase.Rejected -> "桌面拒绝了话题操作${action.error?.let { "：$it" } ?: "。"}"
                SessionCommandPhase.Observed -> if (active.id != action.resultId) "已收到桌面回执，正在等待话题目录同步…" else null
                else -> null
            }
            if (!writable) SheetHint("只读连接可以查看线程，但不能改变电脑的当前话题。")
            notice?.let { SheetHint(it) }
        }
    }
}
