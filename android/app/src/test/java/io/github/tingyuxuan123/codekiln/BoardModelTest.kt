package io.github.tingyuxuan123.eaves

import io.github.tingyuxuan123.eaves.mirror.DesktopTask
import io.github.tingyuxuan123.eaves.ui.boardGroups
import io.github.tingyuxuan123.eaves.ui.relativeTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BoardModelTest {
    private fun task(id: String, status: String, approvals: Int = 0, asks: Int = 0,
        updatedAt: Long? = null, archived: Boolean = false) =
        DesktopTask(id, "Task $id", "Repo", updatedAt, status, approvals, asks, false, archived, "p1")

    @Test fun `pending work always wins over running and archived rows never appear`() {
        val groups = boardGroups(listOf(
            task("a", "running", approvals = 1, updatedAt = 10),
            task("b", "running", updatedAt = 30),
            task("c", "idle", asks = 2, updatedAt = 20),
            task("d", "idle", updatedAt = 50),
            task("e", "running", approvals = 1, archived = true),
            task("f", "idle", updatedAt = 99, archived = true),
        ), dayStart = 40)
        assertEquals(listOf("c", "a"), groups.waiting.map { it.id })
        assertEquals(listOf("b"), groups.running.map { it.id })
        assertEquals(listOf("d"), groups.done.map { it.id })
    }

    @Test fun `done needs a real timestamp from today and missing times are never invented`() {
        val groups = boardGroups(listOf(
            task("old", "idle", updatedAt = 39),
            task("unknown", "idle"),
            task("edge", "idle", updatedAt = 40),
            task("failed", "failed", updatedAt = 41),
        ), dayStart = 40)
        assertEquals(listOf("failed", "edge"), groups.done.map { it.id })
        assertEquals(0, groups.running.size)
        assertEquals(0, groups.waiting.size)
    }

    @Test fun `groups are newest first and a running row without a time still shows`() {
        val groups = boardGroups(listOf(
            task("older", "running", updatedAt = 10),
            task("newer", "running", updatedAt = 30),
            task("untimed", "running"),
            task("wait-old", "running", asks = 1, updatedAt = 5),
            task("wait-new", "running", approvals = 1, updatedAt = 25),
        ), dayStart = 0)
        assertEquals(listOf("wait-new", "wait-old"), groups.waiting.map { it.id })
        assertEquals(listOf("newer", "older", "untimed"), groups.running.map { it.id })
    }

    @Test fun `relative time never claims precision it does not have`() {
        val minute = 60_000L
        assertNull(relativeTime(null, 10 * minute))
        assertNull(relativeTime(11 * minute, 10 * minute))
        assertEquals("刚刚", relativeTime(10 * minute, 10 * minute))
        assertEquals("1 分钟前", relativeTime(9 * minute, 10 * minute))
        assertEquals("59 分钟前", relativeTime(10 * minute - 59 * minute, 10 * minute))
        assertEquals("1 小时前", relativeTime(10 * minute - 60 * minute, 10 * minute))
        assertEquals("23 小时前", relativeTime(10 * minute - 23 * 60 * minute, 10 * minute))
        assertEquals("1 天前", relativeTime(10 * minute - 24 * 60 * minute, 10 * minute))
        assertEquals("6 天前", relativeTime(10 * minute - 6 * 24 * 60 * minute, 10 * minute))
    }
}
