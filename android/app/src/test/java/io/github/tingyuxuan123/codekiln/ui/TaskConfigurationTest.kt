package io.github.tingyuxuan123.eaves.ui

import io.github.tingyuxuan123.eaves.mirror.DesktopModel
import io.github.tingyuxuan123.eaves.mirror.DesktopProject
import io.github.tingyuxuan123.eaves.mirror.DesktopProvider
import io.github.tingyuxuan123.eaves.mirror.TaskApprovalMode
import io.github.tingyuxuan123.eaves.mirror.TaskThinkingLevel
import org.junit.Assert.*
import org.junit.Test

class TaskConfigurationTest {
    private val projects = listOf(DesktopProject("p1", "工作项目"), DesktopProject("p2", "另一个项目"))
    private val providers = listOf(
        DesktopProvider("a", "模型服务 A", listOf(DesktopModel("same", "模型 A"), DesktopModel("other", "另一个模型"))),
        DesktopProvider("b", "模型服务 B", listOf(DesktopModel("same", "模型 B"))),
    )

    @Test fun `defaults are real and least privilege without pretending preset capability`() {
        val config = TaskConfiguration()
        val request = config.launch(projects, providers, "  保留原文\n")!!
        assertEquals("p1", request.projectId)
        assertEquals("a", request.providerId)
        assertEquals("same", request.modelId)
        assertEquals(TaskApprovalMode.Supervised, request.approvalMode)
        assertEquals(TaskThinkingLevel.High, request.thinkingLevel)
        assertEquals("  保留原文\n", request.text)
    }

    @Test fun `removed explicit selection cannot silently create on another project or model`() {
        val picked = TaskConfiguration(projectId = "p2", providerId = "a", modelId = "other")
        assertNull(picked.launch(projects.take(1), providers, "hello"))
        assertNull(picked.launch(projects, providers.drop(1), "hello"))
        assertNull(picked.launch(projects, providers.map { it.copy(models = it.models.take(1)) }, "hello"))
        val request = picked.launch(projects, providers, "hello")!!
        assertEquals("p2", request.projectId)
        assertEquals("other", request.modelId)
    }

    @Test fun `unknown data empty choices blank and oversized text cannot create`() {
        val config = TaskConfiguration()
        assertNull(config.launch(null, providers, "hello"))
        assertNull(config.launch(projects, null, "hello"))
        assertNull(config.launch(emptyList(), providers, "hello"))
        assertNull(config.launch(projects, emptyList(), "hello"))
        assertNull(config.launch(projects, providers, "  \n"))
        assertNull(config.launch(projects, providers, "x".repeat(32_001)))
    }
}
