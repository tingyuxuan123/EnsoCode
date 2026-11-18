package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.DesktopBotsState
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.writeBusy

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewBotGroupSheet(bots: DesktopBotsState, writable: Boolean, onDismiss: () -> Unit,
    onCreate: (String, List<String>, String) -> Unit) {
    val c = Enso.colors
    val members = bots.members.filterNot { it.archived }
    var title by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var boss by remember { mutableStateOf<String?>(null) }
    val memberIds = members.mapNotNull { it.id.takeIf(selected::contains) }
    val host = boss?.takeIf(memberIds::contains)
    val attempt = bots.groupCreate
    val waiting = attempt?.phase == SessionCommandPhase.Waiting
    val canEdit = writable && bots.groupCreateEnabled && !bots.writeBusy
    val canCreate = canEdit && title.isNotBlank() && memberIds.size in 2..64 && host != null
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.page, contentColor = c.ink, shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)) {
        LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Label("新群聊", 17, 22, Modifier.weight(1f).padding(start = 4.dp), weight = FontWeight.SemiBold)
                    GlyphButton(EnsoIcon.Close, "关闭新群聊", 40.dp, 20.dp, tint = c.dim, onClick = onDismiss)
                }
                OutlinedTextField(title, { title = it.take(200) }, Modifier.fillMaxWidth(), enabled = canEdit,
                    singleLine = true, label = { Label("群聊名称", 14, 20) }, shape = RoundedCornerShape(16.dp))
                Label("选择至少 2 位成员，并指定主持人。", 13, 18, Modifier.padding(top = 12.dp), color = c.dim)
            }
            items(members, key = { it.id }) { member ->
                val checked = member.id in selected
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.card)
                    .clickable(enabled = canEdit && (checked || selected.size < 64), role = Role.Checkbox) {
                        selected = if (checked) selected - member.id else selected + member.id
                        if (boss !in selected) boss = selected.firstOrNull()
                    }.padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    MemberAvatar(member, 36.dp)
                    Column(Modifier.weight(1f)) {
                        Label(member.name, 15, 20, weight = FontWeight.Medium, maxLines = 1)
                        Label(member.title, 12, 16, color = c.dim, maxLines = 1)
                    }
                    if (checked) Label(if (host == member.id) "主持人" else "设为主持人", 12, 16,
                        Modifier.clip(Enso.pillShape).background(c.card2)
                            .clickable(enabled = canEdit && host != member.id, role = Role.Button) { boss = member.id }
                            .padding(horizontal = 10.dp, vertical = 8.dp), color = c.ink2)
                    if (checked) Glyph(EnsoIcon.Check, Modifier.size(18.dp), c.blue)
                }
            }
            item {
                val label = if (waiting) "正在新建…" else "创建群聊"
                Box(Modifier.fillMaxWidth().heightIn(min = 52.dp).glass(inverted = canCreate)
                    .clickable(enabled = canCreate, role = Role.Button) { if (host != null) onCreate(title, memberIds, host) },
                    contentAlignment = Alignment.Center) {
                    Label(label, 15, 20, color = if (canCreate) c.pillInk else c.dim, weight = FontWeight.Medium)
                }
                when (attempt?.phase) {
                    SessionCommandPhase.Unconfirmed -> SheetHint("未确认群聊是否创建，请先检查电脑再试。")
                    SessionCommandPhase.Rejected -> SheetHint("电脑未能创建群聊，请检查群名与成员。")
                    SessionCommandPhase.Observed -> SheetHint("正在等待群聊目录同步…")
                    else -> Unit
                }
            }
        }
    }
}
