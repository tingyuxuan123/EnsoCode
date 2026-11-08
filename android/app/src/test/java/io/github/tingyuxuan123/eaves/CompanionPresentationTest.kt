package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopLinkState
import io.github.tingyuxuan123.eaves.mirror.DesktopProject
import io.github.tingyuxuan123.eaves.mirror.DesktopTask
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.ui.TaskStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionPresentationTest {
    @Test fun `目录真实身份和待处理优先级投影且归档项不伪装活跃任务`() {
        val state = CompanionState(paired = true, link = DesktopLinkState(LinkPhase.Online, "工作电脑", listOf(
            DesktopTask("waiting", "待你审批", "Repo", 60_000L, "running", pendingApprovalCount = 1, pinned = true),
            DesktopTask("running", "执行中", "Repo", null, "running"),
            DesktopTask("error", "出错", "", 0L, "failed"),
            DesktopTask("idle", "空闲", "Repo", 1_000L, "idle"),
            DesktopTask("archive", "归档", "Repo", 0L, "idle", archived = true),
        )))
        val ui = state.taskUi(120_000L)
        assertEquals(listOf("waiting", "running", "error", "idle"), ui.tasks.map { it.id })
        assertEquals(listOf(TaskStatus.Waiting, TaskStatus.Running, TaskStatus.Error, TaskStatus.Idle), ui.tasks.map { it.status })
        assertEquals("工作电脑", ui.computer)
        assertEquals("1 分钟前", ui.tasks.first().time)
        assertTrue(ui.tasks.first().pinned)
        assertTrue(ui.online)
    }

    @Test fun `被替换和断线不会继续声称在线`() {
        for (phase in listOf(LinkPhase.Replaced, LinkPhase.Offline, LinkPhase.Authenticating)) {
            val state = CompanionState(paired = true, link = DesktopLinkState(phase))
            assertFalse(state.taskUi(0).online)
            assertFalse(state.pairUi().status.isNullOrEmpty())
            assertTrue(state.pairUi().paired)
        }
    }

    @Test fun `配对错误只显示通用安全说明而不是原始URI或异常`() {
        val ui = CompanionState(problem = CompanionProblem.Storage).pairUi()
        assertFalse(ui.error.isNullOrEmpty())
        assertFalse(ui.paired)
        assertFalse(ui.busy)
    }

    @Test fun `只有在线且有操作权限时新任务才提供输入`() {
        assertTrue(CompanionState(paired = true, link = DesktopLinkState(LinkPhase.Online, readOnly = false)).taskUi(0).composerAvailable)
        assertFalse(CompanionState(paired = true, link = DesktopLinkState(LinkPhase.Online, readOnly = true)).taskUi(0).composerAvailable)
        assertFalse(CompanionState(paired = true, link = DesktopLinkState(LinkPhase.Offline, readOnly = false)).taskUi(0).composerAvailable)
    }

    @Test fun `精简目录按项目ID补标签但不猜未知项目`() {
        val link = DesktopLinkState(LinkPhase.Online, catalog = listOf(
            DesktopTask("cold", "Cold", "", status = "idle", projectId = "project"),
            DesktopTask("hot", "Hot", "Desktop name", status = "idle", projectId = "project"),
            DesktopTask("other", "Other", "", status = "idle", projectId = "missing"),
        ), projects = listOf(DesktopProject("project", "Project alias")))
        assertEquals(listOf("Project alias", "Desktop name", null), CompanionState(paired = true, link = link).taskUi(0).tasks.map { it.project })
    }
}
