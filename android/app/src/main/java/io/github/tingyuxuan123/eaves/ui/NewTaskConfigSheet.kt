package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopProject
import io.github.tingyuxuan123.eaves.mirror.DesktopProvider
import io.github.tingyuxuan123.eaves.mirror.TaskApprovalMode
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel

/** Native counterpart of frames/new-config.tsx. Choices apply immediately; no fake model/preset list. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewTaskConfigSheet(
    projects: List<DesktopProject>?, providers: List<DesktopProvider>?, config: TaskConfiguration,
    enabled: Boolean, onChange: (TaskConfiguration) -> Unit, onDismiss: () -> Unit,
) {
    val c = Enso.colors
    var projectMenu by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.page, contentColor = c.ink, scrimColor = Color.Black.copy(alpha = .35f),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp), dragHandle = {
            Box(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 4.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(36.dp, 4.dp).background(c.faint.copy(alpha = .6f), CircleShape))
            }
        }) {
        BoxWithConstraints {
            Column(Modifier.heightIn(max = maxHeight * .94f).verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label("新任务设置", 17, 22, Modifier.weight(1f), weight = FontWeight.SemiBold)
                    GlyphButton(EnsoIcon.Close, "关闭新任务设置", 40.dp, 20.dp, tint = c.dim, onClick = onDismiss)
                }
                Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.weight(1f)) {
                        ConfigPill(config.project(projects)?.name ?: "选择项目", EnsoIcon.Folder,
                            enabled && !projects.isNullOrEmpty(), "切换项目") { projectMenu = true }
                        DropdownMenu(expanded = projectMenu, onDismissRequest = { projectMenu = false }, containerColor = c.card) {
                            projects.orEmpty().forEach { project -> DropdownMenuItem(
                                text = { Label(project.name, 14, 20) },
                                onClick = { onChange(config.copy(projectId = project.id)); projectMenu = false }) }
                        }
                    }
                    Box(Modifier.weight(1f)) { ConfigPill("桌面默认预设", EnsoIcon.Sliders, false) {} }
                }
                SheetLabel("模型")
                ModelChoices(providers, config.provider(providers)?.id, config.model(providers)?.id, enabled) { providerId, modelId ->
                    onChange(config.copy(providerId = providerId, modelId = modelId))
                }
                if (projects.isNullOrEmpty()) ConfigNotice(if (projects == null) "正在读取桌面项目…" else "没有可新建任务的本地项目，请先在电脑端添加。")
                if ((config.projectId != null && config.project(projects) == null) ||
                    (config.providerId != null && (config.provider(providers) == null || config.model(providers) == null))) {
                    ConfigNotice("原选项已不可用，请重新选择。")
                }
                Row(Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label("思考强度", 13, 18, Modifier.weight(1f), color = c.dim, weight = FontWeight.Medium)
                    Label("桌面默认", 12, 18,
                        Modifier.clip(CircleShape).clickable(enabled, role = Role.Button) {
                            onChange(config.copy(thinkingLevel = null))
                        }.padding(horizontal = 4.dp, vertical = 4.dp), color = if (config.thinkingLevel == null) c.ink else c.dim)
                }
                Row(Modifier.padding(horizontal = 12.dp).background(c.card2, CircleShape).padding(4.dp)) {
                    TaskThinkingLevel.entries.forEach { level ->
                        val active = config.thinkingLevel == level
                        Box(Modifier.weight(1f).height(36.dp).clip(CircleShape)
                            .background(if (active) c.pill else c.card2)
                            .selectable(active, enabled, Role.RadioButton) { onChange(config.copy(thinkingLevel = level)) },
                            contentAlignment = Alignment.Center) {
                            Label(level.title(), 14, 20, color = if (active) c.pillInk else c.ink2, weight = FontWeight.Medium)
                        }
                    }
                }
                SheetLabel("审批模式")
                ConfigGroup {
                    TaskApprovalMode.entries.forEachIndexed { index, mode ->
                        if (index > 0) Hairline()
                        ConfigOption(mode.title(), mode.detail(), config.approvalMode == mode, enabled) {
                            onChange(config.copy(approvalMode = mode))
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun ModelChoices(
    providers: List<DesktopProvider>?, providerId: String?, modelId: String?, enabled: Boolean,
    onSelect: (String, String) -> Unit,
) {
    val choices = remember(providers) { providers.orEmpty().flatMap { provider -> provider.models.map { provider to it } } }
    Box(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Enso.colors.card)) {
        when {
            providers == null -> ConfigNotice("正在读取桌面模型…")
            choices.isEmpty() -> ConfigNotice("桌面没有可用模型，请先在电脑端添加。")
            else -> LazyColumn(Modifier.heightIn(max = 240.dp)) {
                itemsIndexed(choices) { index, (provider, model) ->
                    if (index > 0) Hairline()
                    ConfigOption(model.label, provider.name,
                        selected = providerId == provider.id && modelId == model.id, enabled = enabled) {
                        onSelect(provider.id, model.id)
                    }
                }
            }
        }
    }
}

@Composable
private fun ConfigPill(text: String, icon: EnsoIcon, enabled: Boolean, label: String? = null, onClick: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().height(44.dp).clip(CircleShape).background(c.card)
        .semantics { if (label != null) contentDescription = label }
        .clickable(enabled, role = Role.Button, onClick = onClick).padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Glyph(icon, Modifier.size(16.dp), if (enabled) c.ink2 else c.dim)
        Label(text, 14, 20, Modifier.weight(1f), color = if (enabled) c.ink else c.dim, weight = FontWeight.Medium, maxLines = 1)
        Glyph(EnsoIcon.Chevrons, Modifier.size(14.dp), if (enabled) c.dim else c.faint)
    }
}

@Composable
private fun ConfigGroup(content: @Composable () -> Unit) {
    Column(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Enso.colors.card)) { content() }
}

@Composable
private fun SheetLabel(text: String) = Label(text, 13, 18,
    Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 8.dp), color = Enso.colors.dim, weight = FontWeight.Medium)

@Composable
private fun ConfigNotice(text: String) = Label(text, 13, 18, Modifier.padding(horizontal = 16.dp, vertical = 12.dp), color = Enso.colors.dim)

@Composable
private fun ConfigOption(title: String, detail: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.fillMaxWidth().selectable(selected, enabled, Role.RadioButton, onClick = onClick)
        .padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Label(title, 15, 20, weight = FontWeight.Medium, maxLines = 1)
            Label(detail, 12, 16, color = c.dim, maxLines = 1)
        }
        if (selected) Glyph(EnsoIcon.Check, Modifier.size(20.dp))
    }
}

internal fun TaskThinkingLevel.title(): String = when (this) {
    TaskThinkingLevel.Minimal -> "最低"
    TaskThinkingLevel.Low -> "低"
    TaskThinkingLevel.Medium -> "中"
    TaskThinkingLevel.High -> "高"
    TaskThinkingLevel.XHigh -> "超高"
    TaskThinkingLevel.Max -> "最大"
}

internal fun TaskApprovalMode.title(): String = when (this) {
    TaskApprovalMode.Supervised -> "全程审批"
    TaskApprovalMode.AutoEdits -> "自动接受编辑"
    TaskApprovalMode.Full -> "完全放行"
    TaskApprovalMode.Assistant -> "助手代审"
}

private fun TaskApprovalMode.detail(): String = when (this) {
    TaskApprovalMode.Supervised -> "每条命令与文件改动都需确认"
    TaskApprovalMode.AutoEdits -> "文件编辑直接执行，命令与 MCP 仍需确认"
    TaskApprovalMode.Full -> "所有操作不经确认直接执行"
    TaskApprovalMode.Assistant -> "由桌面审批助手检查每一步操作"
}
