package io.github.tingyuxuan123.eaves

import android.graphics.Bitmap
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.github.tingyuxuan123.eaves.mirror.AndroidPairCredentialStore
import io.github.tingyuxuan123.eaves.mirror.GoalCommand
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.mirror.activeBotThread
import io.github.tingyuxuan123.eaves.pair.PairEncoding
import java.io.File
import android.os.Build
import java.security.MessageDigest
import android.util.Base64
import io.github.tingyuxuan123.eaves.mirror.SessionImage
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in real Electron/Main/worker fixture. The Node driver owns the isolated profile and relay. */
@RunWith(AndroidJUnit4::class)
class RealDesktopLoopbackTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val args get() = InstrumentationRegistry.getArguments()
    private val marker = "Android desktop smoke first turn."

    @Test fun pairCreateAndReceive() {
        val encoded = args.getString("eavesDesktopInviteB64")
        assumeTrue("Only a disposable real-desktop fixture", BuildConfig.DEBUG && encoded != null)
        assertNull(store().load())
        val invite = PairEncoding.fromBase64Url(requireNotNull(encoded)).toString(Charsets.UTF_8)
        require(invite.contains("127.0.0.1"))
        compose.onNodeWithText("连接电脑").performClick()
        compose.onNodeWithContentDescription("配对链接").performTextInput(invite)
        compose.onNodeWithText("配对").performClick()
        await("已连接")
        assertEquals(1, store().load()?.replayVersion)
        compose.onNodeWithContentDescription("关闭").performClick()
        compose.onNodeWithContentDescription("打开新任务设置").performClick()
        await("新任务设置")
        compose.onNodeWithContentDescription("切换项目").performClick()
        await("selected-project")
        compose.onNodeWithText("selected-project").performClick()
        await("Local selected model")
        compose.onNodeWithText("Local selected model").performClick()
        compose.onNodeWithText("中").performClick()
        compose.onNodeWithText("自动接受编辑").performScrollTo().performClick()
        screenshot("desktop-config.png")
        compose.onNodeWithContentDescription("关闭新任务设置").performClick()
        compose.onNodeWithContentDescription("任务描述").performTextInput(marker)
        compose.onNodeWithContentDescription("发送").performClick()
        await("fake-ok")
        screenshot("desktop-timeline.png")
    }

    @Test fun restoreAndOpen() {
        val expected = args.getString("eavesDesktopExpectedId")
        assumeTrue("Only after real-desktop claim", BuildConfig.DEBUG && expected != null)
        val saved = requireNotNull(store().load())
        assertEquals(expected, saved.pairId)
        assertEquals(1, saved.replayVersion)
        require(saved.relayUrl.startsWith("http://127.0.0.1:"))
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        val taskId = requireNotNull(args.getString("eavesDesktopTaskId"))
        try {
            compose.waitUntil(45_000) { compose.onAllNodes(hasTestTag("task-$taskId")).fetchSemanticsNodes().isNotEmpty() }
        } catch (error: ComposeTimeoutException) {
            screenshot("desktop-restore-failure.png")
            val link = (compose.activity.application as EavesApplication).companion.state.value.link
            throw AssertionError("Expected task $taskId; phase=${link.phase}, readOnly=${link.readOnly}, catalog=${link.catalog.map { it.id to it.title }}, projects=${link.projects?.size}", error)
        }
        compose.onNodeWithTag("task-$taskId").performScrollTo().assertTextContains("selected-project").performClick()
        await("fake-ok")
        screenshot("desktop-restored.png")
    }

    @Test fun verifyApprovalAndUnpair() {
        val expected = args.getString("eavesDesktopExpectedId")
        val taskId = args.getString("eavesDesktopTaskId")
        assumeTrue("Only the disposable fixture may exercise approval", BuildConfig.DEBUG && expected != null && taskId != null)
        val saved = requireNotNull(store().load())
        require(saved.relayUrl.startsWith("http://127.0.0.1:") && saved.pairId == expected)
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.waitUntil(45_000) { compose.onAllNodes(hasTestTag("task-$taskId")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("task-$taskId").performClick()
        await("fake-ok")
        val tool = requireNotNull(args.getString("eavesDesktopTool"))
        require(tool == "powershell" || tool == "bash")
        compose.onNodeWithContentDescription("会话消息").performTextInput("""[[tool:$tool {"command":"echo EAVES_APPROVAL_PROBE"}]]""")
        compose.onNodeWithContentDescription("发送").performClick()
        await("$ echo EAVES_APPROVAL_PROBE")
        screenshot("desktop-approval.png")
        compose.onNodeWithText("拒绝").performClick()
        compose.waitUntil(45_000) {
            compose.onAllNodesWithText("$ echo EAVES_APPROVAL_PROBE").fetchSemanticsNodes().isEmpty() &&
                compose.onAllNodes(hasContentDescription("发送")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithText("连接电脑").performClick()
        await("已连接")
        compose.onNodeWithText("解绑电脑").performClick()
        compose.onNodeWithText("确认解绑").performClick()
        await("或粘贴配对链接")
        assertNull(store().load())
    }

    @Test fun verifyQueueDrainsAfterCurrentTurn() {
        val expected = args.getString("eavesDesktopExpectedId")
        val taskId = args.getString("eavesDesktopTaskId")
        assumeTrue("Only the disposable desktop queue fixture", BuildConfig.DEBUG && expected != null && taskId != null &&
            args.getString("eavesDesktopQueue") == "1")
        val saved = requireNotNull(store().load())
        require(saved.relayUrl.startsWith("http://127.0.0.1:") && saved.pairId == expected)
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.waitUntil(45_000) { compose.onAllNodes(hasTestTag("task-$taskId")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("task-$taskId").performClick()
        await("fake-ok")
        compose.onNodeWithContentDescription("会话消息").performTextInput("Android queue hold first turn.")
        compose.onNodeWithContentDescription("发送").performClick()
        await("继续说，会排进队列")
        compose.onNodeWithContentDescription("会话消息").performTextInput("Android queue smoke original.")
        compose.onNodeWithText("加入队列").performClick()
        await("排队中 · 1 条")
        await("继续说，会排进队列")
        compose.onNodeWithText("Android queue smoke original.").performClick()
        compose.onNodeWithText("编辑").performClick()
        compose.onNodeWithContentDescription("排队消息正文").performTextReplacement("Android queue smoke delivered.")
        compose.onNodeWithText("保存").performClick()
        compose.waitUntil(45_000) { compose.onAllNodesWithText("编辑排队消息").fetchSemanticsNodes().isEmpty() }
        screenshot("desktop-queue.png")
        compose.waitUntil(45_000) {
            compose.onAllNodesWithText("排队中 · 1 条").fetchSemanticsNodes().isEmpty() &&
                compose.onAllNodesWithText("Android queue smoke delivered.").fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test fun verifyImagePickedAndSent() {
        val expected = args.getString("eavesDesktopExpectedId")
        val taskId = args.getString("eavesDesktopTaskId")
        assumeTrue("Only disposable desktop image fixture on a PhotoPicker device", BuildConfig.DEBUG && Build.VERSION.SDK_INT >= 33 &&
            expected != null && taskId != null && args.getString("eavesDesktopImage") == "1")
        val saved = requireNotNull(store().load())
        require(saved.relayUrl.startsWith("http://127.0.0.1:") && saved.pairId == expected)
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.waitUntil(45_000) { compose.onAllNodes(hasTestTag("task-$taskId")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("task-$taskId").performClick()
        await("fake-ok")
        compose.onNodeWithContentDescription("发送").assertIsNotEnabled()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        PickerFixture(context.contentResolver).use { fixture ->
            val expectedImage = runBlocking { fixture.expectedFingerprint() }
            compose.onNodeWithContentDescription("添加图片").assertIsEnabled().performClick()
            fixture.selectInSystemPicker()
            compose.waitUntil(30_000) {
                compose.onAllNodes(hasContentDescription("待发送图片 1")).fetchSemanticsNodes().isNotEmpty()
            }
            compose.waitUntil(30_000) {
                val link = (compose.activity.application as EavesApplication).companion.state.value.link
                link.phase == LinkPhase.Online && link.session?.loading == false
            }
            compose.onNodeWithContentDescription("发送").assertIsEnabled()
            screenshot("desktop-image-draft.png", appOnly = true)
            compose.onNodeWithContentDescription("发送").performClick()
            compose.waitUntil(30_000) {
                compose.onAllNodes(hasContentDescription("待发送图片 1")).fetchSemanticsNodes().isEmpty()
            }
            val link = (compose.activity.application as EavesApplication).companion.state.value.link
            val part = requireNotNull(link.session).timeline.messages.last { it.role == "user" }.content.single { it["type"]?.toString() == "\"image\"" }
            val encoded = (part["data"] as kotlinx.serialization.json.JsonPrimitive).content
            val mime = (part["mimeType"] as kotlinx.serialization.json.JsonPrimitive).content
            assertEquals(expectedImage, SessionImage(encoded, mime).fingerprint)
            val sha = MessageDigest.getInstance("SHA-256").digest(Base64.decode(encoded, Base64.NO_WRAP)).joinToString("") { "%02x".format(it) }
            File(context.cacheDir, "desktop-image-proof.json").writeText("""{"mimeType":"$mime","sha256":"$sha"}""")
            screenshot("desktop-image-sent.png", appOnly = true)
        }
    }

    @Test fun verifyGoalLifecycle() {
        val expected = args.getString("eavesDesktopExpectedId")
        val taskId = args.getString("eavesDesktopTaskId")
        assumeTrue("Only the disposable desktop goal fixture", BuildConfig.DEBUG && expected != null && taskId != null &&
            args.getString("eavesDesktopGoal") == "1")
        val saved = requireNotNull(store().load())
        require(saved.relayUrl.startsWith("http://127.0.0.1:") && saved.pairId == expected)
        val controller = (compose.activity.application as EavesApplication).companion
        fun linkState() = controller.state.value.link.session?.takeIf { it.timeline.sessionId == taskId }
        fun observed(command: GoalCommand, status: String?) = compose.waitUntil(20_000) {
            linkState()?.let { session -> session.goalReady && session.goal?.status == status &&
                session.goalAttempt?.let { it.command == command && it.phase == SessionCommandPhase.Observed } == true } == true
        }
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.waitUntil(45_000) { compose.onAllNodes(hasTestTag("task-$taskId")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("task-$taskId").performClick()
        compose.waitUntil(45_000) { linkState()?.let { !it.loading && it.goalReady && it.timeline.status == "idle" } == true }
        assertNull(linkState()?.goal)

        val goalText = "Android queue hold first turn. Verify the goal lifecycle."
        compose.onNodeWithContentDescription("会话菜单").performClick()
        compose.onNodeWithText("设定目标").performClick()
        compose.onNodeWithContentDescription("目标完成条件").performTextInput(" $goalText ")
        screenshot("desktop-goal-set.png")
        compose.onNodeWithText("开始").performScrollTo().performClick()
        observed(GoalCommand.Set, "active")
        assertEquals(goalText, linkState()?.goal?.text)
        compose.waitUntil(20_000) { linkState()?.running == true }
        screenshot("desktop-goal-active.png")

        compose.onNodeWithText("暂停").performScrollTo().performClick()
        observed(GoalCommand.Pause, "paused")
        assertEquals(true, linkState()?.running) // Pause must not abort the held kickoff.
        screenshot("desktop-goal-paused.png")
        compose.waitUntil(45_000) { linkState()?.timeline?.status == "idle" }

        compose.onNodeWithText("继续").performScrollTo().performClick()
        observed(GoalCommand.Resume, "active")
        compose.waitUntil(20_000) { linkState()?.running == true }
        compose.onNodeWithText("清除目标").performScrollTo().performClick()
        compose.onNodeWithText("确认清除").performClick()
        observed(GoalCommand.Clear, null)
        assertEquals(true, linkState()?.running) // Clear must not abort the held resume.
        compose.waitUntil(45_000) { linkState()?.timeline?.status == "idle" }
        assertNull(linkState()?.goal)
    }

    @Test fun verifyBotSendAndStop() {
        val expected = args.getString("eavesDesktopExpectedId")
        val chatId = args.getString("eavesDesktopBotChat")
        assumeTrue("Only the disposable desktop Bot fixture", BuildConfig.DEBUG && expected != null && chatId != null)
        val saved = requireNotNull(store().load())
        require(saved.relayUrl.startsWith("http://127.0.0.1:") && saved.pairId == expected)
        val controller = (compose.activity.application as EavesApplication).companion
        fun bots() = controller.state.value.link.bots
        val title = "Android Bot smoke group"
        compose.onNodeWithContentDescription("打开任务列表").performClick()
        compose.onNodeWithText("成员").performClick()
        await(title)
        compose.onNodeWithText(title).performClick()
        compose.waitUntil(20_000) { bots()?.chatStates?.containsKey(chatId) == true }

        val input = compose.onNodeWithContentDescription("群聊消息")
        val send = compose.onNodeWithContentDescription("发送到成员")
        val first = "Android Bot smoke first message."
        input.performTextReplacement(first)
        send.assertIsEnabled().performClick()
        compose.waitUntil(20_000) { bots()?.send?.let { it.text == first && it.phase == SessionCommandPhase.Observed } == true }
        await("fake-ok")
        compose.waitUntil(20_000) { bots()?.chatStates?.get(chatId)?.current == null }

        val held = "Android queue hold first turn. Android Bot stop fixture."
        input.performTextReplacement(held)
        send.assertIsEnabled().performClick()
        compose.waitUntil(20_000) { bots()?.chatStates?.get(chatId)?.current != null }
        compose.onNodeWithText("停止").assertIsEnabled().performClick()
        compose.waitUntil(20_000) { bots()?.stop?.phase == SessionCommandPhase.Observed }
        assertNull(bots()?.chatStates?.get(chatId)?.current)

        if (args.getString("eavesDesktopBotThreads") == "1") {
            val rootId = requireNotNull(chatId)
            compose.onNodeWithText("话题").performClick()
            compose.onNodeWithText("新线程").performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(20_000) {
                val active = bots()?.activeBotThread(rootId)
                active?.parentId == rootId && bots()?.threadAction?.phase == SessionCommandPhase.Observed &&
                    bots()?.timelineChatId == active.id && bots()?.timelineLoading == false
            }
            val newTopic = requireNotNull(bots()?.activeBotThread(rootId))
            assertEquals(rootId, newTopic.parentId)
            assertEquals(emptyList<String>(), bots()?.timeline?.map { it.text })
            compose.onNodeWithText("话题").performClick()
            compose.onNodeWithText("主话题").performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(20_000) {
                bots()?.activeBotThread(rootId)?.id == rootId && bots()?.threadAction?.resultId == rootId &&
                    bots()?.timelineChatId == rootId && bots()?.timelineLoading == false
            }
            await(first)
        }
    }

    private fun await(text: String) = compose.waitUntil(45_000) {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun store() = AndroidPairCredentialStore(InstrumentationRegistry.getInstrumentation().targetContext, allowLoopbackHttp = true)

    private fun screenshot(name: String, appOnly: Boolean = false) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = if (appOnly) compose.onRoot().captureToImage().asAndroidBitmap()
            else requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        try {
            File(instrumentation.targetContext.cacheDir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        } finally { bitmap.recycle() }
    }
}
