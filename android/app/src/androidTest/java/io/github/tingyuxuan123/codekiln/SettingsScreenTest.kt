package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopLinkState
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.SettingsScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SettingsScreenTest {
    @get:Rule val compose = createComposeRule()

    private fun opened(): SettingsUiState = CompanionState(paired = true, deviceName = "Pixel 9",
        link = DesktopLinkState(LinkPhase.Online, "书房 MacBook Pro", readOnly = false))
        .settingsUi(notificationsAllowed = true)

    @Test fun showsTheRealComputerAndTheDesktopGrantedPermission() {
        compose.setContent { EnsoTheme { SettingsScreen(opened(), onBack = {}) } }
        compose.onNodeWithText("设备与通知").assertIsDisplayed()
        compose.onNodeWithText("书房 MacBook Pro").assertIsDisplayed()
        compose.onNodeWithText("已连接").assertIsDisplayed()
        compose.onNodeWithText("可操作").assertIsDisplayed()
        compose.onNodeWithText("Pixel 9").assertIsDisplayed()
        // One computer, one phone: no device switcher and no phone-side permission switch.
        compose.onNodeWithText("切换").assertDoesNotExist()
        compose.onNodeWithText("改成只读").assertDoesNotExist()
    }

    @Test fun readOnlyIsReportedAndNeverOfferedAsAPhoneToggle() {
        compose.setContent { EnsoTheme { SettingsScreen(opened().copy(readOnly = true), onBack = {}) } }
        compose.onNodeWithText("只读").assertIsDisplayed()
        compose.onNodeWithText("只能查看会话，权限由电脑设置").assertIsDisplayed()
        compose.onNodeWithText("改成可操作").assertDoesNotExist()
        compose.onNodeWithText("改成只读").assertDoesNotExist()
    }

    @Test fun reminderSwitchReportsTheRealWatchStateAndTogglesIt() {
        val watched = mutableStateOf(false)
        var toggles = 0
        compose.setContent { EnsoTheme {
            SettingsScreen(opened().copy(watchActive = watched.value), onBack = {},
                onWatch = { toggles++; watched.value = !watched.value })
        } }
        compose.onNodeWithContentDescription("后台提醒").assertIsOff()
        compose.onNodeWithContentDescription("后台提醒").performClick()
        assertEquals(1, toggles)
        compose.onNodeWithContentDescription("后台提醒").assertIsOn()
    }

    @Test fun missingNotificationPermissionPointsAtTheSystemSetting() {
        var openedSettings = 0
        compose.setContent { EnsoTheme {
            SettingsScreen(opened().copy(notificationsAllowed = false), onBack = {},
                onNotificationSettings = { openedSettings++ })
        } }
        compose.onNodeWithText("系统通知未允许，收不到提醒").assertIsDisplayed()
        compose.onNodeWithText("通知设置").performClick()
        assertEquals(1, openedSettings)
    }

    @Test fun unpairAsksForConfirmationAndOnlyTheConfirmCallsUnpair() {
        var unpaired = 0
        var back = 0
        compose.setContent { EnsoTheme { SettingsScreen(opened(), onBack = { back++ }, onUnpair = { unpaired++ }) } }
        compose.onNodeWithText("解绑这台手机").performClick()
        compose.onNodeWithText("解绑这台手机？").assertIsDisplayed()
        compose.onNodeWithText("取消").performClick()
        assertEquals(0, unpaired)
        compose.onNodeWithText("解绑这台手机").performClick()
        compose.onNodeWithText("确认解绑").performClick()
        assertEquals(1, unpaired)
        assertEquals(0, back)
    }

    @Test fun unpairedShowsConnectInsteadOfAnInventedDevice() {
        var paired = 0
        compose.setContent { EnsoTheme {
            SettingsScreen(CompanionState().settingsUi(notificationsAllowed = false), onBack = {}, onPair = { paired++ })
        } }
        compose.onNodeWithText("尚未配对").assertIsDisplayed()
        compose.onNodeWithText("已配对电脑").assertDoesNotExist()
        compose.onNodeWithText("尚未连接").assertIsDisplayed()
        compose.onNodeWithText("配对后由电脑决定读写权限").assertIsDisplayed()
        compose.onNodeWithText("解绑这台手机").assertDoesNotExist()
        compose.onNodeWithContentDescription("后台提醒").assertIsDisplayed()
        compose.onNodeWithText("连接电脑").performClick()
        assertEquals(1, paired)
    }
}
