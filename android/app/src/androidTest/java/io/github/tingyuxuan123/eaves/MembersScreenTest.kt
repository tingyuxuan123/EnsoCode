package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopBotChat
import io.github.tingyuxuan123.eaves.mirror.DesktopBotInboxItem
import io.github.tingyuxuan123.eaves.mirror.DesktopBotMember
import io.github.tingyuxuan123.eaves.mirror.DesktopBotsState
import io.github.tingyuxuan123.eaves.mirror.DesktopGroupEntry
import io.github.tingyuxuan123.eaves.mirror.BotThreadCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopBotThreadAction
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.MembersScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MembersScreenTest {
    @get:Rule val compose = createComposeRule()
    private val chat = DesktopBotChat("c1", "group", "修复登录", listOf("b1", "b2"), "b1",
        1_700_000_000_000, 12, lastText = "阿全：我先看日志")
    private val bots = DesktopBotsState(enabled = true,
        members = listOf(DesktopBotMember("b1", "阿全", "全栈工程师", "#888", "running")),
        inbox = listOf(DesktopBotInboxItem("k1", "approval", "c1", "b1", "请求运行 pnpm test", 1_700_000_000_000, false)),
        chats = listOf(chat))

    @Test fun inboxMembersAndChatsComeFromDesktopStateAndOpenTheChat() {
        var opened: String? = null
        val state = mutableStateOf(bots)
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, onBack = {}, onOpenChat = { opened = it }, onLoadOlder = { _, _ -> })
        } }
        compose.onNodeWithText("等你处理").assertIsDisplayed()
        compose.onNodeWithText("等你审批").assertIsDisplayed()
        compose.onNodeWithText("请求运行 pnpm test").assertIsDisplayed()
        compose.onNodeWithText("阿全").assertIsDisplayed()
        compose.onNodeWithText("全栈工程师").assertIsDisplayed()
        compose.onNodeWithText("修复登录").performClick()
        assertEquals("c1", opened)
        compose.runOnIdle { state.value = bots.copy(timelineChatId = "c1", timelineRequested = true,
            timeline = listOf(
                DesktopGroupEntry(1, "e1", 1_700_000_000_000, "human", "先看下登录报错", null),
                DesktopGroupEntry(2, "e2", 1_700_000_001_000, "bot", "我先看日志", "b1"))) }
        compose.onNodeWithText("先看下登录报错").assertIsDisplayed()
        compose.onNodeWithText("我先看日志").assertIsDisplayed()
    }

    @Test fun disabledBotModeExplainsItselfInsteadOfShowingEmptySections() {
        compose.setContent { EnsoTheme {
            MembersScreen(DesktopBotsState(enabled = false), onBack = {}, onOpenChat = {}, onLoadOlder = { _, _ -> })
        } }
        compose.onNodeWithText("桌面已关闭成员模式。开启后可在这里查看收件箱和群聊。").assertIsDisplayed()
        compose.onNodeWithText("等你处理").assertDoesNotExist()
    }

    @Test fun aRunningChatCanBeStoppedAndAMessageSentOnce() {
        val sent = mutableListOf<Pair<String, String>>()
        val stopped = mutableListOf<String>()
        val running = bots.copy(chatStates = mapOf("c1" to io.github.tingyuxuan123.eaves.mirror.DesktopBotChatState(
            "c1", "b2", emptyList(), 1, false)))
        val state = mutableStateOf(running)
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, onBack = {}, onOpenChat = {}, onLoadOlder = { _, _ -> },
                writable = true, onSend = { chatId, text, _ -> sent.add(chatId to text) },
                onStop = { chatId -> stopped.add(chatId) })
        } }
        compose.onNodeWithText("修复登录").performClick()
        compose.onNodeWithText("正在处理").assertIsDisplayed()
        compose.onNodeWithText("停止").performClick()
        assertEquals(listOf("c1"), stopped)
        compose.onNodeWithContentDescription("群聊消息").performTextInput(" 看下错误日志 ")
        compose.onNodeWithContentDescription("发送到成员").performClick()
        assertEquals(listOf("c1" to " 看下错误日志 "), sent)
        compose.runOnIdle { state.value = running.copy(
            send = io.github.tingyuxuan123.eaves.mirror.DesktopBotSendAttempt(
                "d1", "c1", "x", io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase.Unconfirmed)) }
        compose.onNodeWithText("发送未确认，请先检查桌面。").assertIsDisplayed()
    }

    @Test fun readOnlyMembersCanReadButCannotWrite() {
        compose.setContent { EnsoTheme {
            MembersScreen(bots, onBack = {}, onOpenChat = {}, onLoadOlder = { _, _ -> }, writable = false)
        } }
        compose.onNodeWithText("修复登录").performClick()
        compose.onNodeWithText("只读连接：可以查看，不能发送或停止。").assertIsDisplayed()
        compose.onNodeWithContentDescription("发送到成员").assertIsNotEnabled()
    }

    @Test fun sendKeepsDraftUntilItsReceiptAndDoesNotEraseEditsOrLoseItWhenClosingTheChat() {
        val state = mutableStateOf(bots)
        val sent = mutableListOf<Pair<String, String>>()
        var deliveryId: String? = null
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, onBack = {}, onOpenChat = {}, onLoadOlder = { _, _ -> },
                writable = true, onSend = { chatId, text, id -> sent.add(chatId to text); deliveryId = id })
        } }
        compose.onNodeWithText("修复登录").performClick()
        compose.onNodeWithContentDescription("群聊消息").performTextReplacement("  保留这份草稿  ")
        compose.onNodeWithContentDescription("发送到成员").performClick()
        assertEquals(listOf("c1" to "  保留这份草稿  "), sent)
        compose.onNodeWithContentDescription("群聊消息").assertTextEquals("  保留这份草稿  ")
        val waiting = io.github.tingyuxuan123.eaves.mirror.DesktopBotSendAttempt(
            requireNotNull(deliveryId), "c1", "保留这份草稿", io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase.Waiting)
        compose.runOnIdle { state.value = bots.copy(send = waiting) }
        compose.onNodeWithContentDescription("发送到成员").assertIsNotEnabled()
        compose.runOnIdle { state.value = bots.copy(send = waiting.copy(
            phase = io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase.Unconfirmed)) }
        compose.onNodeWithContentDescription("关闭会话").performClick()
        compose.onNodeWithText("修复登录").performClick()
        compose.onNodeWithContentDescription("群聊消息").assertTextEquals("  保留这份草稿  ")
        compose.onNodeWithContentDescription("群聊消息").performTextReplacement("后来编辑的草稿")
        compose.runOnIdle { state.value = bots.copy(send = waiting.copy(
            phase = io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase.Observed)) }
        compose.onNodeWithContentDescription("群聊消息").assertTextEquals("后来编辑的草稿")
    }

    @Test fun selectingAThreadWaitsForBothTheDirectoryAndMatchingResultBeforeOpeningIt() {
        val state = mutableStateOf(bots.copy(threadsEnabled = true,
            threads = listOf(chat.copy(id = "topic", parentId = "c1", title = "调查方案", threadTitle = "调查方案"))))
        val opened = mutableListOf<String>()
        val chosen = mutableListOf<Triple<BotThreadCommand, String?, String>>()
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, onBack = {}, onOpenChat = { opened.add(it) }, onLoadOlder = { _, _ -> },
                writable = true, onThreadChange = { _, command, id, expected -> chosen.add(Triple(command, id, expected)) })
        } }
        compose.onNodeWithText("修复登录").performClick()
        compose.onNodeWithText("话题").performClick()
        compose.onNodeWithText("调查方案").performClick()
        assertEquals(listOf(Triple(BotThreadCommand.Select, "topic", "c1")), chosen)
        assertEquals(listOf("c1"), opened)
        val attempt = DesktopBotThreadAction("request", "c1", BotThreadCommand.Select, "topic", SessionCommandPhase.Waiting)
        compose.runOnIdle { state.value = state.value.copy(threadAction = attempt,
            chats = listOf(chat.copy(activeThreadId = "topic"))) }
        compose.onNodeWithText("新线程").assertIsNotEnabled()
        assertEquals(listOf("c1"), opened)
        compose.runOnIdle { state.value = state.value.copy(threadAction = attempt.copy(
            phase = SessionCommandPhase.Observed, resultId = "topic")) }
        compose.waitUntil(10_000) { opened.lastOrNull() == "topic" }
        compose.onNodeWithText("调查方案").assertIsDisplayed()
        compose.onNodeWithText("新线程").assertDoesNotExist()
    }

    @Test fun threadCapabilityAbsentHasNoEntryAndReadonlyCannotSwitchOrCreate() {
        val state = mutableStateOf(bots)
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, onBack = {}, onOpenChat = {}, onLoadOlder = { _, _ -> }, writable = false,
                onThreadChange = { _, _, _, _ -> error("Readonly") })
        } }
        compose.onNodeWithText("修复登录").performClick()
        compose.onNodeWithText("话题").assertDoesNotExist()
        compose.runOnIdle { state.value = bots.copy(threadsEnabled = true, threads = listOf(
            chat.copy(id = "topic", parentId = "c1", title = "旧话题", threadTitle = "旧话题"))) }
        compose.onNodeWithText("话题").performClick()
        compose.onNodeWithText("旧话题").assertIsNotEnabled()
        compose.onNodeWithText("新线程").assertIsNotEnabled()
    }
}
