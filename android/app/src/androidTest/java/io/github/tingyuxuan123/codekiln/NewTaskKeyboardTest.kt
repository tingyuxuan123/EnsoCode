package io.github.tingyuxuan123.eaves

import android.view.KeyEvent
import androidx.activity.compose.setContent
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTouchInput
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.ui.NewTaskUiState
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@SdkSuppress(minSdkVersion = 30)
class NewTaskKeyboardTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun composerStaysJustAboveKeyboardAndReturnsWhenDismissed() {
        // Keep the real activity window but make the composer available without pairing.
        compose.activityRule.scenario.onActivity { activity ->
            activity.setContent { EavesApp(state = NewTaskUiState(online = true)) }
        }
        val send = compose.onNodeWithContentDescription("发送")
        val restingBottom = send.fetchSemanticsNode().boundsInWindow.bottom
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val density = compose.activity.resources.displayMetrics.density

        compose.onNodeWithContentDescription("任务描述").performTouchInput { click() }
        compose.waitUntil(timeoutMillis = 5_000) { keyboardTop() != null }
        instrumentation.uiAutomation.waitForIdle(300, 5_000)

        val top = checkNotNull(keyboardTop())
        val bottom = send.fetchSemanticsNode().boundsInWindow.bottom
        val gapDp = (top - bottom) / density
        assertTrue("Expected the composer just above the keyboard; gap was $gapDp dp", gapDp in 0f..24f)

        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.waitUntil(timeoutMillis = 5_000) {
            keyboardTop() == null && send.fetchSemanticsNode().boundsInWindow.bottom == restingBottom
        }
    }

    private fun keyboardTop(): Int? = compose.runOnIdle {
        val activity = compose.activity
        val insets = ViewCompat.getRootWindowInsets(activity.window.decorView) ?: return@runOnIdle null
        val ime = WindowInsetsCompat.Type.ime()
        if (insets.isVisible(ime)) activity.windowManager.currentWindowMetrics.bounds.height() - insets.getInsets(ime).bottom
        else null
    }
}
