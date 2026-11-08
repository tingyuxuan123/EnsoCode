package io.github.tingyuxuan123.eaves.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class TaskPresentationTest {
    private fun task(id: String, status: TaskStatus, project: String? = "Eaves", pinned: Boolean = false) =
        TaskSummary(id, "Task $id", project, "刚刚", status, pinned)

    @Test fun `看板优先显示等待处理再显示运行中但不改变同类顺序`() {
        val tasks = listOf(
            task("r1", TaskStatus.Running), task("d", TaskStatus.Done),
            task("w1", TaskStatus.Waiting), task("r2", TaskStatus.Running),
            task("w2", TaskStatus.Waiting), task("e", TaskStatus.Error),
        )
        val glance = taskGlance(tasks)
        assertEquals(listOf("w1", "w2", "r1"), glance.tasks.map { it.id })
        assertEquals(1, glance.remaining)
        assertEquals("r1", tasks.first().id)
    }

    @Test fun `完成和出错不计入更多待处理任务数`() {
        val glance = taskGlance(listOf(task("w", TaskStatus.Waiting), task("d", TaskStatus.Done)))
        assertEquals(listOf("w"), glance.tasks.map { it.id })
        assertEquals(0, glance.remaining)
        assertEquals(TaskGlance(emptyList(), 0), taskGlance(emptyList()))
    }

    @Test fun `搜索同时匹配标题和项目且忽略大小写及两侧空白`() {
        val tasks = listOf(task("a", TaskStatus.Running), task("b", TaskStatus.Done, "Other"))
        assertEquals(listOf("a"), visibleTasks(tasks, " eAvEs ").map { it.id })
        assertEquals(listOf("b"), visibleTasks(tasks, "task B").map { it.id })
        assertEquals(tasks, visibleTasks(tasks, "  "))
    }

    @Test fun `搜索状态项目三个筛选取交集`() {
        val tasks = listOf(
            task("one", TaskStatus.Waiting), task("two", TaskStatus.Running),
            task("three", TaskStatus.Waiting, "Other"),
        )
        assertEquals(listOf("one"), visibleTasks(tasks, "task", TaskStatus.Waiting, "Eaves").map { it.id })
        assertEquals(emptyList<TaskSummary>(), visibleTasks(tasks, "missing", TaskStatus.Waiting, "Eaves"))
    }

    @Test fun `无项目的对话可以搜索且置顶保持原始权威顺序`() {
        val tasks = listOf(task("plain", TaskStatus.Done, null), task("pin", TaskStatus.Done, pinned = true))
        assertEquals(tasks, visibleTasks(tasks))
        assertEquals(listOf("plain"), visibleTasks(tasks, "plain").map { it.id })
        assertEquals(listOf("pin"), visibleTasks(tasks, project = "Eaves").map { it.id })
    }
}
