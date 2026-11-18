package io.github.tingyuxuan123.eaves

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DesignPreviewTest {
    @get:Rule val compose = createAndroidComposeRule<DesignPreviewActivity>()

    @Test fun indexShowsWaitingThenRunningSummaryWithoutEnablingSend() {
        compose.onNodeWithText("会话恢复后时间线为空").assertIsDisplayed()
        compose.onNodeWithText("首页 Hero 用哪张截图").assertIsDisplayed()
        compose.onNodeWithText("工作流面板显示运行进度").assertIsDisplayed()
        compose.onNodeWithText("Windows 版 CI 签名失败排查").assertDoesNotExist()
        compose.onNodeWithText("还有 1 个 · 查看全部").assertIsDisplayed()
        compose.onNodeWithContentDescription("发送").assertIsNotEnabled()
    }

    @Test fun drawerSearchChangesVisibleTaskRows() {
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithText("会话恢复后时间线为空").assertIsDisplayed()
        compose.onNodeWithContentDescription("搜索").performClick()
        compose.onNodeWithContentDescription("搜索任务").performTextInput("hero")
        compose.onNodeWithText("首页 Hero 用哪张截图").assertIsDisplayed()
        compose.onNodeWithText("会话恢复后时间线为空").assertDoesNotExist()
    }
}
