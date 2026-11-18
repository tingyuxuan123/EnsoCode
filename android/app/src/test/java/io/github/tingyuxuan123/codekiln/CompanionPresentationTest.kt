package io.github.tingyuxuan123.codekiln

import io.github.tingyuxuan123.codekiln.mirror.DesktopLinkState
import io.github.tingyuxuan123.codekiln.mirror.DesktopProject
import io.github.tingyuxuan123.codekiln.mirror.DesktopTask
import io.github.tingyuxuan123.codekiln.mirror.LinkPhase
import io.github.tingyuxuan123.codekiln.ui.TaskStatus
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

    @Test fun `未配对时不编造电脑或设备`() {
        val ui = CompanionState().settingsUi(notificationsAllowed = true)
        assertFalse(ui.paired)
        assertFalse(ui.online)
        assertEquals(null, ui.computer)
        assertEquals(null, ui.device)
        assertEquals("", ui.connection)
        assertFalse(ui.watchActive)
        assertFalse(ui.resetRequired)
    }

    @Test fun `设置页只展示桌面下发的真实电脑与手机身份`() {
        val ui = CompanionState(paired = true, deviceName = "Pixel 9", link =
            DesktopLinkState(LinkPhase.Online, "书房 MacBook Pro", readOnly = false)).settingsUi(notificationsAllowed = true)
        assertTrue(ui.paired)
        assertTrue(ui.online)
        assertEquals("书房 MacBook Pro", ui.computer)
        assertEquals("Pixel 9", ui.device)
        assertFalse(ui.readOnly)
        assertEquals("已连接", ui.connection)
    }

    @Test fun `电脑名未下发时留空而不是伪造设备列表`() {
        val ui = CompanionState(paired = true, link = DesktopLinkState(LinkPhase.AwaitingHost)).settingsUi(notificationsAllowed = false)
        assertEquals(null, ui.computer)
        assertFalse(ui.online)
        assertEquals("等待电脑上线", ui.connection)
        assertFalse(ui.notificationsAllowed)
    }

    @Test fun `只读连接如实反映桌面权限且不提供手机侧改写`() {
        val ui = CompanionState(paired = true, link = DesktopLinkState(LinkPhase.Online, "工作电脑")).settingsUi(notificationsAllowed = true)
        assertTrue(ui.readOnly)
        assertTrue(ui.online)
        assertFalse(ui.watchFailed)
    }

    @Test fun `后台提醒与通知权限各自如实显示`() {
        val watching = CompanionState(paired = true, link = DesktopLinkState(LinkPhase.Online, "电脑"),
            watch = BackgroundWatch(WatchPhase.Active, "token")).settingsUi(notificationsAllowed = false)
        assertTrue(watching.watchActive)
        assertFalse(watching.notificationsAllowed)
        val broken = CompanionState(paired = true, link = DesktopLinkState(LinkPhase.Online, "电脑"),
            watch = BackgroundWatch(WatchPhase.Failed)).settingsUi(notificationsAllowed = true)
        assertTrue(broken.watchFailed)
        assertTrue(broken.notificationsAllowed)
    }

    @Test fun `只有凭据存储失效且授权已撤销时才提示清理失效记录`() {
        assertTrue(CompanionState(problem = CompanionProblem.Storage, link = DesktopLinkState(LinkPhase.Revoked))
            .settingsUi(false).resetRequired)
        assertFalse(CompanionState(paired = true, problem = CompanionProblem.Storage,
            link = DesktopLinkState(LinkPhase.Online)).settingsUi(false).resetRequired)
        assertFalse(CompanionState(problem = CompanionProblem.Network).settingsUi(false).resetRequired)
    }
}
