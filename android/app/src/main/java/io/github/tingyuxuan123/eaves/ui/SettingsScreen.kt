package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.SettingsUiState

/**
 * Device and notification settings: one real computer, the desktop-granted permission, the background watch
 * and one paired device. Nothing here pretends a second device exists or lets the phone change its own access.
 */
@Composable
internal fun SettingsScreen(
    state: SettingsUiState,
    onBack: () -> Unit,
    onReconnect: (() -> Unit)? = null,
    onWatch: (() -> Unit)? = null,
    onNotificationSettings: (() -> Unit)? = null,
    onUnpair: (() -> Unit)? = null,
    onPair: (() -> Unit)? = null,
) {
    val c = Enso.colors
    var confirmUnpair by remember { mutableStateOf(false) }
    if (confirmUnpair) AlertDialog(
        onDismissRequest = { confirmUnpair = false },
        title = { Label(if (state.resetRequired) "清理失效记录？" else "解绑这台手机？", 17, 22) },
        text = {
            Label(if (state.resetRequired) "只清除此手机的失效记录。电脑端的旧授权可以在电脑设置中删除。"
            else "解绑后需要重新扫描电脑上的二维码，未发送的草稿会被清除。", 14, 20)
        },
        confirmButton = {
            TextButton(onClick = { confirmUnpair = false; onUnpair?.invoke() }) {
                Text(if (state.resetRequired) "确认清理" else "确认解绑")
            }
        },
        dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("取消") } },
    )
    Column(Modifier.fillMaxSize().background(c.page).designTopInset().designBottomInset(36.dp).imePadding()) {
        TopBar("设备与通知", EnsoIcon.Back, "返回", onBack)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 40.dp)) {
            SettingLabel("当前连接")
            SettingCard {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Glyph(EnsoIcon.Laptop, Modifier.size(20.dp), c.ink2)
                    Column(Modifier.weight(1f)) {
                        Label(state.computer ?: if (state.paired) "已配对电脑" else "尚未配对", 15, 20,
                            weight = FontWeight.Medium, maxLines = 1)
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (state.paired) Box(Modifier.size(6.dp).clip(CircleShape)
                                .background(if (state.online) c.green else c.dim))
                            Label(if (state.paired) state.connection else "在电脑上生成二维码后配对", 12, 16,
                                color = c.dim, maxLines = 1)
                        }
                    }
                    SettingTextAction(
                        if (state.paired) "重新连接" else "连接电脑",
                        if (state.paired) onReconnect else onPair,
                    )
                }
            }
            SettingLabel("这台手机")
            SettingCard {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Label(when {
                            !state.paired -> "尚未连接"
                            state.readOnly -> "只读"
                            else -> "可操作"
                        }, 15, 20, weight = FontWeight.Medium)
                        Label(when {
                            !state.paired -> "配对后由电脑决定读写权限"
                            state.readOnly -> "只能查看会话，权限由电脑设置"
                            else -> "能发消息、批审批、开新会话"
                        }, 12, 16, color = c.dim)
                    }
                    if (state.paired) Label("电脑设置", 11, 16,
                        Modifier.background(c.card2, CircleShape).padding(horizontal = 10.dp, vertical = 4.dp),
                        color = c.ink2, weight = FontWeight.Medium)
                }
            }
            SettingLabel("通知")
            SettingCard {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f)) {
                        Label("后台提醒", 15, 20, weight = FontWeight.Medium)
                        Label(if (state.watchActive) "保持连接，等审批、任务完成和断线时提醒"
                        else "离开应用后暂停连接，不会自动重连", 12, 16, color = c.dim)
                    }
                    SettingSwitch(state.watchActive, if (state.watchStarting) null else onWatch?.takeIf { state.paired })
                }
                if (!state.notificationsAllowed) {
                    Hairline(Modifier.padding(horizontal = 14.dp))
                    Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Label("系统通知未允许，收不到提醒", 12, 16, Modifier.weight(1f), color = c.red)
                        SettingTextAction("通知设置", onNotificationSettings)
                    }
                }
                if (state.watchFailed) {
                    Hairline(Modifier.padding(horizontal = 14.dp))
                    Label("后台连接未开启，请检查通知权限后重试。", 12, 16,
                        Modifier.padding(horizontal = 14.dp, vertical = 12.dp), color = c.red)
                }
            }
            SettingLabel("已配对设备")
            SettingCard {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Glyph(EnsoIcon.Phone, Modifier.size(20.dp), c.ink2)
                    Column(Modifier.weight(1f)) {
                        Label(state.device ?: "这台手机", 15, 20, weight = FontWeight.Medium, maxLines = 1)
                        Label(if (state.paired) "当前设备 · ${if (state.readOnly) "只读" else "可操作"}" else "当前设备 · 未连接",
                            12, 16, color = c.dim)
                    }
                }
            }
            if (state.paired || state.resetRequired) {
                val action = onUnpair?.takeIf { !state.watchStarting }
                Row(Modifier.fillMaxWidth().padding(top = 24.dp).height(48.dp).clip(CircleShape)
                    .background(c.card).clickable(enabled = action != null, role = Role.Button) {
                        if (action != null) confirmUnpair = true
                    }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                    Label(if (state.resetRequired) "清理失效记录" else "解绑这台手机", 15, 20, color = c.red,
                        weight = FontWeight.Medium)
                }
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun SettingLabel(text: String) {
    Label(text, 12, 16, Modifier.padding(start = 4.dp, top = 20.dp, bottom = 4.dp), color = Enso.colors.dim)
}

@Composable
private fun SettingCard(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().background(Enso.colors.card, RoundedCornerShape(16.dp)), content = content)
}

@Composable
private fun SettingTextAction(title: String, onClick: (() -> Unit)?) {
    Label(title, 13, 20, Modifier.semantics { contentDescription = title }
        .clickable(enabled = onClick != null, role = Role.Button) { onClick?.invoke() }
        .padding(horizontal = 8.dp, vertical = 6.dp), color = if (onClick == null) Enso.colors.faint else Enso.colors.ink2,
        weight = FontWeight.Medium)
}

@Composable
private fun SettingSwitch(checked: Boolean, onChange: ((() -> Unit))?) {
    val c = Enso.colors
    Box(Modifier.size(48.dp, 28.dp).clip(CircleShape)
        .background(if (checked) c.pill else c.card2)
        .toggleable(value = checked, enabled = onChange != null, role = Role.Switch,
            onValueChange = { if (onChange != null) onChange.invoke() })
        .semantics { contentDescription = "后台提醒" }
        .padding(3.dp), contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart) {
        Spacer(Modifier.size(22.dp).clip(CircleShape).background(if (checked) c.pillInk else c.faint))
    }
}
