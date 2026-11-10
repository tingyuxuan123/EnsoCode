package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@Composable
internal fun HomeScreen(
    state: NewTaskUiState,
    onNew: () -> Unit,
    onPair: () -> Unit,
    onTask: (String) -> Unit,
    onBoard: () -> Unit,
    onMembers: () -> Unit,
    onSettings: () -> Unit,
    onUnavailable: () -> Unit,
) {
    val c = Enso.colors
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf<TaskStatus?>(null) }
    var project by rememberSaveable { mutableStateOf<String?>(null) }
    var statusMenu by rememberSaveable { mutableStateOf(false) }
    var projectMenu by rememberSaveable { mutableStateOf(false) }
    val tasks = visibleTasks(state.tasks, query, status, project)
    Box(Modifier.fillMaxSize().background(c.page)) {
        HomeGlow()
        Column(Modifier.fillMaxSize().designTopInset().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Label("小满", 22, 28, weight = FontWeight.Bold)
                Row(Modifier.padding(start = 8.dp).height(30.dp).clip(CircleShape)
                    .border(.75.dp, c.line, CircleShape).clickable(onClick = onPair)
                    .padding(horizontal = 9.dp).semantics {
                        contentDescription = state.connectionLabel ?: if (state.online) "已连接电脑" else "尚未连接电脑"
                    }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Glyph(EnsoIcon.Laptop, Modifier.size(15.dp))
                    Glyph(if (state.online) EnsoIcon.Check else EnsoIcon.Close, Modifier.size(13.dp),
                        if (state.online) c.green else c.dim)
                }
                Spacer(Modifier.weight(1f))
                GlyphButton(EnsoIcon.Close, "关闭", 48.dp, 20.dp, Modifier.glass(), onClick = onNew)
            }
            LazyColumn(Modifier.weight(1f)) {
                item {
                    Column(Modifier.padding(top = 4.dp, bottom = 8.dp)) {
                        HomeEntry(EnsoIcon.NewTask, "新任务", state.project ?: "", onNew)
                        HomeEntry(EnsoIcon.Board, "任务看板",
                            state.tasks.count { it.status == TaskStatus.Waiting }.let { if (it > 0) "$it 个等你" else "" }, onBoard)
                        HomeEntry(EnsoIcon.Users, "成员",
                            if (state.pendingMemberCount > 0) "${state.pendingMemberCount} 条待处理" else "", onMembers)
                        HomeEntry(EnsoIcon.Scan, "连接电脑", state.computer ?: "尚未配对", onPair)
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Label("任务", 15, 20, Modifier.weight(1f), c.dim, FontWeight.SemiBold)
                        if (state.tasks.isNotEmpty()) Box {
                            GlyphButton(EnsoIcon.Sort, "按状态筛选", 38.dp, 18.dp,
                                Modifier.background(if (status == null) c.card2 else c.pill, CircleShape),
                                if (status == null) c.ink2 else c.pillInk, onClick = { statusMenu = true })
                            DropdownMenu(statusMenu, { statusMenu = false }) {
                                DropdownMenuItem(text = { Label("全部状态", 14, 20) }, onClick = { status = null; statusMenu = false })
                                mapOf(TaskStatus.Waiting to "等你处理", TaskStatus.Running to "运行中",
                                    TaskStatus.Error to "出错", TaskStatus.Done to "已完成", TaskStatus.Idle to "空闲").forEach { (value, title) ->
                                    DropdownMenuItem(text = { Label(title, 14, 20) }, onClick = { status = value; statusMenu = false })
                                }
                            }
                        }
                        if (state.tasks.isNotEmpty()) Box {
                            GlyphButton(EnsoIcon.Folder, "按项目筛选", 38.dp, 18.dp,
                                Modifier.background(if (project == null) c.card2 else c.pill, CircleShape),
                                if (project == null) c.ink2 else c.pillInk, onClick = { projectMenu = true })
                            DropdownMenu(projectMenu, { projectMenu = false }) {
                                DropdownMenuItem(text = { Label("全部项目", 14, 20) }, onClick = { project = null; projectMenu = false })
                                state.tasks.mapNotNull { it.project }.distinct().forEach { name ->
                                    DropdownMenuItem(text = { Label(name, 14, 20) }, onClick = { project = name; projectMenu = false })
                                }
                            }
                        }
                    }
                }
                if (searchOpen) item {
                    Row(Modifier.padding(horizontal = 20.dp, vertical = 8.dp).fillMaxWidth()
                        .background(c.card, Enso.composerShape).padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Glyph(EnsoIcon.Search, Modifier.size(18.dp), c.dim)
                        BasicTextField(query, { query = it }, Modifier.weight(1f).semantics { contentDescription = "搜索任务" },
                            singleLine = true, textStyle = ensoText(16, 22).copy(color = c.ink))
                    }
                }
                if (state.tasks.isEmpty()) item {
                    Column(Modifier.fillMaxWidth().padding(start = 40.dp, end = 40.dp, top = 64.dp),
                        horizontalAlignment = Alignment.CenterHorizontally) {
                        Glyph(EnsoIcon.Inbox, Modifier.size(44.dp), c.dim)
                        Label("还没有任务", 17, 24, Modifier.padding(top = 12.dp), weight = FontWeight.SemiBold)
                        androidx.compose.material3.Text("在手机或电脑上开始一个任务，它的进度、提问和审批都会出现在这里。",
                            Modifier.padding(top = 6.dp), color = c.dim, style = ensoText(14, 20),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        Row(Modifier.padding(top = 24.dp).height(48.dp).glass(inverted = true)
                            .clickable(onClick = onNew).padding(horizontal = 24.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Glyph(EnsoIcon.NewTask, Modifier.size(18.dp), c.pillInk)
                            Label("新任务", 15, 20, color = c.pillInk, weight = FontWeight.Medium)
                        }
                    }
                } else if (tasks.isEmpty()) item {
                    Label("没有符合条件的任务", 15, 22, Modifier.padding(24.dp), color = c.dim)
                }
                items(tasks, key = { it.id }) { task ->
                    Row(Modifier.fillMaxWidth().background(
                        if (task.status == TaskStatus.Waiting) c.yellow.copy(alpha = .09f) else c.page.copy(alpha = 0f)),
                        verticalAlignment = Alignment.CenterVertically) {
                        Row(Modifier.weight(1f).testTag("task-${task.id}").clickable { onTask(task.id) }.padding(start = 20.dp, top = 10.dp, bottom = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (task.pinned) Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) {
                                Glyph(EnsoIcon.Pin, Modifier.size(14.dp), c.yellow)
                            }
                            Column(Modifier.weight(1f)) {
                                Label(task.title, 16, 22, weight = FontWeight.Medium, maxLines = 1)
                                SessionMeta(task.project, task.time)
                            }
                            Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) { StatusGlyph(task.status) }
                        }
                        GlyphButton(EnsoIcon.More, "更多：${task.title}", 48.dp, 24.dp,
                            Modifier.padding(end = 4.dp), c.ink2, onUnavailable)
                    }
                }
                item { Spacer(Modifier.height(128.dp)) }
            }
        }
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(112.dp)
            .background(Brush.verticalGradient(listOf(c.page.copy(alpha = 0f), c.page.copy(alpha = .8f), c.page))))
        Row(Modifier.align(Alignment.BottomEnd).designBottomInset(32.dp).padding(end = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val searchOpacity = if (state.tasks.isEmpty()) .4f else 1f
            GlyphButton(EnsoIcon.Search, "搜索", 56.dp, 24.dp,
                Modifier.glass(opacity = searchOpacity), tint = c.ink.copy(alpha = searchOpacity),
                onClick = if (state.tasks.isEmpty()) null else { { searchOpen = !searchOpen } })
            GlyphButton(EnsoIcon.Settings, "设置", 56.dp, 24.dp, Modifier.glass(), onClick = onSettings)
        }
    }
}

@Composable
private fun HomeEntry(icon: EnsoIcon, title: String, detail: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Glyph(icon, Modifier.size(24.dp))
        Label(title, 16, 22, Modifier.weight(1f), weight = FontWeight.Medium)
        Label(detail, 14, 20, color = Enso.colors.dim, maxLines = 1)
    }
}
