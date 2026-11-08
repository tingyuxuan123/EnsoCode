package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopTask

internal enum class TaskNoticeKind { Attention, Failed, Done }
internal data class TaskNotice(val sessionId: String, val title: String, val kind: TaskNoticeKind,
    val approvals: Int = 0, val questions: Int = 0)
internal data class AlertChanges(val upserts: List<TaskNotice> = emptyList(), val cancellations: Set<String> = emptySet())

internal class SessionAlerts {
    private var previous: Map<String, DesktopTask>? = null
    private val posted = mutableMapOf<String, TaskNotice>()

    /** Null is not an empty catalog. Never infer completed work across an authentication gap. */
    fun update(tasks: List<DesktopTask>?, visible: Boolean, enabled: Boolean): AlertChanges {
        if (!enabled) {
            val cancel = posted.keys.toSet()
            posted.clear()
            previous = null
            return AlertChanges(cancellations = cancel)
        }
        if (tasks == null) {
            previous = null
            return AlertChanges()
        }
        val rows = tasks.asSequence().filter { !it.archived }.associateBy { it.id }
        val upserts = mutableListOf<TaskNotice>()
        val cancel = mutableSetOf<String>()
        for ((id, oldNotice) in posted.toMap()) {
            val row = rows[id]
            if (row == null || !oldNotice.stillRelevant(row)) {
                posted.remove(id)
                cancel.add(id)
            }
        }
        if (!visible) for (row in rows.values.sortedWith(compareByDescending<DesktopTask> {
            it.pendingApprovalCount > 0 || it.pendingAskCount > 0
        }.thenByDescending { it.updatedAt ?: 0 })) {
            val old = previous?.get(row.id)
            val title = row.title.filterNot { it.isISOControl() }.trim().take(120).ifBlank { "桌面任务" }
            val notice = when {
                row.pendingApprovalCount > 0 || row.pendingAskCount > 0 -> TaskNotice(row.id, title, TaskNoticeKind.Attention,
                    row.pendingApprovalCount.coerceAtLeast(0), row.pendingAskCount.coerceAtLeast(0))
                old != null && !old.failed() && row.failed() -> TaskNotice(row.id, title, TaskNoticeKind.Failed)
                old?.status == "running" && row.complete() -> TaskNotice(row.id, title, TaskNoticeKind.Done)
                else -> null
            }
            if (notice != null && notice != posted[row.id]) {
                if (row.id !in posted && posted.size >= 24) {
                    val oldDone = if (notice.kind == TaskNoticeKind.Attention) posted.values.firstOrNull { it.kind == TaskNoticeKind.Done } else null
                    if (oldDone == null) continue
                    posted.remove(oldDone.sessionId)
                    cancel.add(oldDone.sessionId)
                    upserts.removeAll { it.sessionId == oldDone.sessionId }
                }
                posted[row.id] = notice
                cancel.remove(row.id)
                upserts.add(notice)
            }
        }
        previous = rows
        return AlertChanges(upserts, cancel)
    }

    private fun TaskNotice.stillRelevant(row: DesktopTask): Boolean = when (kind) {
        TaskNoticeKind.Attention -> row.pendingApprovalCount > 0 || row.pendingAskCount > 0
        TaskNoticeKind.Failed -> row.failed()
        TaskNoticeKind.Done -> row.complete()
    }

    private fun DesktopTask.failed() = status == "failed" || status == "error"
    private fun DesktopTask.complete() = status == "idle" || status == "done" || status == "completed"
}
