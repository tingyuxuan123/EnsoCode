package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.R
import io.github.tingyuxuan123.eaves.mirror.DesktopCompaction
import io.github.tingyuxuan123.eaves.mirror.DesktopContextUsage
import io.github.tingyuxuan123.eaves.mirror.DesktopGoal
import io.github.tingyuxuan123.eaves.mirror.DesktopGoalAttempt
import io.github.tingyuxuan123.eaves.mirror.DesktopMaintenanceAttempt
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewAction
import io.github.tingyuxuan123.eaves.mirror.DesktopPreviewInput
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.DesktopRewindAttempt
import io.github.tingyuxuan123.eaves.mirror.DesktopTaskStopAttempt
import io.github.tingyuxuan123.eaves.mirror.DesktopUsageTotals
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.MaintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.SessionMaintenanceCommand
import io.github.tingyuxuan123.eaves.mirror.RewindBaseline
import io.github.tingyuxuan123.eaves.mirror.SessionTaskKind
import io.github.tingyuxuan123.eaves.mirror.TaskStopBaseline
import io.github.tingyuxuan123.eaves.mirror.taskStopBaseline
import io.github.tingyuxuan123.eaves.mirror.sessionGoalText
import io.github.tingyuxuan123.eaves.mirror.maintenanceBaseline
import io.github.tingyuxuan123.eaves.mirror.rewindBaseline

internal enum class SessionSurface { Menu, GoalDetails, GoalEditor, Compact, Rewind, Tasks, Files, Preview }
internal data class GoalEditor(val expected: DesktopGoal?, val draft: String, val afterAttempt: Long)
internal data class RewindChoice(val userIndexFromEnd: Long, val restoreFiles: Boolean)

/** Screen-local drafts only. Never saved to a Bundle or used as the displayed goal. */
internal class SessionPanels {
    var surface by mutableStateOf<SessionSurface?>(null)
    var editor by mutableStateOf<GoalEditor?>(null)
    var clearing by mutableStateOf<DesktopGoal?>(null)
    var compactText by mutableStateOf<String?>(null)
    var rewind by mutableStateOf<RewindChoice?>(null)
    var stopTarget by mutableStateOf<Pair<SessionTaskKind, String>?>(null)
    var openedFile by mutableStateOf<String?>(null)
    var previewText by mutableStateOf("")
}

internal fun DesktopSessionState.goalLaunchWaiting() = goalAttempt?.let {
    it.phase == SessionCommandPhase.Waiting && (it.command == GoalCommand.Set || it.command == GoalCommand.Resume)
} == true

internal fun DesktopSessionState.maintenanceWaiting() =
    maintenance?.phase == SessionCommandPhase.Waiting

/** A goal or maintenance write in flight excludes composer and queue writes. */
internal fun DesktopSessionState.backgroundWorkWaiting() =
    textAttempt?.phase == SessionCommandPhase.Waiting || queueAttempt?.phase == SessionCommandPhase.Waiting ||
        goalLaunchWaiting() || maintenanceWaiting()

internal fun goalNotice(attempt: DesktopGoalAttempt?, editorOpen: Boolean = false): String? = when (attempt?.phase) {
    SessionCommandPhase.Waiting -> "正在等待桌面更新目标…"
    SessionCommandPhase.Unconfirmed -> "目标操作未确认，请先检查桌面。" + if (editorOpen) "草稿已保留。" else ""
    SessionCommandPhase.Rejected -> "桌面拒绝了目标操作。"
    else -> null
}

internal fun maintenanceNotice(attempt: DesktopMaintenanceAttempt?, compaction: DesktopCompaction?): String? {
    if (compaction?.error != null && compaction.state == "end") return "压缩失败：${compaction.error}"
    return when (attempt?.phase) {
        SessionCommandPhase.Waiting -> if (attempt.command == SessionMaintenanceCommand.Retry)
            "正在等待桌面开始新一轮…" else "正在等待桌面压缩上下文…"
        SessionCommandPhase.Unconfirmed -> "操作未确认，请先检查桌面。"
        SessionCommandPhase.Rejected -> if (attempt.command == SessionMaintenanceCommand.Retry)
            "桌面拒绝了重试。" else "桌面拒绝了压缩。"
        else -> null
    }
}

internal fun rewindNotice(attempt: DesktopRewindAttempt?): String? = when {
    attempt == null -> null
    attempt.phase == SessionCommandPhase.Waiting -> "正在等待桌面回退…"
    attempt.phase == SessionCommandPhase.Unconfirmed -> "回退未确认，请先检查桌面时间线。"
    attempt.phase == SessionCommandPhase.Rejected -> "桌面拒绝了回退。"
    attempt.phase == SessionCommandPhase.Observed && attempt.filesRestored == true -> "已回退，文件也已恢复到该检查点。"
    attempt.phase == SessionCommandPhase.Observed && attempt.filesRestored == false -> "已回退；桌面没有可用快照，文件未恢复。"
    attempt.phase == SessionCommandPhase.Observed && attempt.restoreFiles -> "已回退，等待桌面恢复文件…"
    attempt.phase == SessionCommandPhase.Observed -> "已回退。"
    else -> null
}

internal fun taskStopNotice(attempt: DesktopTaskStopAttempt?): String? = when (attempt?.phase) {
    SessionCommandPhase.Waiting -> "正在等待桌面停止…"
    SessionCommandPhase.Unconfirmed -> "停止未确认，请检查桌面。"
    SessionCommandPhase.Rejected -> "桌面拒绝了停止。"
    else -> null
}

@Composable
internal fun SessionGoalBar(goal: DesktopGoal, fresh: Boolean, open: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 4.dp).fillMaxWidth()
        .heightIn(min = 44.dp).glass().semantics { contentDescription = "查看目标" }
        .clickable(role = Role.Button, onClick = open).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Glyph(goal.icon(), Modifier.size(16.dp), if (fresh) goal.tint() else c.dim)
        Label(goal.text, 14, 20, Modifier.weight(1f), weight = FontWeight.Medium, maxLines = 1)
        Label(when {
            !fresh -> "未同步"
            goal.status == "active" && goal.autoTurns > 0 -> "第 ${goal.autoTurns} 轮"
            else -> goal.label()
        }, 13, 18, color = c.dim, maxLines = 1)
    }
}

/** Native bottom sheets for the session menu: usage, goal, retry and context compaction. */
@Composable
internal fun SessionMenuPanels(
    panels: SessionPanels, state: DesktopSessionState?, writable: Boolean, readOnly: Boolean,
    onGoal: ((GoalCommand, DesktopGoal?, String?) -> Unit)?,
    onMaintain: ((SessionMaintenanceCommand, MaintenanceBaseline, String?) -> Unit)?,
    onRewind: ((Long, Boolean, RewindBaseline) -> Unit)? = null,
    onStopTask: ((SessionTaskKind, String, TaskStopBaseline) -> Unit)? = null,
    onListFiles: (() -> Unit)? = null,
    onReadFile: ((String, Long) -> Unit)? = null,
    onListPreviews: (() -> Unit)? = null,
    onOpenPreview: ((String, Int, Int) -> Unit)? = null,
    onPreviewAction: ((DesktopPreviewAction) -> Unit)? = null,
    onPreviewInput: ((DesktopPreviewInput) -> Unit)? = null,
) {
    val c = Enso.colors
    val goal = state?.goal
    val ready = state?.goalReady == true
    val goalAttempt = state?.goalAttempt
    val attempt = state?.maintenance
    val compaction = state?.compaction
    val busy = state?.maintenanceWaiting() == true
    val keyboard = LocalSoftwareKeyboardController.current
    val editable = writable && ready && onGoal != null && goalAttempt?.phase != SessionCommandPhase.Waiting
    val canLaunch = editable && !state.backgroundWorkWaitingWithoutGoal()
    val canRetry = writable && onMaintain != null && state != null && !busy &&
        state.textAttempt?.phase != SessionCommandPhase.Waiting &&
        state.queueAttempt?.phase != SessionCommandPhase.Waiting && !state.goalLaunchWaiting() &&
        state.stopPhase != SessionCommandPhase.Waiting && !state.running &&
        state.canPrompt && state.maintenanceBaseline != null
    val canCompact = writable && onMaintain != null && state != null && !busy &&
        state.textAttempt?.phase != SessionCommandPhase.Waiting &&
        state.queueAttempt?.phase != SessionCommandPhase.Waiting && !state.goalLaunchWaiting() &&
        state.maintenanceBaseline != null
    val rewindAttempt = state?.rewind
    val canRewind = writable && onRewind != null && state != null && !busy && !state.running &&
        state.textAttempt?.phase != SessionCommandPhase.Waiting &&
        state.queueAttempt?.phase != SessionCommandPhase.Waiting && !state.goalLaunchWaiting() &&
        state.rewind?.phase != SessionCommandPhase.Waiting && state.rewindBaseline != null
    val stopAttempt = state?.taskStop
    val busyStop = stopAttempt?.phase == SessionCommandPhase.Waiting
    fun canStop(kind: SessionTaskKind, id: String): Boolean {
        if (!writable || onStopTask == null || state == null || busyStop) return false
        if (state.textAttempt?.phase == SessionCommandPhase.Waiting || state.queueAttempt?.phase == SessionCommandPhase.Waiting ||
            state.goalLaunchWaiting() || state.maintenanceWaiting() ||
            state.rewind?.phase == SessionCommandPhase.Waiting || busy) return false
        return state.taskStopBaseline(kind)?.runningIds?.contains(id) == true
    }

    fun dismiss() {
        panels.surface = null; panels.clearing = null; panels.compactText = null; panels.rewind = null
        panels.stopTarget = null
        panels.openedFile = null
        panels.previewText = ""
    }
    fun edit() {
        if (panels.editor?.expected != goal || panels.editor == null) {
            panels.editor = GoalEditor(goal, goal?.text.orEmpty(), goalAttempt?.id ?: 0L)
        }
        panels.surface = SessionSurface.GoalEditor
    }
    LaunchedEffect(goalAttempt?.id, goalAttempt?.phase) {
        val editor = panels.editor ?: return@LaunchedEffect
        if (goalAttempt != null && goalAttempt.id > editor.afterAttempt &&
            goalAttempt.phase == SessionCommandPhase.Observed && goalAttempt.command == GoalCommand.Set &&
            goalAttempt.text == sessionGoalText(editor.draft)) {
            panels.editor = null
            if (panels.surface == SessionSurface.GoalEditor) panels.surface = SessionSurface.GoalDetails
        }
    }
    LaunchedEffect(attempt?.id, attempt?.phase) {
        if (attempt?.command == SessionMaintenanceCommand.Compact && attempt.phase == SessionCommandPhase.Observed &&
            panels.surface == SessionSurface.Compact) panels.compactText = null
        if (attempt?.phase == SessionCommandPhase.Observed && panels.surface == SessionSurface.Compact) {
            panels.compactText = null
        }
    }

    val availability = when {
        readOnly -> "这是只读连接，可查看，不能修改。"
        !writable -> "会话尚未同步完成，暂不可操作。"
        busy && state.maintenance?.command == SessionMaintenanceCommand.Compact -> "正在等待上一次压缩确认。"
        busy -> "正在等待上一次重试确认。"
        else -> null
    }
    val surface = panels.surface ?: return
    val editor = panels.editor
    SessionSheet(when (surface) {
        SessionSurface.Menu -> "会话菜单"
        SessionSurface.GoalDetails -> "目标"
        SessionSurface.GoalEditor -> if (editor?.expected != null) "改目标" else "设定目标"
        SessionSurface.Compact -> "压缩上下文"
        SessionSurface.Rewind -> "回退到这条消息之前"
        SessionSurface.Tasks -> "后台与协作"
        SessionSurface.Files -> "产物与文件"
        SessionSurface.Preview -> "网页预览"
    }, aside = goal.takeIf { surface == SessionSurface.GoalDetails && ready }, onDismiss = ::dismiss) {
        when (surface) {
            SessionSurface.Menu -> {
                UsageSummary(state?.context, state?.usage, compaction)
                MenuRow(EnsoIcon.Target, if (goal == null) "设定目标" else "查看目标",
                    if (goal == null) "让它自己推进到达成" else goal.label(), goal != null || editable) {
                    if (goal != null) panels.surface = SessionSurface.GoalDetails else edit()
                }
                MenuRow(EnsoIcon.Retry, "重试上一轮", if (canRetry) "从当前上下文继续" else "空闲时可重试", canRetry) {
                    state?.maintenanceBaseline?.let { onMaintain?.invoke(SessionMaintenanceCommand.Retry, it, null) }
                }
                MenuRow(EnsoIcon.Compress, "压缩上下文",
                    if (canCompact) "前面的对话总结成摘要" else "暂不可压缩", canCompact) {
                    panels.compactText = ""
                    panels.surface = SessionSurface.Compact
                }
                val subagents = state?.timeline?.subagents.orEmpty()
                val tasks = state?.timeline?.backgroundTasks.orEmpty()
                MenuRow(EnsoIcon.Layers, "后台与协作",
                    if (subagents.isEmpty() && tasks.isEmpty()) "当前没有子代理或后台任务"
                    else "${subagents.size} 个子代理 · ${tasks.size} 个后台任务",
                    subagents.isNotEmpty() || tasks.isNotEmpty()) {
                    panels.surface = SessionSurface.Tasks
                }
                MenuRow(EnsoIcon.Files, "产物与文件",
                    state?.files?.entries?.size?.let { "$it 个文件" } ?: "浏览当前会话的产出", onListFiles != null) {
                    panels.openedFile = null
                    panels.surface = SessionSurface.Files
                }
                MenuRow(EnsoIcon.Globe, "网页预览",
                    state?.preview?.frame?.title ?: "电脑上的页面串流到这里",
                    onListPreviews != null || onOpenPreview != null) {
                    panels.surface = SessionSurface.Preview
                }
                MenuRow(EnsoIcon.Rewind, "回退到某条消息",
                    if (canRewind) "可同时恢复文件" else "空闲时可回退", canRewind) {
                    panels.rewind = RewindChoice(0, false)
                    panels.surface = SessionSurface.Rewind
                }
                if (goal != null) MenuRow(EnsoIcon.Target, "暂停 / 继续 / 清除", "在目标详情里操作", editable) {
                    panels.surface = SessionSurface.GoalDetails
                }
            }
            SessionSurface.GoalEditor -> if (editor != null) {
                val normalized = sessionGoalText(editor.draft)
                val unchanged = goal == editor.expected
                Label("写清楚什么算完成。它每轮结束会对照检查，没达成就自己接着做，直到达成、卡住或你暂停。",
                    14, 20, Modifier.padding(horizontal = 24.dp), color = c.ink2)
                val shape = RoundedCornerShape(20.dp)
                BasicTextField(editor.draft, { panels.editor = editor.copy(draft = it.take(SESSION_TEXT_LIMIT + 1)) },
                    Modifier.padding(start = 12.dp, end = 12.dp, top = 16.dp).fillMaxWidth().heightIn(min = 120.dp)
                        .background(c.card, shape).border(1.5.dp, c.ink, shape).padding(horizontal = 16.dp, vertical = 14.dp)
                        .semantics { contentDescription = "目标完成条件" },
                    readOnly = busy, textStyle = ensoText(17, 26).copy(color = c.ink), cursorBrush = SolidColor(c.ink),
                    maxLines = 6, decorationBox = { field -> Box {
                        if (editor.draft.isEmpty()) Label("输入完成条件", 17, 26, color = c.dim)
                        field()
                    } })
                FlowRow(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (idea in listOf("相关测试全部通过", "CI 变绿", "改完并提交，不推送")) {
                        Box(Modifier.heightIn(min = 36.dp).clip(CircleShape).background(c.card2)
                            .clickable(!busy, role = Role.Button) { panels.editor = editor.copy(draft = idea) }
                            .padding(horizontal = 14.dp, vertical = 8.dp)) { Label(idea, 14, 20, color = c.ink2) }
                    }
                }
                if (editor.draft.length > SESSION_TEXT_LIMIT) SheetHint("目标过长，请缩短后再开始。")
                if (ready && !unchanged) SheetHint("目标已在桌面变化，请关闭后重新打开。")
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Glyph(EnsoIcon.ShieldCheck, Modifier.size(16.dp), c.dim)
                        Label("审批设置不变", 13, 18, color = c.dim)
                    }
                    SheetButton("开始", EnsoIcon.Target, canLaunch && unchanged && normalized != null && normalized != goal?.text,
                        primary = true) {
                        keyboard?.hide()
                        onGoal?.invoke(GoalCommand.Set, editor.expected, normalized)
                    }
                }
            }
            SessionSurface.GoalDetails -> if (goal != null) {
                val note = goal.note
                Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Label(goal.text, 22, 30, weight = FontWeight.SemiBold)
                    Label("已自动推进 ${goal.autoTurns} 轮", 13, 18, color = c.dim)
                }
                if (note != null || goal.status == "paused") Column(Modifier.padding(start = 12.dp, end = 12.dp, top = 16.dp)
                    .fillMaxWidth().background(c.card, RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (note != null) {
                        Label(if (goal.status == "paused") "暂停时它的判断" else "它现在的判断", 12, 16, color = c.dim, weight = FontWeight.Medium)
                        Label(note, 15, 22)
                    }
                    if (goal.status == "paused") Label("暂停期间它不会自己推进；你发的消息照常处理。", 13, 18, color = c.dim)
                }
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (goal.status == "active") SheetButton("暂停", EnsoIcon.Pause, editable, Modifier.weight(1f)) {
                        onGoal?.invoke(GoalCommand.Pause, goal, null)
                    } else if (goal.status != "completed") SheetButton("继续", EnsoIcon.Play, canLaunch, Modifier.weight(1f), primary = true) {
                        onGoal?.invoke(GoalCommand.Resume, goal, null)
                    }
                    SheetButton("改目标", EnsoIcon.Pencil, editable, Modifier.weight(1f), onClick = ::edit)
                }
                Box(Modifier.padding(top = 8.dp).fillMaxWidth().heightIn(min = 44.dp).clickable(editable, role = Role.Button) {
                    panels.clearing = goal
                }, contentAlignment = Alignment.Center) {
                    Label("清除目标", 15, 20, color = if (editable) c.red else c.dim, weight = FontWeight.Medium)
                }
            } else if (ready) {
                SheetHint("当前会话没有目标。")
                SheetButton("设定目标", EnsoIcon.Target, editable, Modifier.padding(horizontal = 16.dp), primary = true, onClick = ::edit)
            }
            SessionSurface.Compact -> {
                val text = panels.compactText ?: ""
                Label("把前面的对话总结成摘要，为后续轮次腾出上下文。正在运行时由桌面排队，本轮结束后执行。",
                    14, 20, Modifier.padding(horizontal = 24.dp), color = c.ink2)
                val shape = RoundedCornerShape(20.dp)
                BasicTextField(text, { panels.compactText = it.take(COMPACT_TEXT_LIMIT + 1) },
                    Modifier.padding(start = 12.dp, end = 12.dp, top = 14.dp).fillMaxWidth().heightIn(min = 96.dp)
                        .background(c.card, shape).border(.75.dp, c.line, shape).padding(horizontal = 16.dp, vertical = 14.dp)
                        .semantics { contentDescription = "压缩要求（可选）" },
                    readOnly = busy, textStyle = ensoText(16, 24).copy(color = c.ink), cursorBrush = SolidColor(c.ink),
                    maxLines = 5, decorationBox = { field -> Box {
                        if (text.isEmpty()) Label("可选：只保留测试与结论。留空按桌面默认压缩。", 16, 24, color = c.dim)
                        field()
                    } })
                if (text.length > COMPACT_TEXT_LIMIT) SheetHint("压缩要求过长，请缩短。")
                val normalized = text.trim()
                SheetButton("开始压缩", EnsoIcon.Compress,
                    canCompact && text.length <= COMPACT_TEXT_LIMIT, Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
                    primary = true) {
                    keyboard?.hide()
                    state?.maintenanceBaseline?.let { onMaintain?.invoke(SessionMaintenanceCommand.Compact, it, normalized) }
                }
                compaction?.let { value ->
                    Label(when (value.state) {
                        "queued" -> "桌面已排队，等本轮结束后压缩。"
                        "start" -> "正在压缩上下文…"
                        else -> if (value.error != null) "上一次压缩失败。" else "上一次压缩已完成。"
                    }, 13, 18, Modifier.padding(horizontal = 24.dp, vertical = 4.dp), color = c.dim)
                }
            }
            SessionSurface.Rewind -> {
                val messages = state?.timeline?.messages.orEmpty()
                val candidates = rewindCandidates(messages)
                val choice = panels.rewind ?: RewindChoice(0, false)
                if (candidates.isEmpty()) {
                    SheetHint("当前会话还没有可回退的用户消息。")
                } else {
                    Column(Modifier.padding(start = 12.dp, end = 12.dp).fillMaxWidth().background(c.card, RoundedCornerShape(20.dp))) {
                        candidates.forEachIndexed { position, candidate ->
                            if (position > 0) Hairline()
                            RewindRow(candidate, choice.userIndexFromEnd == candidate.userIndexFromEnd, !busy) {
                                panels.rewind = choice.copy(userIndexFromEnd = candidate.userIndexFromEnd)
                            }
                        }
                    }
                    Row(Modifier.padding(start = 12.dp, end = 12.dp, top = 12.dp).fillMaxWidth()
                        .background(c.card, RoundedCornerShape(20.dp))
                        .clickable(!busy, role = Role.Switch) { panels.rewind = choice.copy(restoreFiles = !choice.restoreFiles) }
                        .padding(horizontal = 16.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Label("同时恢复文件", 15, 20, weight = FontWeight.Medium)
                            Label("把工作树恢复到这条消息之前；桌面没有快照时会如实说明未恢复。", 12, 16, color = c.dim)
                        }
                        Row(Modifier.size(48.dp, 28.dp).clip(CircleShape)
                            .background(if (choice.restoreFiles) c.pill else c.card2)
                            .padding(2.dp)
                            .semantics { stateDescription = if (choice.restoreFiles) "已开启" else "已关闭" },
                            horizontalArrangement = if (choice.restoreFiles) Arrangement.End else Arrangement.Start) {
                            Box(Modifier.size(24.dp).clip(CircleShape).background(if (choice.restoreFiles) c.pillInk else c.faint))
                        }
                    }
                    Label("这条消息和之后的对话会从会话里移除，桌面上同步生效。", 13, 18,
                        Modifier.padding(horizontal = 24.dp, vertical = 10.dp), color = c.dim)
                    SheetButton(
                        if (choice.restoreFiles) "回退并恢复文件" else "回退到这里", EnsoIcon.Rewind,
                        canRewind && state?.rewind?.phase != SessionCommandPhase.Waiting && candidates.isNotEmpty(),
                        Modifier.padding(horizontal = 16.dp), primary = true,
                    ) {
                        keyboard?.hide()
                        state?.rewindBaseline?.let { onRewind?.invoke(choice.userIndexFromEnd, choice.restoreFiles, it) }
                    }
                }
            }
            SessionSurface.Tasks -> {
                val subagents = state?.timeline?.subagents.orEmpty()
                val tasks = state?.timeline?.backgroundTasks.orEmpty()
                if (subagents.isEmpty() && tasks.isEmpty()) SheetHint("当前会话没有子代理或后台任务。")
                if (subagents.isNotEmpty()) {
                    Label("子代理", 13, 18, Modifier.padding(start = 24.dp, end = 24.dp, top = 6.dp, bottom = 6.dp),
                        color = c.dim, weight = FontWeight.Medium)
                    Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().background(c.card, RoundedCornerShape(20.dp))) {
                        subagents.forEachIndexed { index, agent ->
                            if (index > 0) Hairline()
                            TaskRow(agent.description,
                                listOfNotNull(agent.statusText(), if (agent.steps > 0) "${agent.steps} 步" else null,
                                    agent.currentActivity.takeIf { it.isNotBlank() }).joinToString(" · "),
                                agent.status == "running", canStop(SessionTaskKind.Subagent, agent.id)) {
                                panels.stopTarget = SessionTaskKind.Subagent to agent.id
                            }
                        }
                    }
                }
                if (tasks.isNotEmpty()) {
                    Label("后台任务", 13, 18, Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp, bottom = 6.dp),
                        color = c.dim, weight = FontWeight.Medium)
                    Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().background(c.card, RoundedCornerShape(20.dp))) {
                        tasks.forEachIndexed { index, task ->
                            if (index > 0) Hairline()
                            TaskRow(task.command,
                                listOfNotNull(task.statusText(),
                                    task.tail.lineSequence().lastOrNull { it.isNotBlank() }?.take(80)).joinToString(" · "),
                                task.status == "running", canStop(SessionTaskKind.Background, task.taskId)) {
                                panels.stopTarget = SessionTaskKind.Background to task.taskId
                            }
                        }
                    }
                    SheetHint("停止只发给桌面一次；手机不会自行杀死任务，也不会重发。")
                }
            }
            SessionSurface.Files -> SessionFilesContent(panels, state?.files, onListFiles, onReadFile)
            SessionSurface.Preview -> SessionPreviewContent(panels, state?.preview,
                onListPreviews, onOpenPreview, onPreviewAction, onPreviewInput)
        }
        availability?.let { SheetHint(it) }
        if (surface == SessionSurface.Menu) maintenanceNotice(attempt, compaction)?.let { SheetHint(it) }
        if (surface == SessionSurface.Menu) rewindNotice(rewindAttempt)?.let { SheetHint(it) }
        if (surface == SessionSurface.Menu) taskStopNotice(stopAttempt)?.let { SheetHint(it) }
        goalNotice(goalAttempt, surface == SessionSurface.GoalEditor)?.let { SheetHint(it) }
    }
    val target = panels.clearing
    if (target != null && surface == SessionSurface.GoalDetails) AlertDialog(onDismissRequest = { panels.clearing = null },
        title = { Text("清除目标？") }, text = { Text(if (target == goal) "停止自动推进，不会中断当前轮或删除会话消息。"
            else "目标已在桌面变化，请关闭后重新确认。") },
        confirmButton = { TextButton(enabled = editable && target == goal, onClick = {
            panels.clearing = null
            onGoal?.invoke(GoalCommand.Clear, target, null)
        }) { Text("确认清除") } }, dismissButton = { TextButton(onClick = { panels.clearing = null }) { Text("取消") } })
    val stopping = panels.stopTarget
    if (stopping != null && surface == SessionSurface.Tasks) {
        val (kind, id) = stopping
        val allowed = canStop(kind, id)
        AlertDialog(onDismissRequest = { panels.stopTarget = null },
            title = { Text(if (kind == SessionTaskKind.Subagent) "停止这个子代理？" else "停止这个后台任务？") },
            text = { Text(if (allowed) "只向桌面发送一次停止请求，手机不会自行终止进程。"
                else "任务状态已变化，请关闭后重新打开。") },
            confirmButton = { TextButton(enabled = allowed, onClick = {
                panels.stopTarget = null
                state?.taskStopBaseline(kind)?.let { onStopTask?.invoke(kind, id, it) }
            }) { Text("确认停止") } },
            dismissButton = { TextButton(onClick = { panels.stopTarget = null }) { Text("取消") } })
    }
}

private const val COMPACT_TEXT_LIMIT = 8_000

@Composable
private fun RewindRow(candidate: RewindCandidate, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().testTag("rewind-${candidate.userIndexFromEnd}")
        .selectable(selected, enabled, Role.RadioButton, onClick = onClick)
        .padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(20.dp).clip(CircleShape)
            .background(if (selected) c.pill else Color.Transparent)
            .border(if (selected) 0.dp else 1.5.dp, c.faint, CircleShape),
            contentAlignment = Alignment.Center) {
            if (selected) Glyph(EnsoIcon.Check, Modifier.size(14.dp), c.pillInk)
        }
        Column(Modifier.weight(1f)) {
            Label(candidate.preview, 15, 22, maxLines = 2)
            candidate.timestamp?.let { stamp ->
                Label(java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date(stamp)),
                    12, 16, Modifier.padding(top = 2.dp), color = c.dim)
            }
        }
    }
}

@Composable
private fun TaskRow(title: String, detail: String, running: Boolean, canStop: Boolean, onStop: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        StatusGlyph(if (running) TaskStatus.Running else TaskStatus.Done, Modifier)
        Column(Modifier.weight(1f)) {
            Label(title, 15, 20, weight = FontWeight.Medium, maxLines = 1)
            if (detail.isNotBlank()) Label(detail, 12, 16, color = c.dim, maxLines = 2)
        }
        if (running) Box(Modifier.heightIn(min = 32.dp).clip(CircleShape).background(c.card2)
            .semantics { contentDescription = "停止 $title" }
            .clickable(canStop, role = Role.Button, onClick = onStop).padding(horizontal = 12.dp, vertical = 6.dp)) {
            Label("停止", 13, 18, color = if (canStop) c.red else c.dim, weight = FontWeight.Medium)
        }
    }
}

private fun io.github.tingyuxuan123.eaves.pair.SessionSubagent.statusText() = when (status) {
    "running" -> "进行中"
    "done" -> "已完成"
    else -> "失败"
}

private fun io.github.tingyuxuan123.eaves.pair.SessionBackgroundTask.statusText() = when (status) {
    "running" -> "进行中"
    "done" -> "已完成"
    else -> "失败"
}

private fun DesktopSessionState.backgroundWorkWaitingWithoutGoal() =
    textAttempt?.phase == SessionCommandPhase.Waiting || queueAttempt?.phase == SessionCommandPhase.Waiting ||
        maintenanceWaiting()

@Composable
private fun UsageSummary(context: DesktopContextUsage?, usage: DesktopUsageTotals?, compaction: DesktopCompaction?) {
    val c = Enso.colors
    val percent = context?.let { contextPercent(it.used, it.window) }
    Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 6.dp).fillMaxWidth()
        .background(c.card, RoundedCornerShape(20.dp)).padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (context == null && usage == null) {
            Label("桌面尚未同步上下文用量。", 13, 18, color = c.dim)
            return@Column
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Label("上下文", 13, 18, color = c.dim, weight = FontWeight.Medium)
            Label(context?.let {
                "${tokenCount(it.used)} / ${it.window?.let(::tokenCount) ?: "未知窗口"}"
            } ?: "未知", 13, 18, Modifier.weight(1f), color = c.dim)
            if (percent != null) Label("$percent%", 13, 18, color = c.dim)
        }
        if (percent != null) Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(c.card2)) {
            Box(Modifier.fillMaxWidth(percent / 100f).height(6.dp).clip(CircleShape)
                .background(if (percent >= 90) c.red else c.ink))
        }
        if (usage != null) Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
            Column {
                Label("总用量", 12, 16, color = c.dim)
                Label(tokenCount(usage.inputTokens + usage.outputTokens), 17, 24, weight = FontWeight.SemiBold)
            }
            Column {
                Label("输入 / 输出", 12, 16, color = c.dim)
                Label("${tokenCount(usage.inputTokens)} / ${tokenCount(usage.outputTokens)}", 17, 24, weight = FontWeight.SemiBold)
            }
            if (usage.cacheHitPercent != null) Column {
                Label("缓存命中", 12, 16, color = c.dim)
                Label("${usage.cacheHitPercent}%", 17, 24, weight = FontWeight.SemiBold)
            }
        }
        compaction?.let {
            Label(when (it.state) {
                "queued" -> "压缩已排队"
                "start" -> "正在压缩…"
                else -> if (it.error != null) "上次压缩失败" else "上次压缩已完成"
            }, 12, 16, color = if (it.error != null) c.red else c.dim)
        }
    }
}

@Composable
private fun MenuRow(icon: EnsoIcon, title: String, detail: String, enabled: Boolean, onClick: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().clickable(enabled, role = Role.Button, onClick = onClick)
        .padding(horizontal = 24.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Glyph(icon, Modifier.size(22.dp), if (enabled) c.ink else c.dim)
        Label(title, 16, 22, Modifier.weight(1f, fill = false), color = if (enabled) c.ink else c.dim, weight = FontWeight.Medium)
        Label(detail, 13, 18, Modifier.weight(1f), color = c.dim, maxLines = 1)
        Glyph(EnsoIcon.Right, Modifier.size(16.dp), c.faint)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionSheet(title: String, aside: DesktopGoal?, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val c = Enso.colors
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.page, contentColor = c.ink, scrimColor = Color.Black.copy(alpha = .35f),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), dragHandle = {
            Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 4.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(36.dp, 4.dp).background(c.faint.copy(alpha = .6f), CircleShape))
            }
        }) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 12.dp)) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, bottom = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Label(title, 17, 22, Modifier.weight(1f), weight = FontWeight.SemiBold)
                if (aside != null) Row(Modifier.background(if (aside.status == "paused") c.card2 else aside.tint().copy(alpha = .10f), CircleShape)
                    .padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (aside.status == "active") Image(painterResource(R.drawable.eaves_running_small), null, Modifier.size(14.dp))
                    else Glyph(aside.icon(), Modifier.size(14.dp), aside.tint())
                    Label(aside.label(), 13, 18, color = aside.tint(), weight = FontWeight.Medium)
                }
                GlyphButton(EnsoIcon.Close, "关闭面板", 40.dp, 20.dp, tint = c.dim, onClick = onDismiss)
            }
            content()
        }
    }
}

@Composable
internal fun SheetHint(text: String) = Label(text, 13, 18,
    Modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 4.dp), color = Enso.colors.dim)

@Composable
private fun SheetButton(title: String, icon: EnsoIcon, enabled: Boolean, modifier: Modifier = Modifier,
    primary: Boolean = false, onClick: () -> Unit) {
    val c = Enso.colors
    val tint = if (!enabled) c.dim else if (primary) c.pillInk else c.ink
    Row(modifier.heightIn(min = 52.dp).glass(inverted = enabled && primary, opacity = if (enabled) 1f else .55f)
        .clickable(enabled, role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        Glyph(icon, Modifier.size(20.dp), tint)
        Label(title, 15, 20, color = tint, weight = FontWeight.Medium)
    }
}

private fun DesktopGoal.label() = when (status) {
    "active" -> "进行中"
    "paused" -> "已暂停"
    "waiting" -> "等待处理"
    "blocked" -> "受阻"
    "completed" -> "已完成"
    else -> "未知状态"
}

private fun DesktopGoal.icon() = when (status) {
    "paused" -> EnsoIcon.Pause
    "waiting" -> EnsoIcon.Waiting
    "blocked" -> EnsoIcon.Error
    "completed" -> EnsoIcon.Check
    else -> EnsoIcon.Target
}

@Composable
private fun DesktopGoal.tint(): Color = when (status) {
    "active" -> Enso.colors.blue
    "waiting" -> Enso.colors.yellow
    "blocked" -> Enso.colors.red
    "completed" -> Enso.colors.green
    else -> Enso.colors.ink2
}
