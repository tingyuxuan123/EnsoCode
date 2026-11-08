package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.mirror.DesktopTask

internal data class BoardGroups(
    val waiting: List<DesktopTask>,
    val running: List<DesktopTask>,
    val done: List<DesktopTask>,
)

/**
 * The catalog only carries status and pending counts, so the board never invents workflow
 * progress, subagents or background tasks. Pending work outranks a running status.
 */
internal fun boardGroups(tasks: List<DesktopTask>, dayStart: Long): BoardGroups {
    val visible = tasks.filterNot { it.archived }
    fun pending(task: DesktopTask) = task.pendingApprovalCount > 0 || task.pendingAskCount > 0
    fun newestFirst(rows: List<DesktopTask>) = rows.sortedByDescending { it.updatedAt ?: Long.MIN_VALUE }
    val waiting = visible.filter(::pending)
    val running = visible.filter { !pending(it) && it.status == "running" }
    val done = visible.filter {
        val updated = it.updatedAt ?: return@filter false
        !pending(it) && it.status != "running" && updated >= dayStart
    }
    return BoardGroups(newestFirst(waiting), newestFirst(running), newestFirst(done))
}

/** Coarse, downward-rounded labels. Unknown or future timestamps return null rather than a guess. */
internal fun relativeTime(then: Long?, now: Long): String? {
    if (then == null || then > now) return null
    val minutes = (now - then) / 60_000L
    return when {
        minutes < 1 -> "刚刚"
        minutes < 60 -> "$minutes 分钟前"
        minutes < 24 * 60 -> "${minutes / 60} 小时前"
        else -> "${minutes / (24 * 60)} 天前"
    }
}
