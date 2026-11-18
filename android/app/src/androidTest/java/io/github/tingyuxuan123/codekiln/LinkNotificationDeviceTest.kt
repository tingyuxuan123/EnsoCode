package io.github.tingyuxuan123.eaves

import android.Manifest
import android.content.Intent
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LinkNotificationDeviceTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun fabricatedNotificationCannotOpenAnotherSession() {
        compose.activityRule.scenario.onActivity { activity ->
            activity.startActivity(Intent(activity, MainActivity::class.java).setAction(LinkNotifications.OPEN)
                .putExtra(LinkNotifications.EXTRA_TOKEN, "not-an-active-lease")
                .putExtra(LinkNotifications.EXTRA_SESSION, "arbitrary-session"))
        }
        compose.onNodeWithContentDescription("打开任务列表").assertIsDisplayed()
        compose.onNodeWithContentDescription("会话消息").assertDoesNotExist()
        compose.onNodeWithText("arbitrary-session").assertDoesNotExist()
    }

    @Test fun foregroundServiceIsPrivateAndDeclaresBothPermissions() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val info = context.packageManager.getServiceInfo(android.content.ComponentName(context, LinkService::class.java), 0)
        assertFalse(info.exported)
        val manifest = context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_PERMISSIONS)
        val requested = requireNotNull(manifest.requestedPermissions)
        assertTrue(requested.contains(Manifest.permission.FOREGROUND_SERVICE))
        assertTrue(requested.contains("android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING"))
    }
}
