package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopProvider
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SessionModelSheet(
    providers: List<DesktopProvider>?, providerId: String?, modelId: String?, running: Boolean, enabled: Boolean,
    status: String?, onDismiss: () -> Unit, onSelect: (String, String) -> Unit,
    reasoningEnabled: Boolean? = null, thinkingLevel: TaskThinkingLevel? = null,
    onReasoning: ((Boolean) -> Unit)? = null, onThinking: ((TaskThinkingLevel) -> Unit)? = null,
) {
    val c = Enso.colors
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.page, contentColor = c.ink, shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
            Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Label("会话模型与思考", 17, 22, Modifier.weight(1f), weight = FontWeight.SemiBold)
                GlyphButton(EnsoIcon.Close, "关闭模型选择", 40.dp, 20.dp, tint = c.dim, onClick = onDismiss)
            }
            if (running || status != null) Label(status ?: "更改设置不会中断正在进行的回复。", 13, 18,
                Modifier.padding(start = 24.dp, end = 24.dp, bottom = 12.dp), color = c.dim)
            ModelChoices(providers, providerId, modelId, enabled, onSelect)
            Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 20.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Label("思考", 14, 20, Modifier.weight(1f), weight = FontWeight.Medium)
                Label(when (reasoningEnabled) {
                    true -> "已开启"
                    false -> "已关闭"
                    null -> "桌面未指定"
                }, 12, 18, color = c.dim)
            }
            Row(Modifier.padding(horizontal = 12.dp).fillMaxWidth().clip(CircleShape).background(c.card).padding(4.dp).selectableGroup(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(false, true).forEach { value ->
                    val label = if (value) "开启" else "关闭"
                    ThinkingChoice(label, "${label}思考", reasoningEnabled == value, enabled && onReasoning != null) {
                        if (value != reasoningEnabled) onReasoning?.invoke(value)
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Label("思考深度", 14, 20, Modifier.weight(1f), weight = FontWeight.Medium)
                Label(thinkingLevel?.title() ?: "桌面未指定", 12, 18, color = c.dim)
            }
            Column(Modifier.selectableGroup()) {
                TaskThinkingLevel.entries.chunked(3).forEach { levels ->
                    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        levels.forEach { level ->
                            val title = level.title()
                            ThinkingChoice(title, "思考深度：$title", thinkingLevel == level,
                                enabled && reasoningEnabled == true && onThinking != null) {
                                if (level != thinkingLevel) onThinking?.invoke(level)
                            }
                        }
                    }
                }
            }
            Label(if (reasoningEnabled == true) "档位支持以电脑端模型为准。" else "开启思考后可选择深度。", 12, 18,
                Modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp), color = c.dim)
        }
    }
}

@Composable
private fun RowScope.ThinkingChoice(title: String, label: String, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Enso.colors
    Row(Modifier.weight(1f).height(40.dp).clip(CircleShape)
        .background(if (selected) c.pill else c.card)
        .semantics { contentDescription = label }
        .selectable(selected, enabled, Role.RadioButton, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        Label(title, 14, 20, color = when {
            selected -> c.pillInk
            !enabled -> c.dim
            else -> c.ink2
        }, weight = FontWeight.Medium)
    }
}
