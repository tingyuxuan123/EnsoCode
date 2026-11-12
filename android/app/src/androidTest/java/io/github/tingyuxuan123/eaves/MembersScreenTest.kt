package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.tingyuxuan123.eaves.mirror.DesktopBotChat
import io.github.tingyuxuan123.eaves.mirror.DesktopBotInboxItem
import io.github.tingyuxuan123.eaves.mirror.DesktopBotMember
import io.github.tingyuxuan123.eaves.mirror.DesktopBotsState
import io.github.tingyuxuan123.eaves.mirror.DesktopGroupEntry
import io.github.tingyuxuan123.eaves.mirror.BotThreadCommand
import io.github.tingyuxuan123.eaves.mirror.DesktopBotThreadAction
import io.github.tingyuxuan123.eaves.mirror.DesktopBotGroupCreate
import io.github.tingyuxuan123.eaves.mirror.DesktopBotArtifact
import io.github.tingyuxuan123.eaves.mirror.DesktopBotArtifacts
import io.github.tingyuxuan123.eaves.mirror.DesktopBotArtifactTarget
import io.github.tingyuxuan123.eaves.mirror.DesktopFilesState
import io.github.tingyuxuan123.eaves.mirror.DesktopFileEntry
import io.github.tingyuxuan123.eaves.mirror.DesktopFileChunk
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.SessionCommandPhase
import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.pair.SessionAsk
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.MembersScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

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
        compose.onNodeWithText("1 位成员 · 1 个群聊").assertIsDisplayed()
        compose.onNodeWithText("收件箱").assertIsDisplayed()
        compose.onNodeWithText("请求批准", substring = true).assertIsDisplayed()
        compose.onNodeWithText("请求运行 pnpm test").assertIsDisplayed()
        compose.onNodeWithText("阿全").assertIsDisplayed()
        compose.onNodeWithText("全栈工程师").assertIsDisplayed()
        compose.onNodeWithText("请求运行 pnpm test").performClick()
        compose.runOnIdle { assertEquals("c1", opened) }
        compose.onNodeWithContentDescription("返回成员列表").assertIsDisplayed()
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
        compose.onNodeWithText("收件箱").assertDoesNotExist()
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
        compose.onNodeWithContentDescription("停止").performClick()
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
        compose.onNodeWithContentDescription("返回成员列表").performClick()
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
        compose.onNodeWithContentDescription("话题").performClick()
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
        compose.onNodeWithText("线程：调查方案", substring = true).assertIsDisplayed()
        compose.onNodeWithText("新线程").assertDoesNotExist()
    }

    @Test fun threadCapabilityAbsentHasNoEntryAndReadonlyCannotSwitchOrCreate() {
        val state = mutableStateOf(bots)
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, onBack = {}, onOpenChat = {}, onLoadOlder = { _, _ -> }, writable = false,
                onThreadChange = { _, _, _, _ -> error("Readonly") })
        } }
        compose.onNodeWithText("修复登录").performClick()
        compose.onNodeWithContentDescription("话题").assertDoesNotExist()
        compose.runOnIdle { state.value = bots.copy(threadsEnabled = true, threads = listOf(
            chat.copy(id = "topic", parentId = "c1", title = "旧话题", threadTitle = "旧话题"))) }
        compose.onNodeWithContentDescription("话题").performClick()
        compose.onNodeWithText("旧话题").assertIsNotEnabled()
        compose.onNodeWithText("新线程").assertIsNotEnabled()
    }

    @Test fun directChatSubscribesToTheAdvertisedSessionAndShowsItsActualReply() {
        val member = bots.members.single()
        val direct = DesktopBotChat("dm", "direct", "私聊", listOf(member.id), null, 1_700_000_000_000, 0,
            sessions = mapOf(member.id to "cv"))
        val opened = mutableListOf<String?>()
        val answer = SessionMessage(0, "assistant", listOf(buildJsonObject { put("type", "text"); put("text", "测试报告已经生成。") }))
        val session = DesktopSessionState(SessionTimeline("cv", messages = listOf(answer)), loading = false)
        compose.setContent { EnsoTheme {
            MembersScreen(bots.copy(inbox = emptyList(), chats = listOf(direct)), {}, {}, { _, _ -> },
                session = session, onSelectSession = { opened.add(it) })
        } }
        compose.onNodeWithText("阿全").performClick()
        compose.onNodeWithText("测试报告已经生成。").assertIsDisplayed()
        compose.onNodeWithContentDescription("返回成员列表").performClick()
        compose.runOnIdle { assertEquals(listOf("cv", null), opened) }
    }

    @Test fun delegatedInboxQuestionUsesItsExactConversationInsteadOfTheMembersCurrentSession() {
        val selected = mutableListOf<String?>()
        val answers = mutableListOf<Pair<String, String>>()
        val inbox = DesktopBotInboxItem("delegated", "ask", "c1", "b1", "选哪个方案？", 1000, false,
            conversationId = "delegated-session")
        val session = DesktopSessionState(SessionTimeline("delegated-session", asks = listOf(
            SessionAsk("question", "选哪个方案？", listOf("方案A", "方案B"), selectionOnly = true))), loading = false)
        compose.setContent { EnsoTheme {
            MembersScreen(bots.copy(inbox = listOf(inbox), chats = listOf(chat.copy(sessions = mapOf("b1" to "newer-session")))),
                {}, {}, { _, _ -> }, writable = true, session = session, onSelectSession = { selected.add(it) },
                onAsk = { request, answer -> answers.add(request to answer) })
        } }
        compose.onNodeWithText("选哪个方案？").performClick()
        compose.runOnIdle { assertEquals(listOf("delegated-session"), selected) }
        compose.onNodeWithText("方案A").performClick()
        compose.onNodeWithText("回答").performClick()
        compose.runOnIdle { assertEquals(listOf("question" to "方案A"), answers) }
    }

    @Test fun memberArtifactOpensTheRealMarkdownUsingOnlyTheDesktopFileId() {
        val member = bots.members.single()
        val direct = DesktopBotChat("dm", "direct", "", listOf(member.id), null, 1000, 0,
            sessions = mapOf(member.id to "cv"))
        val answer = SessionMessage(1, "assistant", listOf(buildJsonObject { put("type", "text"); put("text", "报告已生成。") }))
        val session = DesktopSessionState(SessionTimeline("cv", messages = listOf(answer)), loading = false)
        val target = DesktopBotArtifactTarget("dm", conversationId = "cv", messageIndex = 1)
        val artifact = DesktopBotArtifact("reports/report.md", "report.md", 12, "markdown")
        val state = mutableStateOf(bots.copy(inbox = emptyList(), chats = listOf(direct),
            artifacts = DesktopBotArtifacts(target, SessionCommandPhase.Observed, listOf(artifact))))
        val lists = mutableListOf<DesktopBotArtifactTarget>()
        val reads = mutableListOf<Triple<DesktopBotArtifactTarget, String, Long>>()
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, {}, {}, { _, _ -> }, session = session, onArtifacts = {},
                onListBotFiles = { lists.add(it) }, onReadBotFile = { owner, id, offset -> reads.add(Triple(owner, id, offset)) })
        } }
        compose.onNodeWithText(member.name).performClick()
        compose.onNodeWithText("report.md").performClick()
        compose.runOnIdle {
            assertEquals(listOf(target), lists)
            state.value = state.value.copy(filesTarget = target, files = DesktopFilesState(entries = listOf(
                DesktopFileEntry("opaque-file", "report.md", 12, artifact.rel))))
        }
        compose.runOnIdle {
            assertEquals(listOf(Triple(target, "opaque-file", 0L)), reads)
            val data = "# 回归通过".toByteArray()
            state.value = state.value.copy(files = state.value.files?.copy(
                chunk = DesktopFileChunk("opaque-file", "report.md", data.size.toLong(), 0, data)))
        }
        compose.onNodeWithText("回归通过").assertIsDisplayed()
    }

    @Test fun groupCreateOpensOnlyAfterTheDesktopDirectoryContainsTheReceiptId() {
        val member = DesktopBotMember("b2", "小测", "测试", "#16a34a", "idle")
        val state = mutableStateOf(bots.copy(groupCreateEnabled = true, members = bots.members + member))
        val opened = mutableListOf<String>()
        val submitted = mutableListOf<Triple<String, List<String>, String>>()
        compose.setContent { EnsoTheme {
            MembersScreen(state.value, {}, { opened.add(it) }, { _, _ -> }, writable = true,
                onCreateGroup = { name, ids, boss -> submitted.add(Triple(name, ids, boss)) })
        } }
        compose.onNodeWithText("新群聊").performClick()
        compose.onNodeWithText("群聊名称").performTextReplacement("安卓测试群")
        val checkBox = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Checkbox)
        compose.onNode(hasText("阿全") and checkBox).performScrollTo().performClick()
        compose.onNode(hasText("小测") and checkBox).performScrollTo().performClick()
        compose.onNodeWithText("创建群聊").performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(listOf(Triple("安卓测试群", listOf("b1", "b2"), "b1")), submitted) }
        val attempt = DesktopBotGroupCreate("request", "安卓测试群", listOf("b1", "b2"), "b1", SessionCommandPhase.Observed, "new")
        compose.runOnIdle { state.value = state.value.copy(groupCreate = attempt) }
        compose.onNodeWithText("正在等待群聊目录同步…").assertIsDisplayed()
        assertEquals(emptyList<String>(), opened)
        compose.runOnIdle { state.value = state.value.copy(chats = listOf(chat.copy(id = "new", title = "安卓测试群"))) }
        compose.onNodeWithContentDescription("返回成员列表").assertIsDisplayed()
        assertEquals(listOf("new"), opened)
    }
}
