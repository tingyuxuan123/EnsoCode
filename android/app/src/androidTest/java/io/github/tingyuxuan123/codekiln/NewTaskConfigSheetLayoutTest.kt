package io.github.tingyuxuan123.codekiln

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.codekiln.mirror.DesktopModel
import io.github.tingyuxuan123.codekiln.mirror.DesktopProject
import io.github.tingyuxuan123.codekiln.mirror.DesktopProvider
import io.github.tingyuxuan123.codekiln.ui.EnsoTheme
import io.github.tingyuxuan123.codekiln.ui.NewTaskConfigSheet
import io.github.tingyuxuan123.codekiln.ui.TaskConfiguration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The new-task sheet must have exactly one vertical scroller: the panel. A second, inner scrollable
 * (the model list) steals the drag and leaves the bottom approval modes unreachable.
 */
@RunWith(AndroidJUnit4::class)
class NewTaskConfigSheetLayoutTest {
    @get:Rule val compose = createComposeRule()
    private val projects = listOf(DesktopProject("p", "真实项目"))
    private val providers = listOf(DesktopProvider("provider", "真实服务", (1..8).map { DesktopModel("m$it", "模型$it") }))

    private fun open(dismiss: () -> Unit = {}) {
        val config = mutableStateOf(TaskConfiguration())
        compose.setContent {
            EnsoTheme { NewTaskConfigSheet(projects, providers, config.value, true, { config.value = it }, dismiss) }
        }
        compose.waitForIdle()
    }

    private fun scrollers() = compose
        .onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange), useUnmergedTree = true)
        .fetchSemanticsNodes()

    private fun onlyScroller(): Rect {
        val found = scrollers()
        assertEquals(
            "面板内应只有 1 个纵向滚动节点，实际 " + found.size + " 个：" +
                found.joinToString(" ") { it.boundsInRoot.toString() },
            1, found.size,
        )
        return found.single().boundsInRoot
    }

    private fun bounds(text: String): Rect = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot

    /** Unclipped top of a node, so a scrolled-away header still reports how far the panel moved. */
    private fun unclippedTop(text: String): Dp = compose.onNodeWithText(text).getUnclippedBoundsInRoot().top

    /** Read the same value on three consecutive settled frames; any drifting layout shows up as a mismatch. */
    private fun sampleSettledFrames(label: String, frames: Int = 3, value: () -> Any) {
        val first = value()
        repeat(frames) {
            compose.waitForIdle()
            assertEquals("$label 不应在相邻帧之间漂移", first, value())
        }
    }

    /** The sheet lives in its own dialog window, so pick the largest semantics root. */
    private fun panel(): SemanticsNodeInteraction {
        val roots = compose.onAllNodes(isRoot()).fetchSemanticsNodes()
        val widest = roots.indices.maxBy { roots[it].boundsInRoot.width * roots[it].boundsInRoot.height }
        return compose.onAllNodes(isRoot())[widest]
    }

    /** Swipe up from an absolute window y coordinate, staying inside the sheet. */
    private fun swipePanelUp(distance: Dp, fromY: Float, durationMillis: Long = 320L) = panel().performTouchInput {
        swipe(Offset(centerX, fromY), Offset(centerX, fromY - distance.toPx()), durationMillis)
    }

    @Test fun panelIsTheOnlyVerticalScroller() {
        open()
        onlyScroller()
    }

    @Test fun swipingOverTheModelListScrollsThePanelAndReachesApprovalModes() {
        open()
        val titleBefore = unclippedTop("新任务设置")
        val listTop = bounds("模型1").top
        val window = panel().fetchSemanticsNode().boundsInRoot

        // Drag inside the model list, the area that currently owns its own scroll.
        assertTrue("模型列表应在面板内：list=$listTop window=$window", listTop > window.top && listTop < window.bottom)
        swipePanelUp(220.dp, fromY = listTop + 80f)
        compose.waitForIdle()

        val titleAfter = unclippedTop("新任务设置")
        val moved = titleBefore - titleAfter
        assertTrue(
            "在模型列表上轻上滑后标题必须随面板上移至少 120dp：title $titleBefore -> $titleAfter（位移 $moved px，" +
                "window=$window，listTop=$listTop）",
            moved >= 120.dp,
        )

        sampleSettledFrames("滚动后的标题位置") { unclippedTop("新任务设置") }

        // Keep scrolling the panel until the last approval mode is fully visible.
        var attempts = 0
        var reached = runCatching { compose.onNodeWithText("助手代审").assertIsDisplayed() }.isSuccess
        while (!reached && attempts < 4) {
            swipePanelUp(240.dp, fromY = window.bottom * .62f)
            compose.waitForIdle()
            attempts++
            reached = runCatching { compose.onNodeWithText("助手代审").assertIsDisplayed() }.isSuccess
        }
        compose.onNodeWithText("助手代审").assertIsDisplayed()
        val last = bounds("助手代审")
        val view = onlyScroller()
        assertTrue("最后一个审批选项必须滚到面板可视区内：last=$last page=$view", last.top >= view.top && last.bottom <= view.bottom)
    }

    @Test fun headerStaysInThePanelAndCloseStillDismisses() {
        var dismissed = false
        open { dismissed = true }
        val page = onlyScroller()
        val title = bounds("新任务设置")
        assertTrue("标题与关闭按钮必须完整落在面板可视区内：title=$title page=$page", title.top >= page.top && title.bottom <= page.bottom)
        compose.onNodeWithContentDescription("关闭新任务设置").assertIsDisplayed().performClick()
        compose.waitForIdle()
        assertTrue("关闭按钮仍应关闭面板", dismissed)
    }

    @Test fun panelHeightStaysConstantAcrossFramesAndScrolling() {
        open()
        val before = onlyScroller()
        sampleSettledFrames("面板视口高度", frames = 4) { onlyScroller() }
        swipePanelUp(300.dp, fromY = panel().fetchSemanticsNode().boundsInRoot.height * .62f, durationMillis = 900L)
        compose.waitForIdle()
        assertEquals("滚动后视口高度必须与滚动前一致", before, onlyScroller())
    }

    /** A fast swipe must settle just like a slow one: no endless recomposition while the sheet settles. */
    @Test fun fastSwipeAlsoSettles() {
        open()
        swipePanelUp(300.dp, fromY = panel().fetchSemanticsNode().boundsInRoot.height * .62f)
        compose.waitForIdle()
        assertEquals("快速上滑也必须只有 1 个纵向滚动节点", 1, scrollers().size)
    }
}
