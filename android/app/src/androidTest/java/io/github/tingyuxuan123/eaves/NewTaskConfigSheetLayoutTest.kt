package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.mirror.DesktopModel
import io.github.tingyuxuan123.eaves.mirror.DesktopProject
import io.github.tingyuxuan123.eaves.mirror.DesktopProvider
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.NewTaskConfigSheet
import io.github.tingyuxuan123.eaves.ui.TaskConfiguration
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NewTaskConfigSheetLayoutTest {
    @get:Rule val compose = createComposeRule()
    private val projects = listOf(DesktopProject("p", "真实项目"))
    private val providers = listOf(DesktopProvider("provider", "真实服务", (1..8).map { DesktopModel("m$it", "模型$it") }))

    private fun box(text: String): Rect = compose.onNodeWithText(text).fetchSemanticsNode().boundsInRoot

    @Test fun probe() {
        val metrics = InstrumentationRegistry.getInstrumentation().targetContext.resources.displayMetrics
        println("PROBE density=${metrics.density} px=${metrics.widthPixels}x${metrics.heightPixels} dp=${metrics.widthPixels / metrics.density}x${metrics.heightPixels / metrics.density}")
        val config = mutableStateOf(TaskConfiguration())
        compose.setContent { EnsoTheme { NewTaskConfigSheet(projects, providers, config.value, true, { config.value = it }, {}) } }
        compose.waitForIdle()
        println("PROBE root=${compose.onRoot().fetchSemanticsNode().boundsInRoot}")
        println("PROBE title=${box("新任务设置")}")
        println("PROBE m1=${box("模型1")}")
        println("PROBE m8=${box("模型8")}")
        println("PROBE last=${box("助手代审")}")
        compose.onNodeWithText("模型1").performTouchInput { swipeUp() }
        compose.waitForIdle()
        println("PROBE swipe title=${box("新任务设置")}")
        println("PROBE swipe m1=${box("模型1")}")
        println("PROBE swipe last=${box("助手代审")}")
        println("PROBE lastNodes=${compose.onAllNodesWithText("助手代审").fetchSemanticsNodes().size}")
    }
}
