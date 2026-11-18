package io.github.tingyuxuan123.eaves.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.tingyuxuan123.eaves.mirror.CreationPhase
import io.github.tingyuxuan123.eaves.mirror.DesktopCreation

@Composable
internal fun CreationNotice(creation: DesktopCreation?, tooLong: Boolean, onReview: () -> Unit, onUnlock: () -> Unit) {
    val notice = when (creation?.phase) {
        CreationPhase.Creating -> "正在等待桌面创建任务…"
        CreationPhase.Unconfirmed -> "创建结果不明，描述已保留。请先检查任务列表，勿重复创建。"
        CreationPhase.Rejected -> "桌面拒绝创建，描述已保留。"
        CreationPhase.Unavailable -> "配置不可用，请重新选择项目和模型。"
        else -> if (tooLong) "描述过长，请缩短后发送。" else null
    }
    if (notice != null) Label(notice, 13, 18, Modifier.padding(horizontal = 20.dp, vertical = 8.dp), color = Enso.colors.dim)
    if (creation?.phase in setOf(CreationPhase.Unconfirmed, CreationPhase.Rejected, CreationPhase.Unavailable)) {
        TextButton(onClick = onReview) { Text("检查任务列表") }
        TextButton(onClick = onUnlock) { Text("已检查桌面，允许新建") }
    }
}
