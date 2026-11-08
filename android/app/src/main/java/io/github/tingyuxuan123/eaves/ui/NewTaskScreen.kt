package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.tingyuxuan123.eaves.R

internal data class NewTaskUiState(
    val greeting: String = "你好",
    val model: String? = null,
    val project: String? = null,
    val online: Boolean = false,
    val computer: String? = null,
    val pendingMemberCount: Int = 0,
    val tasks: List<TaskSummary> = emptyList(),
    val draft: String = "",
    val composerAvailable: Boolean = true,
    val connectionLabel: String? = null,
    val composerEnabled: Boolean = true,
)

@Composable
internal fun NewTaskScreen(
    state: NewTaskUiState,
    onHome: () -> Unit,
    onPair: () -> Unit,
    onConfig: () -> Unit,
    onBoard: () -> Unit,
    onTask: (String) -> Unit,
    onDraft: (String) -> Unit,
    onSend: (() -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val c = Enso.colors
    Box(Modifier.fillMaxSize().background(c.page)) {
        Dawn()
        Column(Modifier.fillMaxSize().designTopInset().designBottomInset(24.dp).imePadding()) {
            TopBar("新任务", EnsoIcon.Menu, "打开任务列表", onHome,
                detail = state.model ?: state.connectionLabel ?: "连接电脑后选择模型", showMenu = state.model != null)
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = maxHeight)
                    .padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 12.dp)) {
                    androidx.compose.material3.Text(state.greeting,
                        style = ensoText(34, 42, FontWeight.SemiBold).copy(letterSpacing = (-.34).sp), color = c.ink)
                    androidx.compose.material3.Text("今天让它做点什么？",
                        style = ensoText(34, 42, FontWeight.SemiBold).copy(
                            brush = Brush.horizontalGradient(listOf(c.greetStart, c.greetEnd)), letterSpacing = (-.34).sp))
                    Row(
                        Modifier.padding(top = 20.dp).height(40.dp).glass()
                            .semantics { contentDescription = "打开新任务设置" }
                            .clickable(enabled = state.composerEnabled, onClick = onConfig).padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Glyph(EnsoIcon.Folder, Modifier.size(16.dp))
                        Label(state.project ?: "选择项目", 14, 20, weight = FontWeight.Medium)
                        Glyph(EnsoIcon.Chevrons, Modifier.size(14.dp), c.dim)
                    }
                    Spacer(Modifier.weight(1f).height(32.dp))
                    val glance = taskGlance(state.tasks)
                    if (glance.tasks.isNotEmpty()) {
                        TaskGlanceCard(glance, onTask, onBoard)
                    }
                }
            }
            footer?.invoke()
            if (state.online && state.composerAvailable) {
                Composer(state.draft, onDraft, onSend, inputEnabled = state.composerEnabled, dimAction = onSend == null)
            } else {
                Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Label(state.connectionLabel ?: "连接电脑后，开始任务并在这里查看进度",
                        13, 18, color = c.dim)
                    Row(Modifier.fillMaxWidth().height(48.dp).glass(inverted = true)
                        .clickable(onClick = onPair), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center) {
                        Glyph(EnsoIcon.Link, Modifier.size(18.dp), c.pillInk)
                        Label(if (state.online) "管理连接" else "连接电脑", 15, 20, Modifier.padding(start = 8.dp), color = c.pillInk, weight = FontWeight.Medium)
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskGlanceCard(glance: TaskGlance, onTask: (String) -> Unit, onBoard: () -> Unit) {
    val c = Enso.colors
    Column(Modifier.fillMaxWidth().glass(Enso.sheetShape)) {
        Row(Modifier.padding(start = 14.dp, end = 16.dp, top = 14.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(24.dp).background(c.card, CircleShape), contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.eaves_running_small), "Eaves 运行中", Modifier.size(20.dp))
            }
            Label("任务看板", 15, 20, weight = FontWeight.SemiBold)
        }
        glance.tasks.forEachIndexed { index, task ->
            if (index > 0) Hairline()
            Row(Modifier.fillMaxWidth()
                .background(if (task.status == TaskStatus.Waiting) c.yellow.copy(alpha = .09f) else c.card.copy(alpha = 0f))
                .clickable { onTask(task.id) }.padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                    Label(task.title, 15, 20, weight = FontWeight.Medium, maxLines = 1)
                    SessionMeta(task.project, task.time)
                }
                StatusGlyph(task.status)
            }
        }
        Hairline(Modifier.padding(horizontal = 16.dp))
        Row(Modifier.fillMaxWidth().clickable(onClick = onBoard).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Label(if (glance.remaining > 0) "还有 ${glance.remaining} 个 · 查看全部" else "查看全部", 15, 20,
                Modifier.weight(1f), color = c.ink2)
            Glyph(EnsoIcon.Right, Modifier.size(18.dp), c.ink2)
        }
    }
}

@Composable
internal fun StatusGlyph(status: TaskStatus, modifier: Modifier = Modifier) {
    when (status) {
        TaskStatus.Waiting -> Glyph(EnsoIcon.Waiting, modifier.size(16.dp), Enso.colors.yellow, "等待处理")
        TaskStatus.Running -> Image(painterResource(R.drawable.eaves_running_small), "运行中", modifier.size(16.dp))
        TaskStatus.Error -> Glyph(EnsoIcon.Error, modifier.size(16.dp), Enso.colors.red, "出错")
        TaskStatus.Done, TaskStatus.Idle -> Unit
    }
}

@Composable
internal fun Composer(
    value: String,
    onValue: (String) -> Unit,
    onAction: (() -> Unit)?,
    placeholder: String = "描述任务，@ 引用文件，/ 用技能",
    inputLabel: String = "任务描述",
    inputEnabled: Boolean = true,
    running: Boolean = false,
    dimAction: Boolean = false,
    onAttach: (() -> Unit)? = null,
    attachmentAvailable: Boolean = false,
) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
        Row(Modifier.weight(1f).clip(Enso.composerShape).background(c.card)
            .border(1.dp, c.line, Enso.composerShape).padding(6.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GlyphButton(EnsoIcon.Plus, if (attachmentAvailable) "添加图片" else "添加附件（尚未接入）", 36.dp, 22.dp,
                tint = if (onAttach == null && attachmentAvailable) c.dim else c.ink, onClick = onAttach)
            BasicTextField(
                value, onValue, Modifier.weight(1f).padding(vertical = 8.dp)
                    .semantics { contentDescription = inputLabel },
                enabled = inputEnabled,
                textStyle = ensoText(16, 22).copy(color = c.ink), maxLines = 5,
                cursorBrush = Brush.verticalGradient(listOf(c.ink, c.ink)),
                decorationBox = { input ->
                    Box {
                        if (value.isEmpty()) androidx.compose.material3.Text(placeholder,
                            color = c.dim, style = ensoText(16, 22), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        input()
                    }
                },
            )
            GlyphButton(EnsoIcon.Mic, "语音输入（尚未接入）", 36.dp, 22.dp)
        }
        GlyphButton(if (running) EnsoIcon.Stop else EnsoIcon.ArrowUp, if (running) "停止" else "发送", 48.dp, 22.dp,
            Modifier.background(c.pill.copy(alpha = if (dimAction) .35f else 1f), CircleShape), c.pillInk, onAction)
    }
}
