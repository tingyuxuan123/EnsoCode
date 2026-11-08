package io.github.tingyuxuan123.eaves

import android.view.KeyEvent
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NavigationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun unpairedLaunchDoesNotFabricateAConnectionOrTasks() {
        compose.onNodeWithText("连接电脑后选择模型").assertIsDisplayed()
        compose.onNodeWithText("会话恢复后时间线为空").assertDoesNotExist()
        compose.onNodeWithText("Claude Opus 5.5 · 高").assertDoesNotExist()
        compose.onNodeWithContentDescription("发送").assertDoesNotExist()
    }

    @Test fun drawerShowsEmptyStateAndDisabledSearch() {
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithText("还没有任务").assertIsDisplayed()
        compose.onNodeWithContentDescription("搜索").assertIsNotEnabled()
        compose.onNodeWithContentDescription("关闭").performClick()
        compose.onNodeWithContentDescription("打开任务列表").assertIsDisplayed()
    }

    @Test fun pairingStartsWithNoInviteAndSystemBackReturnsToItsOrigin() {
        compose.onNodeWithText("连接电脑").performClick()
        compose.onNodeWithContentDescription("配对链接").assertIsDisplayed()
        compose.onNodeWithText("配对").assertIsNotEnabled()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.onNodeWithContentDescription("打开任务列表").assertIsDisplayed()

        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithText("连接电脑").performClick()
        compose.onNodeWithContentDescription("关闭").performClick()
        compose.onNodeWithText("还没有任务").assertIsDisplayed()
    }

    @Test fun unpairedProjectSelectorOpensPairingInsteadOfAllowingUnsentWork() {
        compose.onNodeWithText("选择项目").performClick()
        compose.onNodeWithText("配对").assertIsNotEnabled()
    }

    @Test fun deepLinkPrefillsAndRequiresManualConfirmation() {
        val link = "enso://pair?relay=https%3A%2F%2Frelay.example.test&pk=AQ"
        compose.activityRule.scenario.onActivity { activity ->
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(activity.packageName))
        }
        compose.onNodeWithContentDescription("配对链接").assertIsDisplayed()
        compose.onNodeWithText("配对").assertIsEnabled()
        compose.onNodeWithText("配对链接无效，请在电脑端重新生成二维码或复制配对链接。").assertDoesNotExist()
        compose.onNodeWithText("配对").performClick()
        compose.onNodeWithText("配对链接无效，请在电脑端重新生成二维码或复制配对链接。").assertIsDisplayed()
    }
}
