package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.pair.SessionTodo
import io.github.tingyuxuan123.eaves.pair.SessionTodoStatus

@Composable
internal fun SessionWorklogRow(worklog: SessionBlock.Worklog, description: String?, prose: @Composable (String) -> Unit) {
    val c = Enso.colors
    var expanded by rememberSaveable { mutableStateOf(false) }
    val title = description ?: when {
        worklog.running -> "工作中"
        worklog.hasAnswer -> "已工作"
        else -> "执行记录"
    }
    val counts = buildList {
        if (worklog.thinking > 0) add("${worklog.thinking} 段思考")
        if (worklog.calls > 0) add("${worklog.calls} 次调用")
        if (isEmpty() && worklog.notices > 0) add("${worklog.notices} 条通知")
    }.joinToString(" · ")
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button) { expanded = !expanded }
            .semantics { stateDescription = if (expanded) "已展开" else "已折叠" }
            .heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Glyph(when {
                worklog.running -> EnsoIcon.Timer
                worklog.hasAnswer -> EnsoIcon.CircleCheck
                else -> EnsoIcon.ListOrdered
            }, Modifier.size(16.dp), when {
                worklog.running -> c.blue
                worklog.hasAnswer -> c.green
                else -> c.dim
            })
            Label(title, 13, 19, color = c.ink2, weight = FontWeight.Medium, maxLines = 1)
            Glyph(if (expanded) EnsoIcon.Down else EnsoIcon.Right, Modifier.size(13.dp), c.dim)
            Label(if (expanded) "" else counts, 12, 18, Modifier.weight(1f), color = c.dim, maxLines = 1)
            if (worklog.failures > 0) Label("${worklog.failures} 次调用失败", 11, 16,
                Modifier.background(c.red.copy(alpha = .09f), RoundedCornerShape(4.dp)).padding(horizontal = 5.dp, vertical = 2.dp),
                color = c.red, maxLines = 1)
        }
        if (expanded) Column(Modifier.fillMaxWidth().padding(start = 22.dp, bottom = 6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)) {
            worklog.entries.forEach { block -> when (block) {
                is SessionBlock.Prose -> prose(block.text)
                is SessionBlock.Steps -> block.steps.forEach { WorklogStep(it) }
                is SessionBlock.Notice -> TimelineDisclosure(block.kind.title, block.detail, EnsoIcon.Terminal)
                is SessionBlock.Todos -> SessionTodoCard(block.items)
                else -> Unit
            } }
        }
    }
}

/** Keep in step with ThinkingRow and toolIcon in src/renderer/components/chat/TimelineRow.tsx. */
internal val SessionStep.worklogIcon: EnsoIcon
    get() = if (kind == SessionStepKind.Thinking) EnsoIcon.Brain else when (name) {
        "read" -> EnsoIcon.FileText
        "ls" -> EnsoIcon.FolderOpen
        "grep", "find", "glob", "code_search" -> EnsoIcon.Search
        "bash", "powershell", "task_output" -> EnsoIcon.TerminalSquare
        "edit", "apply_patch" -> EnsoIcon.Pencil
        "write" -> EnsoIcon.FilePlus
        "exec", "codemode" -> EnsoIcon.BoxSelect
        "subagent" -> EnsoIcon.Bot
        else -> if ("web" in name || "fetch" in name) EnsoIcon.Globe else EnsoIcon.Wrench
    }

@Composable
private fun WorklogStep(step: SessionStep) {
    val c = Enso.colors
    val description = step.detail?.lineSequence()?.firstOrNull()?.take(100)?.takeIf { it.isNotBlank() }
    val title = if (step.failed) "${step.name} · 失败" else listOfNotNull(step.name, description).joinToString(" · ")
    val details = listOfNotNull(step.detail, step.result).joinToString("\n\n").takeIf { it.isNotBlank() }
    if (step.failed) {
        Label(title, 13, 19, color = c.red)
        TimelineDisclosure("查看错误详情", details, step.worklogIcon)
    } else TimelineDisclosure(title, details, step.worklogIcon)
}

@Composable
internal fun SessionTodoCard(items: List<SessionTodo>) {
    val c = Enso.colors
    var expanded by remember { mutableStateOf(false) }
    val done = items.count { it.status == SessionTodoStatus.Completed }
    Column(Modifier.fillMaxWidth().background(c.card2.copy(alpha = .55f), RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Glyph(EnsoIcon.ListOrdered, Modifier.size(16.dp), c.dim)
            Label("待办清单", 14, 20, Modifier.weight(1f), weight = FontWeight.Medium)
            Label("$done/${items.size}", 12, 18, color = c.dim)
        }
        if (items.isEmpty()) Label("待办已清空", 13, 18, color = c.dim)
        val shown = if (expanded) items else items.take(4)
        shown.forEach { item ->
            val completed = item.status == SessionTodoStatus.Completed
            val running = item.status == SessionTodoStatus.InProgress
            val state = when (item.status) {
                SessionTodoStatus.Completed -> "已完成"
                SessionTodoStatus.InProgress -> "进行中"
                SessionTodoStatus.Pending -> "待处理"
            }
            Row(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = "$state：${item.content}" },
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (completed) Glyph(EnsoIcon.CircleCheck, Modifier.padding(top = 2.dp).size(16.dp), c.green)
                else Box(Modifier.padding(top = 2.dp).size(16.dp).border(1.dp, if (running) c.ink2 else c.faint, CircleShape),
                    contentAlignment = Alignment.Center) {
                    if (running) Box(Modifier.size(6.dp).background(c.ink2, CircleShape))
                }
                Text(item.content, color = if (running) c.ink else c.dim,
                    style = ensoText(13, 19, if (running) FontWeight.Medium else FontWeight.Normal),
                    textDecoration = if (completed) TextDecoration.LineThrough else null)
            }
        }
        if (items.size > 4) Label(if (expanded) "收起待办" else "查看全部 ${items.size} 项",
            13, 18, Modifier.fillMaxWidth().clickable(role = Role.Button) { expanded = !expanded }
                .padding(vertical = 6.dp), color = c.ink2)
    }
}

/** Display-only text; expanding an internal notice never launches a link or runs a command. */
@Composable
internal fun TimelineDisclosure(title: String, detail: String?, icon: EnsoIcon, modifier: Modifier = Modifier) {
    val c = Enso.colors
    var expanded by remember(title, detail) { mutableStateOf(false) }
    val canExpand = !detail.isNullOrBlank()
    Column(modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().then(if (canExpand) Modifier
            .semantics { stateDescription = if (expanded) "已展开" else "已折叠" }
            .clickable(role = Role.Button) { expanded = !expanded } else Modifier)
            .padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Glyph(icon, Modifier.size(16.dp), c.dim)
            Label(title, 12, 18, Modifier.weight(1f), color = c.dim, maxLines = 1)
            if (canExpand) Glyph(if (expanded) EnsoIcon.Down else EnsoIcon.Right, Modifier.size(16.dp), c.dim)
        }
        if (expanded && canExpand) Text(requireNotNull(detail), Modifier.padding(start = 23.dp, bottom = 6.dp),
            color = c.dim, style = ensoText(12, 18, font = Enso.mono))
    }
}
