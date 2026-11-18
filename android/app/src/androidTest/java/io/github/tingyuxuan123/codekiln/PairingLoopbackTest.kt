package io.github.tingyuxuan123.eaves

import android.graphics.Bitmap
import android.app.Notification
import android.app.NotificationManager
import android.os.PowerManager
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import android.accessibilityservice.AccessibilityServiceInfo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.mirror.AndroidPairCredentialStore
import io.github.tingyuxuan123.eaves.mirror.RelayPairingClient
import io.github.tingyuxuan123.eaves.pair.PairEncoding
import kotlinx.coroutines.runBlocking
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Explicit debug-only adb reverse fixture. Never run against a user's pairing. */
@RunWith(AndroidJUnit4::class)
class PairingLoopbackTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun claimAndShowAuthenticatedCatalog() {
        val encoded = InstrumentationRegistry.getArguments().getString("eavesPairInviteB64")
        assumeTrue("Run with a disposable loopback invite", BuildConfig.DEBUG && encoded != null)
        val invite = PairEncoding.fromBase64Url(requireNotNull(encoded)).toString(Charsets.UTF_8)
        // The checked test runner starts with an isolated emulator install, not an existing pair.
        assertNull(store().load())
        compose.onNodeWithText("连接电脑").performClick()
        compose.onNodeWithContentDescription("配对链接").performTextInput(invite)
        compose.onNodeWithText("配对").performClick()
        await("已连接")
        assertEquals(1, store().load()?.replayVersion)
        screenshot("pair-connected-light.png")
        compose.onNodeWithContentDescription("关闭").performClick()
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        await("Fake host demo")
        compose.onNodeWithText("Fake host demo").assertIsDisplayed()
        screenshot("pair-catalog-light.png")
    }

    @Test fun restoreAfterProcessRestartAndUnpair() {
        assumeTrue("Run after the loopback claim in a new process", BuildConfig.DEBUG &&
            InstrumentationRegistry.getArguments().getString("eavesPairRestore") == "1")
        val saved = requireNotNull(store().load())
        assertEquals(InstrumentationRegistry.getArguments().getString("eavesPairExpectedId"), saved.pairId)
        require(saved.relayUrl.startsWith("http://127.0.0.1:"))
        assertEquals(1, saved.replayVersion)
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        await("Fake host demo")
        screenshot("pair-catalog-dark.png")
        val sessionFlow = InstrumentationRegistry.getArguments().getString("eavesSessionFlow") == "1"
        if (sessionFlow) {
            compose.onNodeWithText("Fake host demo").performClick()
            await("它想运行一条命令")
            compose.onNodeWithText("$ echo fixture (not executed)").assertIsDisplayed()
            screenshot("session-approval-dark.png")
            compose.onNodeWithText("允许").performClick()
            await("Which fixture report format?")
            compose.onNodeWithText("Short").performClick()
            screenshot("session-ask-dark.png")
            compose.onNodeWithText("回答").performClick()
            await("Short fixture report complete.")
            screenshot("session-complete-dark.png")
            compose.onNodeWithContentDescription("会话消息").performTextInput("Hold this fixture turn.")
            compose.onNodeWithContentDescription("发送").performClick()
            compose.waitUntil(20_000) {
                compose.onAllNodesWithText("Hold this fixture turn.").fetchSemanticsNodes().size == 1 &&
                    compose.onAllNodesWithText("继续说，会排进队列").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithContentDescription("会话消息").performTextInput("Fixture steer from Android.")
            screenshot("session-steer-dark.png")
            compose.onNodeWithText("插话").performClick()
            compose.waitUntil(20_000) {
                compose.onAllNodesWithText("Fixture steer from Android.").fetchSemanticsNodes().size == 1 &&
                    compose.onAllNodesWithText("继续说，会排进队列").fetchSemanticsNodes().isNotEmpty()
            }
            queue("Queue original.", "排队中 · 1 条")
            compose.onNodeWithText("Queue original.").performClick()
            screenshot("session-queue-dark.png")
            compose.onNodeWithText("编辑").performClick()
            compose.onNodeWithContentDescription("排队消息正文").performTextReplacement("Queue edited.")
            compose.onNodeWithText("保存").performClick()
            awaitAbsent("编辑排队消息")
            await("Queue edited.")
            compose.onNodeWithText("立即插话").performClick()
            awaitAbsent("排队中 · 1 条")
            await("Queue edited.")
            queue("Queue to delete.", "排队中 · 1 条")
            compose.onNodeWithText("Queue to delete.").performClick()
            compose.onNodeWithText("删除").performClick()
            compose.onNodeWithText("确认删除").performClick()
            awaitAbsent("排队中 · 1 条")
            queue("Hold queued fixture turn.", "排队中 · 1 条")
            compose.onNodeWithText("Hold queued fixture turn.").performClick()
            compose.onNodeWithText("打断并发送").performClick()
            compose.onNodeWithText("确认打断并发送").performClick()
            awaitAbsent("排队中 · 1 条")
            await("Hold queued fixture turn.")
            compose.onNodeWithContentDescription("停止").performClick()
            await("Fixture turn stopped")
            compose.onNodeWithContentDescription("发送").assertIsDisplayed()
            compose.onNodeWithContentDescription("打开任务列表").performClick()
            compose.onNodeWithText("新任务").performClick()
            compose.onNodeWithContentDescription("打开新任务设置").performClick()
            await("新任务设置")
            compose.onNodeWithContentDescription("切换项目").performClick()
            compose.onNodeWithText("Fixture workspace").performClick()
            compose.onNodeWithText("Fixture launch model").performClick()
            compose.onNodeWithText("中").performClick()
            compose.onNodeWithText("自动接受编辑").performScrollTo().performClick()
            screenshot("new-config-dark.png", screen = true)
            compose.onNodeWithContentDescription("关闭新任务设置").performClick()
            compose.onNodeWithContentDescription("任务描述").performTextInput("Create from Android fixture.")
            compose.onNodeWithContentDescription("发送").performClick()
            await("Fixture running: launch-model · medium · auto-edits")
            screenshot("new-task-running-dark.png")
            compose.onNodeWithContentDescription("停止").performClick()
            await("Fixture turn stopped")
            compose.onNodeWithContentDescription("打开任务列表").performClick()
        }
        compose.onNodeWithText("连接电脑").performClick()
        await("已连接")
        compose.onNodeWithText("解绑电脑").performClick()
        compose.onNodeWithText("确认解绑").performClick()
        await("或粘贴配对链接")
        assertNull(store().load())
    }

    @Test fun cleanupLoopbackFixture() = runBlocking {
        val expected = InstrumentationRegistry.getArguments().getString("eavesPairCleanup")
        assumeTrue("Cleanup only a specifically named disposable fixture", BuildConfig.DEBUG && expected != null)
        val credentials = store().load() ?: return@runBlocking
        require(credentials.pairId == expected && credentials.relayUrl.startsWith("http://127.0.0.1:"))
        try { RelayPairingClient(allowLoopbackHttp = true).revoke(credentials) }
        finally { store().clear(credentials.pairId) }
    }

    @Test fun backgroundWatchPostsAndOpensAuthenticatedTask() {
        val args = InstrumentationRegistry.getArguments()
        val expected = args.getString("eavesWatchPairId")
        assumeTrue(BuildConfig.DEBUG && expected != null)
        val saved = requireNotNull(store().load())
        require(saved.pairId == expected && saved.relayUrl.startsWith("http://127.0.0.1:"))
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val manager = context.getSystemService(NotificationManager::class.java)
        val power = context.getSystemService(PowerManager::class.java)
        val controller = (compose.activity.application as EavesApplication).companion
        try {
            compose.onNodeWithContentDescription("打开任务列表").performClick()
            compose.onNodeWithText("连接电脑").performClick()
            await("已连接")
            compose.onNodeWithText("开启后台提醒").performScrollTo().performClick()
            await("停止后台连接")
            until("foreground-service notification") { manager.activeNotifications.any { it.id == LinkNotifications.SERVICE_ID } }
            compose.onNodeWithContentDescription("关闭").performClick()
            await("Fake host demo")
            val watchedTaskId = controller.state.value.link.catalog.single { it.title == "Fake host demo" }.id
            compose.onNodeWithText("Fake host demo").performClick()
            await("它想运行一条命令")
            assertTrue(manager.activeNotifications.none { it.notification.channelId == LinkNotifications.ATTENTION_CHANNEL })
            compose.onNodeWithText("允许").performClick()
            await("Which fixture report format?")
            compose.onNodeWithText("Short").performClick()
            compose.onNodeWithText("回答").performClick()
            await("Short fixture report complete.")
            compose.onNodeWithContentDescription("会话消息").performTextInput("Hold notification fixture.")
            compose.onNodeWithContentDescription("发送").performClick()
            await("继续说，会排进队列")
            // Leave the active session; catalog notification must work without a selected body stream.
            compose.onNodeWithContentDescription("打开任务列表").performClick()
            compose.waitUntil(12_000) { controller.state.value.link.session == null }
            shell("input keyevent KEYCODE_SLEEP")
            until("display off and UI background") { !power.isInteractive && !controller.uiVisible.value }
            until("approval notification while the screen is off") {
                manager.activeNotifications.any { it.notification.channelId == LinkNotifications.ATTENTION_CHANNEL }
            }
            assertEquals(LinkPhase.Online, controller.state.value.link.phase)
            assertTrue(controller.state.value.link.session == null)
            val posted = manager.activeNotifications.single { it.notification.channelId == LinkNotifications.ATTENTION_CHANNEL }.notification
            assertEquals("1 个操作待审批", posted.extras.getString(Notification.EXTRA_TEXT))
            assertEquals(Notification.VISIBILITY_PRIVATE, posted.visibility)
            assertTrue(posted.actions.isNullOrEmpty())
            assertFalse(posted.toString().contains("echo background fixture"))
            shell("input keyevent KEYCODE_WAKEUP")
            shell("wm dismiss-keyguard")
            until("display awake") { power.isInteractive }
            shell("cmd statusbar expand-notifications")
            clickNotification("1 个操作待审批")
            compose.waitUntil(20_000) {
                controller.uiVisible.value && controller.state.value.link.session?.timeline?.sessionId == watchedTaskId
            }
            // Instrumentation can keep the shade visible even after SystemUI dispatched the card intent.
            shell("cmd statusbar collapse")
            await("$ echo background fixture (not executed)")
            screenshot("watch-opened.png")
            compose.onNodeWithContentDescription("打开任务列表").performClick()
            compose.onNodeWithText("连接电脑").performClick()
            await("已连接")
            val ongoing = manager.activeNotifications.single { it.id == LinkNotifications.SERVICE_ID }.notification
            ongoing.actions.single { it.title.toString() == "停止后台连接" }.actionIntent.send()
            until("foreground service and task notifications cleared") {
                manager.activeNotifications.none { it.id == LinkNotifications.SERVICE_ID || it.notification.channelId == LinkNotifications.ATTENTION_CHANNEL }
            }
            assertEquals(LinkPhase.Online, controller.state.value.link.phase)
            compose.onNodeWithText("解绑电脑").performClick()
            compose.onNodeWithText("确认解绑").performClick()
            await("或粘贴配对链接")
            assertNull(store().load())
        } finally {
            shell("input keyevent KEYCODE_WAKEUP")
            shell("wm dismiss-keyguard")
            shell("cmd statusbar collapse")
        }
    }

    private fun shell(command: String) {
        val descriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
    }

    private fun until(label: String, check: () -> Boolean) {
        val end = SystemClock.uptimeMillis() + 20_000L
        while (SystemClock.uptimeMillis() < end) {
            if (check()) return
            SystemClock.sleep(100)
        }
        error("Timed out waiting for $label")
    }

    private fun clickNotification(body: String) {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val flags = automation.serviceInfo.flags
        automation.serviceInfo = automation.serviceInfo.apply { this.flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS }
        try {
            fun find(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
                if (node.isVisibleToUser && node.text?.toString() == body) return node
                for (index in 0 until node.childCount) node.getChild(index)?.let(::find)?.let { return it }
                return null
            }
            until("notification tap") {
                val match = automation.windows.firstNotNullOfOrNull { it.root?.let(::find) }
                val target = generateSequence(match) { it.parent }.firstOrNull { it.isClickable } ?: return@until false
                val bounds = android.graphics.Rect().also(target::getBoundsInScreen)
                val screen = automation.takeScreenshot()
                if (screen != null) try {
                    if (bounds.width() in 1..screen.width && bounds.height() in 1..(screen.height / 3) &&
                        bounds.left >= 0 && bounds.top >= 0 && bounds.right <= screen.width && bounds.bottom <= screen.height) {
                        val card = Bitmap.createBitmap(screen, bounds.left, bounds.top, bounds.width(), bounds.height())
                        try {
                            val context = InstrumentationRegistry.getInstrumentation().targetContext
                            File(context.cacheDir, "watch-notification.png").outputStream().use { card.compress(Bitmap.CompressFormat.PNG, 100, it) }
                        } finally { if (card !== screen) card.recycle() }
                    }
                } finally { screen.recycle() }
                target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            }
        } finally { automation.serviceInfo = automation.serviceInfo.apply { this.flags = flags } }
    }

    private fun await(text: String) = compose.waitUntil(timeoutMillis = 20_000) {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun awaitAbsent(text: String) = compose.waitUntil(timeoutMillis = 20_000) {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isEmpty()
    }

    private fun queue(text: String, count: String) {
        compose.onNodeWithContentDescription("会话消息").performTextInput(text)
        compose.onNodeWithText("加入队列").performClick()
        await(count)
        await("继续说，会排进队列")
    }

    private fun store() = AndroidPairCredentialStore(InstrumentationRegistry.getInstrumentation().targetContext, allowLoopbackHttp = true)

    private fun screenshot(name: String, screen: Boolean = false) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = if (screen) requireNotNull(instrumentation.uiAutomation.takeScreenshot())
            else compose.onRoot().captureToImage().asAndroidBitmap()
        try {
            File(instrumentation.targetContext.cacheDir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        } finally { bitmap.recycle() }
    }
}
