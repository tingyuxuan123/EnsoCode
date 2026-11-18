package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.mirror.DesktopModel
import io.github.tingyuxuan123.eaves.mirror.DesktopProject
import io.github.tingyuxuan123.eaves.mirror.DesktopProvider
import io.github.tingyuxuan123.eaves.mirror.SESSION_TEXT_LIMIT
import io.github.tingyuxuan123.eaves.mirror.TaskApprovalMode
import io.github.tingyuxuan123.eaves.mirror.TaskLaunch
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel

internal data class TaskConfiguration(
    val projectId: String? = null,
    val providerId: String? = null,
    val modelId: String? = null,
    val approvalMode: TaskApprovalMode = TaskApprovalMode.Supervised,
    val thinkingLevel: TaskThinkingLevel? = TaskThinkingLevel.High,
) {
    fun project(projects: List<DesktopProject>?): DesktopProject? =
        if (projectId == null) projects?.firstOrNull() else projects?.find { it.id == projectId }

    fun provider(providers: List<DesktopProvider>?): DesktopProvider? =
        if (providerId == null) providers?.firstOrNull { it.models.isNotEmpty() } else providers?.find { it.id == providerId }

    fun model(providers: List<DesktopProvider>?): DesktopModel? = provider(providers)?.models?.let { models ->
        if (modelId == null) models.firstOrNull() else models.find { it.id == modelId }
    }

    fun launch(projects: List<DesktopProject>?, providers: List<DesktopProvider>?, text: String): TaskLaunch? {
        if (text.length !in 1..SESSION_TEXT_LIMIT || text.isBlank()) return null
        val project = project(projects) ?: return null
        val provider = provider(providers) ?: return null
        val model = model(providers) ?: return null
        return TaskLaunch(project.id, provider.id, model.id, approvalMode, thinkingLevel, text)
    }
}
