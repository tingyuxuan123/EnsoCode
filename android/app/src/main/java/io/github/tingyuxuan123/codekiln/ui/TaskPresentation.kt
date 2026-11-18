package io.github.tingyuxuan123.eaves.ui

internal enum class TaskStatus { Waiting, Running, Error, Done, Idle }

internal data class TaskSummary(
    val id: String,
    val title: String,
    val project: String?,
    val time: String,
    val status: TaskStatus,
    val pinned: Boolean = false,
)

internal data class TaskGlance(val tasks: List<TaskSummary>, val remaining: Int)

internal fun taskGlance(tasks: List<TaskSummary>): TaskGlance {
    val active = tasks.filter { it.status == TaskStatus.Waiting } + tasks.filter { it.status == TaskStatus.Running }
    val visible = active.take(3)
    return TaskGlance(visible, active.size - visible.size)
}

internal fun visibleTasks(
    tasks: List<TaskSummary>,
    query: String = "",
    status: TaskStatus? = null,
    project: String? = null,
): List<TaskSummary> {
    val search = query.trim()
    return tasks.filter { task ->
        (status == null || task.status == status) &&
            (project == null || task.project == project) &&
            (search.isEmpty() || task.title.contains(search, ignoreCase = true) ||
                task.project?.contains(search, ignoreCase = true) == true)
    }
}
