package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopTask
import org.junit.Assert.*
import org.junit.Test

class SessionAlertsTest {
    private fun task(id: String = "s", status: String = "idle", approvals: Int = 0, questions: Int = 0) =
        DesktopTask(id, "Task $id", "Repo", status = status, pendingApprovalCount = approvals, pendingAskCount = questions)

    @Test fun `foreground suppresses and leaving emits unresolved attention once`() {
        val alerts = SessionAlerts()
        assertTrue(alerts.update(listOf(task(approvals = 1)), visible = true, enabled = true).upserts.isEmpty())
        val leaving = alerts.update(listOf(task(approvals = 1)), visible = false, enabled = true)
        assertEquals(listOf(TaskNotice("s", "Task s", TaskNoticeKind.Attention, approvals = 1)), leaving.upserts)
        assertTrue(alerts.update(listOf(task(approvals = 1)), false, true).upserts.isEmpty())
        assertEquals(setOf("s"), alerts.update(listOf(task()), false, true).cancellations)
    }

    @Test fun `completion requires observed running transition not cold baseline or reconnect gap`() {
        val alerts = SessionAlerts()
        assertTrue(alerts.update(listOf(task(status = "idle")), false, true).upserts.isEmpty())
        alerts.update(listOf(task(status = "running")), false, true)
        assertEquals(TaskNoticeKind.Done, alerts.update(listOf(task()), false, true).upserts.single().kind)
        assertTrue(alerts.update(listOf(task()), false, true).upserts.isEmpty())
        alerts.update(listOf(task(status = "running")), false, true)
        alerts.update(null, false, true)
        assertTrue(alerts.update(listOf(task()), false, true).upserts.isEmpty())
    }

    @Test fun `only real authenticated counters alert and resolved removed or revoked tasks cancel`() {
        val alerts = SessionAlerts()
        assertTrue(alerts.update(null, false, true).upserts.isEmpty())
        val added = alerts.update(listOf(task(approvals = 2, questions = 1)), false, true).upserts.single()
        assertEquals(2, added.approvals)
        assertEquals(1, added.questions)
        assertEquals(setOf("s"), alerts.update(emptyList(), false, true).cancellations)
        alerts.update(listOf(task(questions = 1)), false, true)
        assertEquals(setOf("s"), alerts.update(null, false, false).cancellations)
    }

    @Test fun `failed transitions group under one session without including code or error body`() {
        val alerts = SessionAlerts()
        alerts.update(listOf(task(status = "running")), false, true)
        val failed = alerts.update(listOf(task(status = "failed")), false, true).upserts.single()
        assertEquals(TaskNoticeKind.Failed, failed.kind)
        assertEquals("Task s", failed.title)
        assertTrue(alerts.update(listOf(task(status = "failed")), false, true).upserts.isEmpty())
    }

    @Test fun `malformed gaps do not turn a missing task into completed and large catalogs stay bounded`() {
        val alerts = SessionAlerts()
        alerts.update(listOf(task(status = "running")), false, true)
        alerts.update(null, false, true)
        assertTrue(alerts.update(listOf(task()), false, true).upserts.isEmpty())
        val many = (0..80).map { task("id-$it", approvals = 1) }
        assertEquals(24, alerts.update(many, false, true).upserts.size)
        assertEquals(24, alerts.update(emptyList(), false, true).cancellations.size)
    }

}
