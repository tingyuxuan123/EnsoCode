package io.github.tingyuxuan123.codekiln

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalDensity
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
import androidx.compose.ui.unit.Density
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
 * Independent sizing check for the new-task sheet: the panel height is capped from the window only, so it must stay
 * put while the sheet is dragged or scrolled, and the approval modes must stay reachable at 1.5x text scale and with
 * as few as zero models. The model list must never take over the drag with its own scroller.
 */
@RunWith(AndroidJUnit4::class)
class NewTaskConfigSheetSizingTest {
    @get:Rule val compose = createComposeRule()
    private val projects = listOf(DesktopProject("p", "真实项目"))
    private fun providers(count: Int) = listOf(DesktopProvider("provider", "真实服务", (1..count).map { DesktopModel("m$it", "模型$it") }))

    private fun open(provider: List<DesktopProvider>?, fontScale: Float, dismiss: () -> Unit = {}) {
        val config = mutableStateOf(TaskConfiguration())
        compose.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, fontScale)) {
                EnsoTheme { NewTaskConfigSheet(projects, provider, config.value, true, { config.value = it }, dismiss) }
            }
        }
        compose.waitForIdle()
    }

    private fun scrollers() = compose
        .onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange), useUnmergedTree = true)
        .fetchSemanticsNodes()

    private fun onlyScroller(): Rect {
        val found = scrollers()
        assertEquals("面板内应只有 1 个纵向滚动节点，实际 " + found.size + " 个", 1, found.size)
        return found.single().boundsInRoot
    }

    private fun bounds(text: String): Rect = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot
    private fun unclippedTop(text: String): Dp = compose.onNodeWithText(text).getUnclippedBoundsInRoot().top

    private fun panel(): SemanticsNodeInteraction {
        val roots = compose.onAllNodes(isRoot()).fetchSemanticsNodes()
        val widest = roots.indices.maxBy { roots[it].boundsInRoot.width * roots[it].boundsInRoot.height }
        return compose.onAllNodes(isRoot())[widest]
    }

    private fun swipePanelUp(distance: Dp) = panel().performTouchInput {
        swipe(Offset(centerX, height * .62f), Offset(centerX, height * .62f - distance.toPx()), 320L)
    }

    /** The header has to stay inside the panel viewport, i.e. below the status bar, never clipped away by it. */
    private fun assertHeaderInside(viewport: Rect) {
        val title = bounds("新任务设置")
        assertTrue("标题必须完整落在面板可视区内：title=$title page=$viewport",
            title.top >= viewport.top && title.bottom <= viewport.bottom)
        assertTrue("标题不能被状态栏裁到屏幕外：title=$title", title.top >= 0f)
    }

    private fun scrollUntilApprovalReachable(): Rect {
        val viewport = onlyScroller()
        var attempts = 0
        var reached = runCatching { compose.onNodeWithText("助手代审").assertIsDisplayed() }.isSuccess
        while (!reached && attempts < 6) {
            swipePanelUp(240.dp)
            compose.waitForIdle()
            attempts++
            reached = runCatching { compose.onNodeWithText("助手代审").assertIsDisplayed() }.isSuccess
        }
        compose.onNodeWithText("助手代审").assertIsDisplayed()
        val last = bounds("助手代审")
        val page = onlyScroller()
        assertTrue("最后一个审批选项必须滚进面板可视区（$attempts 次上滑后）：last=$last page=$page",
            last.top >= page.top && last.bottom <= page.bottom)
        assertEquals("滚动不应改变面板视口高度", viewport, page)
        return page
    }

    @Test fun singleModelAtLargeTextKeepsOneScrollerAndReachesApproval() {
        open(providers(1), fontScale = 1.5f)
        val viewport = onlyScroller()
        assertHeaderInside(viewport)
        assertTrue("面板不能高过整个窗口：page=$viewport", viewport.height > 0f)
        scrollUntilApprovalReachable()
        assertEquals("大字号下仍只能有 1 个纵向滚动节点", 1, scrollers().size)
    }

    @Test fun manyModelsAtLargeTextKeepHeaderVisibleAndPanelStable() {
        open(providers(8), fontScale = 1.5f)
        val before = onlyScroller()
        assertHeaderInside(before)
        for (frame in 1..3) {
            compose.waitForIdle()
            assertEquals("面板视口高度不应在相邻帧之间漂移（第 $frame 帧）", before, onlyScroller())
        }
        val topBefore = unclippedTop("新任务设置")
        swipePanelUp(200.dp)
        compose.waitForIdle()
        assertTrue("在模型列表上上滑必须滚动面板：$topBefore -> ${unclippedTop("新任务设置")}",
            unclippedTop("新任务设置") < topBefore)
        scrollUntilApprovalReachable()
        assertEquals("多模型 + 大字号下仍只能有 1 个纵向滚动节点", 1, scrollers().size)
    }

    @Test fun emptyModelListStillRendersOneScrollerWithNotice() {
        open(emptyList(), fontScale = 1.0f)
        onlyScroller()
        compose.onNodeWithText("桌面没有可用模型，请先在电脑端添加。").assertIsDisplayed()
        scrollUntilApprovalReachable()
    }

    @Test fun loadingModelListStillRendersOneScrollerWithNotice() {
        open(null, fontScale = 1.0f)
        val viewport = onlyScroller()
        assertHeaderInside(viewport)
        compose.onNodeWithText("正在读取桌面模型…").assertIsDisplayed()
    }

    @Test fun closeButtonStillDismissesAtLargeText() {
        var dismissed = false
        open(providers(3), fontScale = 1.5f) { dismissed = true }
        compose.onNodeWithContentDescription("关闭新任务设置").assertIsDisplayed().performClick()
        compose.waitForIdle()
        assertTrue("大字号下关闭按钮仍应关闭面板", dismissed)
    }
}
