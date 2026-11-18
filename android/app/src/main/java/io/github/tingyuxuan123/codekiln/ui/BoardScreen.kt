package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopTask
import java.util.Calendar

/**
 * Catalog-only board. Inline approve/deny needs the desktop to publish request summaries (B2),
 * so a waiting row only opens its session instead of pretending to act on an unknown request.
 */
@Composable
internal fun BoardScreen(tasks: List<DesktopTask>, now: Long, onBack: () -> Unit, onTask: (String) -> Unit) {
    val c = Enso.colors
    val dayStart = remember(now) { startOfDay(now) }
    val groups = remember(tasks, dayStart) { boardGroups(tasks, dayStart) }
    Column(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(24.dp)) {
        TopBar("任务看板", EnsoIcon.Back, "返回新任务", onBack,
            listOfNotNull(
                groups.waiting.size.takeIf { it > 0 }?.let { "$it 个等你" },
                groups.running.size.takeIf { it > 0 }?.let { "$it 个运行中" },
            ).joinToString(" · ").ifBlank { "暂无进行中的任务" })
        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
            item(key = "board-waiting-title") {
                BoardGroupTitle("等你处理", groups.waiting.size)
            }
            items(groups.waiting.size, key = { "waiting-${groups.waiting[it].id}" }) { index ->
                val task = groups.waiting[index]
                WaitingRow(task, now, onTask)
            }
            if (groups.waiting.isEmpty()) item(key = "board-waiting-empty") { BoardEmpty("没有被卡住的请求") }
            item(key = "board-running-title") { BoardGroupTitle("运行中", groups.running.size) }
            items(groups.running.size, key = { "running-${groups.running[it].id}" }) { index ->
                RunningRow(groups.running[index], now, onTask)
            }
            if (groups.running.isEmpty()) item(key = "board-running-empty") { BoardEmpty("没有正在运行的任务") }
            item(key = "board-done-title") { BoardGroupTitle("今天完成", groups.done.size) }
            items(groups.done.size, key = { "done-${groups.done[it].id}" }) { index ->
                DoneRow(groups.done[index], now, onTask)
            }
            if (groups.done.isEmpty()) item(key = "board-done-empty") { BoardEmpty("今天还没有完成的任务") }
            item(key = "board-limit") {
                Label("子代理与后台任务需在会话内查看（尚未接入）。", 12, 16,
                    Modifier.padding(horizontal = 20.dp, vertical = 14.dp), color = c.faint)
            }
        }
    }
}

@Composable
private fun BoardGroupTitle(title: String, count: Int) {
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 6.dp),
        verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(title, 15, 20, weight = FontWeight.SemiBold, color = Enso.colors.dim)
        Label(count.toString(), 13, 18, color = Enso.colors.faint)
    }
}

@Composable
private fun BoardEmpty(text: String) = Label(text, 13, 18,
    Modifier.padding(horizontal = 20.dp, vertical = 6.dp), color = Enso.colors.faint)

@Composable
private fun WaitingRow(task: DesktopTask, now: Long, onTask: (String) -> Unit) {
    val c = Enso.colors
    val asks = task.pendingAskCount > 0
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button) { onTask(task.id) }
        .background(c.yellow.copy(alpha = .09f)).padding(horizontal = 20.dp, vertical = 12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Label(task.title, 16, 22, weight = FontWeight.Medium, maxLines = 1)
                Label(
                    buildList {
                        if (task.pendingApprovalCount > 0) add("${task.pendingApprovalCount} 个操作待审批")
                        if (task.pendingAskCount > 0) add("${task.pendingAskCount} 个问题待回答")
                    }.joinToString(" · "),
                    12, 17, color = c.ink2, maxLines = 1,
                )
            }
            StatusGlyph(TaskStatus.Waiting, Modifier.align(Alignment.CenterVertically))
        }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Label("到会话里${if (asks) "回答" else "审批"}", 13, 18, color = c.ink2)
            relativeTime(task.updatedAt, now)?.let { Label(it, 12, 16, Modifier.weight(1f), color = c.dim) }
        }
    }
}

@Composable
private fun RunningRow(task: DesktopTask, now: Long, onTask: (String) -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button) { onTask(task.id) }
        .padding(horizontal = 20.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f)) {
            Label(task.title, 16, 22, weight = FontWeight.Medium, maxLines = 1)
            val detail = listOfNotNull(task.projectName.takeIf { it.isNotBlank() },
                relativeTime(task.updatedAt, now)).joinToString(" · ")
            if (detail.isNotBlank()) Row(Modifier.padding(top = 3.dp), horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Glyph(EnsoIcon.Folder, Modifier.size(13.dp), c.ink2)
                Label(detail, 12, 17, color = c.ink2, maxLines = 1)
            }
        }
        StatusGlyph(TaskStatus.Running, Modifier.align(Alignment.CenterVertically))
    }
}

@Composable
private fun DoneRow(task: DesktopTask, now: Long, onTask: (String) -> Unit) {
    val c = Enso.colors
    Column(Modifier.fillMaxWidth().clickable(role = Role.Button) { onTask(task.id) }
        .padding(horizontal = 20.dp, vertical = 10.dp)) {
        Label(task.title, 16, 22, color = c.ink2, weight = FontWeight.Medium, maxLines = 1)
        SessionMeta(task.projectName.takeIf { it.isNotBlank() }, relativeTime(task.updatedAt, now) ?: "时间未知",
            Modifier.padding(top = 3.dp))
    }
}

private fun startOfDay(now: Long): Long = Calendar.getInstance().apply {
    timeInMillis = now
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
}.timeInMillis
