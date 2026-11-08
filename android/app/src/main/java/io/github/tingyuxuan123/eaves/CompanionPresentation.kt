package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.ui.NewTaskUiState
import io.github.tingyuxuan123.eaves.ui.PairUiState
import io.github.tingyuxuan123.eaves.ui.TaskSummary
import io.github.tingyuxuan123.eaves.ui.TaskStatus
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal fun CompanionState.taskUi(nowMillis: Long): NewTaskUiState {
    val projectNames = link.projects.orEmpty().associate { it.id to it.name }
    return NewTaskUiState(
        online = paired && link.phase == LinkPhase.Online,
        computer = link.hostName ?: if (paired) "已配对电脑" else null,
        composerAvailable = paired && !busy && link.phase == LinkPhase.Online && !link.readOnly,
        connectionLabel = if (!paired) null else if (link.phase == LinkPhase.Online && link.readOnly) "此设备为只读" else phaseLabel(link.phase),
        tasks = link.catalog.filterNot { it.archived }.map { task ->
            val project = task.projectName.takeIf { it.isNotBlank() } ?: projectNames[task.projectId]
            TaskSummary(task.id, task.title, project, timeLabel(task.updatedAt, nowMillis),
                when {
                    task.pendingApprovalCount > 0 || task.pendingAskCount > 0 -> TaskStatus.Waiting
                    task.status == "running" -> TaskStatus.Running
                    task.status == "failed" || task.status == "error" -> TaskStatus.Error
                    task.status == "completed" || task.status == "done" -> TaskStatus.Done
                    else -> TaskStatus.Idle
                }, task.pinned)
        },
    )
}

internal fun CompanionState.pairUi(): PairUiState = PairUiState(
    paired = paired, busy = busy, status = if (paired) phaseLabel(link.phase) else null,
    computer = link.hostName,
    watchActive = watch.phase == WatchPhase.Active,
    watchStarting = watch.phase == WatchPhase.Starting,
    watchFailed = watch.phase == WatchPhase.Failed,
    resetRequired = problem == CompanionProblem.Storage && (!paired || link.phase == LinkPhase.Revoked),
    error = when (problem) {
        CompanionProblem.Storage -> "本机凭据不可用，未完成安全保存；可清理失效记录后重新配对。"
        CompanionProblem.Pairing -> "配对失败，请确认链接未过期、中继地址有效并检查网络。"
        CompanionProblem.InvalidLink -> "配对链接无效，请在电脑端重新生成二维码或复制配对链接。"
        CompanionProblem.Denied -> "电脑端拒绝了配对，链接可能已过期或已使用。"
        CompanionProblem.Network -> "无法连接中继，请检查网络后重试。"
        CompanionProblem.OutcomeUnknown -> "配对结果不确定，请先在电脑端检查并清理此次授权，再生成新的二维码。"
        CompanionProblem.Revoking -> "暂时无法解绑，已保留凭据，请检查网络后重试。"
        CompanionProblem.Revoked -> "电脑已撤销授权，请重新配对。"
        null -> null
    },
)

private fun phaseLabel(phase: LinkPhase): String = when (phase) {
    LinkPhase.Inactive -> "已配对，回到前台后连接"
    LinkPhase.Connecting -> "正在连接电脑"
    LinkPhase.AwaitingHost -> "等待电脑上线"
    LinkPhase.Authenticating -> "正在验证加密连接"
    LinkPhase.Online -> "已连接"
    LinkPhase.Offline -> "连接中断，正在重试"
    LinkPhase.Replaced -> "已在其他设备打开，点重新连接接管"
    LinkPhase.Revoked -> "授权已撤销"
    LinkPhase.Failed -> "连接验证失败，请解绑后重新配对"
}

private fun timeLabel(timestamp: Long?, now: Long): String {
    if (timestamp == null) return ""
    if (timestamp > now && timestamp - now > 60_000) return "时间待同步"
    val delta = (now - timestamp).coerceAtLeast(0)
    return when {
        delta < 60_000 -> "刚刚"
        delta < 3_600_000 -> "${delta / 60_000} 分钟前"
        delta < 86_400_000 -> "${delta / 3_600_000} 小时前"
        else -> SimpleDateFormat("MM-dd", Locale.getDefault()).format(Date(timestamp))
    }
}
