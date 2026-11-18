package io.github.tingyuxuan123.eaves.mirror

import io.github.tingyuxuan123.eaves.pair.FrameReplay
import io.github.tingyuxuan123.eaves.pair.ReplayRole
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test

/** 成员功能：私聊会话映射、委派/进度、新对话、重试、收件箱忽略、建群、产物。 */
@OptIn(ExperimentalCoroutinesApi::class)
class DesktopBotMembersTest {
    // ── 私聊会话映射 ─────────────────────────────────────────────────────────

    @Test fun `chat sessions map each member to its conversation and bad pairs only drop themselves`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-chats", """"chats":[
                {"id":"c1","kind":"group","title":"Team","members":["b1","b2"],"bossBotId":"b1",
                 "updatedAt":0,"lastSeq":1,"sessions":{"b1":{"conversationId":"cv1"},
                 "b2":{"conversationId":"cv2","distilledTo":"x"},"b3":{"conversationId":""},
                 "b4":"cv4","b5":{}}},
                {"id":"c2","kind":"direct","title":"私聊","members":["b1"],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0},
                {"id":"c3","kind":"direct","title":"坏表","members":["b1"],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0,"sessions":["b1"]}]""")
            val chats = f.bots!!.chats
            // 坏的会话表整行不投影；缺省的会话表就是「还没开过」。
            assertEquals(listOf("c1", "c2"), chats.map { it.id })
            assertEquals(mapOf("b1" to "cv1", "b2" to "cv2"), chats[0].sessions)
            assertEquals(emptyMap<String, String>(), chats[1].sessions)
            assertTrue(f.commands().isEmpty())
        }
    }

    // ── 委派 / 进度 ─────────────────────────────────────────────────────────

    @Test fun `delegation and progress rows keep the structural fields the ui delegates on`() = runTest {
        fixture { f ->
            f.ready()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":6,"hasOlder":false,"entries":[
                {"seq":1,"id":"g1","at":10,"kind":"delegation","delegationId":"dg1","from":"b1","to":"b2",
                 "state":"running","summary":"修登录","taskId":"t1"},
                {"seq":2,"id":"g2","at":11,"kind":"delegation","delegationId":"dg2","from":"b1","to":"b3",
                 "state":"attempting"},
                {"seq":3,"id":"p1","at":12,"kind":"progress","botId":"b2","taskId":"t1","taskSeq":4,
                 "delegationId":"dg1","phase":"delivered","text":"已交付"},
                {"seq":4,"id":"b1","at":13,"kind":"bot","text":"收到","botId":"b2","conversationId":"cv2",
                 "turnId":"t"},
                {"seq":5,"id":"bad-delegation","at":14,"kind":"delegation","delegationId":"dg3",
                 "from":"b1","to":"b2"},
                {"seq":6,"id":"bad-progress","at":15,"kind":"progress","botId":"b2","text":"x"}]""")
            val timeline = f.bots!!.timeline
            // 缺必需结构字段的委派 / 进度行不作为半成品渲染。
            assertEquals(listOf(1L, 2L, 3L, 4L), timeline.map { it.seq })
            val delegation = timeline[0]
            assertEquals("delegation", delegation.kind)
            // 桌面的委派行只有 summary，手机统一投影成正文。
            assertEquals("修登录", delegation.text)
            assertEquals("dg1", delegation.delegationId)
            assertEquals("b1", delegation.from)
            assertEquals("b2", delegation.to)
            assertEquals("running", delegation.state)
            assertEquals("t1", delegation.taskId)
            assertNull(delegation.botId)
            // 不认识的委派状态原样保留，文案由 UI 兜底。
            assertEquals("attempting", timeline[1].state)
            assertEquals("", timeline[1].text)
            assertNull(timeline[1].taskId)
            val progress = timeline[2]
            assertEquals("progress", progress.kind)
            assertEquals("b2", progress.botId)
            assertEquals("t1", progress.taskId)
            assertEquals(4L, progress.taskSeq)
            assertEquals("dg1", progress.delegationId)
            assertEquals("delivered", progress.phase)
            assertEquals("已交付", progress.text)
            assertEquals("cv2", timeline[3].conversationId)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `system rows keep the new conversation divider and the retryable failure`() = runTest {
        fixture { f ->
            f.ready()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":5,"hasOlder":false,"entries":[
                {"seq":1,"id":"s1","at":1,"kind":"system","text":"新对话","newConversation":true},
                {"seq":2,"id":"s2","at":2,"kind":"system","text":"成员超时",
                 "failure":{"botId":"b2","conversationId":"cv2","mode":"resume"}},
                {"seq":3,"id":"s3","at":3,"kind":"system","text":"重试中","retryOf":"s2"},
                {"seq":4,"id":"s4","at":4,"kind":"system","text":"投递失败",
                 "failure":{"botId":"b2","mode":"deliver"}},
                {"seq":5,"id":"s5","at":5,"kind":"system","text":"坏失败",
                 "failure":{"botId":"b2","mode":"other"}}]""")
            val timeline = f.bots!!.timeline
            assertEquals(listOf(1L, 2L, 3L, 4L, 5L), timeline.map { it.seq })
            assertTrue(timeline[0].newConversation)
            assertEquals(DesktopGroupFailure("b2", "cv2", "resume"), timeline[1].failure)
            assertEquals("s2", timeline[2].retryOf)
            assertFalse(timeline[2].newConversation)
            assertEquals(DesktopGroupFailure("b2", null, "deliver"), timeline[3].failure)
            // 不认识的失败模式只让这一行不可重试，正文照常显示。
            assertNull(timeline[4].failure)
            assertEquals("坏失败", timeline[4].text)
            assertTrue(f.commands().isEmpty())
        }
    }

    // ── 新对话 ──────────────────────────────────────────────────────────────

    @Test fun `the new session capability only comes from an authenticated catalog`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"newSession":true,"bots":[]""")
            assertTrue(f.bots!!.newSessionEnabled)
            f.push("bot-catalog", """"enabled":true,"bots":[]""")
            assertFalse(f.bots!!.newSessionEnabled)
            f.push("bot-catalog", """"enabled":false,"newSession":true,"bots":[]""")
            assertFalse(f.bots!!.newSessionEnabled)
            f.push("bot-catalog", """"enabled":true,"newSession":"yes","bots":[]""")
            assertFalse(f.bots!!.newSessionEnabled)
        }
    }

    @Test fun `a new session request waits for its own result and never resets optimistically`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[
                {"seq":1,"id":"e1","at":1,"kind":"human","text":"first"}]""")
            f.link.requestBotNewSession("c1")
            f.link.requestBotNewSession("c1")
            runCurrent()
            val command = f.commands().single()
            assertEquals(setOf("type", "chatId", "requestId"), command.keys)
            assertEquals("bot-new-session", command["type"].linkString())
            assertEquals("c1", command["chatId"].linkString())
            val requestId = command["requestId"].linkString()!!
            assertEquals(DesktopBotNewSession(requestId, "c1", BotNewSessionPhase.Waiting),
                f.bots!!.newSession)
            // 时间线只有桌面推送能改，请求本身不动它。
            assertEquals(listOf(1L), f.bots!!.timeline.map { it.seq })
            f.push("bot-new-session-result", """"chatId":"c1","requestId":"$requestId","ok":true""")
            assertEquals(BotNewSessionPhase.Observed, f.bots!!.newSession!!.phase)
            assertNull(f.bots!!.newSession!!.error)
            assertEquals(listOf(1L), f.bots!!.timeline.map { it.seq })
        }
    }

    @Test fun `a busy group asks for confirmation once and the confirmed phase uses a new request id`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.requestBotNewSession("c1"); runCurrent()
            val first = f.commands().single()["requestId"].linkString()!!
            f.push("bot-new-session-result",
                """"chatId":"c1","requestId":"$first","ok":false,"needsConfirmation":true""")
            assertEquals(BotNewSessionPhase.NeedsConfirmation, f.bots!!.newSession!!.phase)
            assertNull(f.bots!!.newSession!!.error)
            // 别的聊天不能替当前这次确认，重复确认只发一次。
            f.link.confirmBotNewSession("c2")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            f.link.confirmBotNewSession("c1")
            f.link.confirmBotNewSession("c1")
            runCurrent()
            val confirmed = f.commands().single()
            assertEquals("bot-new-session", confirmed["type"].linkString())
            assertEquals("true", confirmed["confirmed"].toString())
            assertEquals("c1", confirmed["chatId"].linkString())
            val second = confirmed["requestId"].linkString()!!
            // 桌面按 requestId 去重：两阶段必须是两个请求标识。
            assertNotEquals(first, second)
            assertEquals(BotNewSessionPhase.Waiting, f.bots!!.newSession!!.phase)
            assertEquals(second, f.bots!!.newSession!!.requestId)
            // 第一阶段迟到的应答不再动第二阶段。
            f.push("bot-new-session-result", """"chatId":"c1","requestId":"$first","ok":true""")
            assertEquals(BotNewSessionPhase.Waiting, f.bots!!.newSession!!.phase)
            f.push("bot-new-session-result", """"chatId":"c1","requestId":"$second","ok":true""")
            assertEquals(BotNewSessionPhase.Observed, f.bots!!.newSession!!.phase)
            // 用户放弃确认后重新发第一次阶段：新请求取代待确认的那次，不会卡在 NeedsConfirmation。
            f.link.requestBotNewSession("c1"); runCurrent()
            assertEquals(BotNewSessionPhase.Waiting, f.bots!!.newSession!!.phase)
            assertNotEquals(second, f.bots!!.newSession!!.requestId)
        }
    }

    @Test fun `a silent new session turns unconfirmed and is never re-sent`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.requestBotNewSession("c1"); runCurrent()
            val requestId = f.bots!!.newSession!!.requestId
            f.commands()
            advanceTimeBy(14_900); runCurrent()
            assertEquals(BotNewSessionPhase.Waiting, f.bots!!.newSession!!.phase)
            advanceTimeBy(200); runCurrent()
            assertEquals(BotNewSessionPhase.Unconfirmed, f.bots!!.newSession!!.phase)
            assertTrue(f.commands().isEmpty())
            // 迟到的、仍匹配的应答依然结算这次尝试。
            f.push("bot-new-session-result",
                """"chatId":"c1","requestId":"$requestId","ok":false,"error":"session-busy"""")
            assertEquals(BotNewSessionPhase.Rejected, f.bots!!.newSession!!.phase)
            assertEquals("session-busy", f.bots!!.newSession!!.error)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `new session writes need capability visibility authority and a listed chat`() = runTest {
        // 没有 newSession 能力位。
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"bots":[]""")
            f.directory()
            f.link.requestBotNewSession("c1"); runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.newSession)
        }
        // 只读设备的写命令。
        fixture { f ->
            f.ready(readOnly = true); f.catalog(); f.directory()
            f.link.requestBotNewSession("c1"); runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.newSession)
        }
        // 隐藏的前台不发写命令。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); f.link.setVisible(true)
            f.link.requestBotNewSession("c1"); runCurrent()
            assertFalse(f.sentTypes().contains("bot-new-session"))
            assertNull(f.bots!!.newSession)
        }
        // 未知聊天、空聊天和越界聊天都不发。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.requestBotNewSession("unknown")
            f.link.requestBotNewSession("")
            f.link.requestBotNewSession("c".repeat(BOT_TEXT_LIMIT + 1))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.newSession)
        }
        // 已有 send / stop 等待时不再排队第二条写命令。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.sendBotMessage("c1", "hi"); runCurrent(); f.commands()
            f.link.requestBotNewSession("c1"); runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.newSession)
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"${f.bots!!.send!!.deliveryId}","ok":true""")
            f.link.stopBotChat("c1"); runCurrent(); f.commands()
            f.link.requestBotNewSession("c1"); runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.newSession)
        }
        // 断线后迟到的写命令不属于新一代。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); f.link.setVisible(true)
            f.link.requestBotNewSession("c1"); runCurrent()
            f.socket.failed(); runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.state.bots)
        }
    }

    // ── 重试 ────────────────────────────────────────────────────────────────

    @Test fun `a retry targets only a failure row of the open timeline`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":3,"hasOlder":false,"entries":[
                {"seq":1,"id":"h1","at":1,"kind":"human","text":"hi"},
                {"seq":2,"id":"s2","at":2,"kind":"system","text":"超时",
                 "failure":{"botId":"b1","conversationId":"cv1","mode":"resume"}},
                {"seq":3,"id":"s3","at":3,"kind":"system","text":"普通系统消息"}]""")
            // 人类行、没有 failure 的系统行、未知条目、别的聊天都不是重试目标。
            f.link.retryBotEntry("c1", "h1")
            f.link.retryBotEntry("c1", "s3")
            f.link.retryBotEntry("c1", "unknown")
            f.link.retryBotEntry("c2", "s2")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.retry)
            f.link.retryBotEntry("c1", "s2")
            f.link.retryBotEntry("c1", "s2")
            runCurrent()
            assertEquals(listOf("""{"type":"bot-retry","chatId":"c1","entryId":"s2"}"""), f.sent())
            assertEquals(DesktopBotRetry("c1", "s2", SessionCommandPhase.Waiting), f.bots!!.retry)
            // 别的聊天、别的条目都不是这次请求的应答。
            f.push("bot-retry-result", """"chatId":"c2","entryId":"s2","ok":true""")
            f.push("bot-retry-result", """"chatId":"c1","entryId":"s3","ok":true""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.retry!!.phase)
            f.push("bot-retry-result",
                """"chatId":"c1","entryId":"s2","ok":false,"error":"retry-unavailable"""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.retry!!.phase)
            assertEquals("retry-unavailable", f.bots!!.retry!!.error)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a silent retry turns unconfirmed and is never re-sent`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[
                {"seq":1,"id":"s1","at":1,"kind":"system","text":"超时",
                 "failure":{"botId":"b1","mode":"deliver"}}]""")
            f.link.retryBotEntry("c1", "s1"); runCurrent(); f.commands()
            advanceTimeBy(15_100); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.retry!!.phase)
            assertTrue(f.commands().isEmpty())
            f.push("bot-retry-result", """"chatId":"c1","entryId":"s1","ok":true""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.retry!!.phase)
        }
    }

    @Test fun `retry and new session coordinate with each other and with readonly hosts`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[
                {"seq":1,"id":"s1","at":1,"kind":"system","text":"超时",
                 "failure":{"botId":"b1","mode":"deliver"}}]""")
            f.link.requestBotNewSession("c1"); runCurrent(); f.commands()
            // 新对话还在等待时不再发重试。
            f.link.retryBotEntry("c1", "s1"); runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.retry)
            // 只读回执把链路降级，之后的写命令一律拒绝。
            val requestId = f.bots!!.newSession!!.requestId
            f.push("bot-new-session-result", """"chatId":"c1","requestId":"$requestId","ok":false,
                "error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(BotNewSessionPhase.Rejected, f.bots!!.newSession!!.phase)
            f.link.retryBotEntry("c1", "s1"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    // ── 收件箱忽略 ──────────────────────────────────────────────────────────

    @Test fun `an inbox dismissal needs a dismissible row and the authoritative removal`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-inbox", """"items":[
                {"key":"k1","kind":"routine-draft","text":"草稿","createdAt":1,"dismissible":true},
                {"key":"k2","kind":"approval","createdAt":2,"dismissible":false}]""")
            // 不可忽略的条目和未知条目都不发。
            f.link.dismissBotInboxItem("k2")
            f.link.dismissBotInboxItem("unknown")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.inboxDismiss)
            f.link.dismissBotInboxItem("k1")
            f.link.dismissBotInboxItem("k1")
            runCurrent()
            assertEquals(listOf("""{"type":"bot-inbox-dismiss","key":"k1"}"""), f.sent())
            assertEquals(DesktopBotInboxDismiss("k1", SessionCommandPhase.Waiting), f.bots!!.inboxDismiss)
            // 仍包含该 key 的权威列表只是还没处理完，手机不自己删行。
            f.push("bot-inbox", """"items":[
                {"key":"k1","kind":"routine-draft","text":"草稿","createdAt":1,"dismissible":true},
                {"key":"k2","kind":"approval","createdAt":2,"dismissible":false}]""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.inboxDismiss!!.phase)
            assertEquals(listOf("k1", "k2"), f.bots!!.inbox.map { it.key })
            // 整表移除才是忽略完成的证据。
            f.push("bot-inbox", """"items":[
                {"key":"k2","kind":"approval","createdAt":2,"dismissible":false}]""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.inboxDismiss!!.phase)
            assertEquals(listOf("k2"), f.bots!!.inbox.map { it.key })
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a silent dismissal turns unconfirmed without a resend and a denial revokes scope`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-inbox", """"items":[
                {"key":"k1","kind":"silence","createdAt":1,"dismissible":true}]""")
            f.link.dismissBotInboxItem("k1"); runCurrent(); f.commands()
            advanceTimeBy(9_900); runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.inboxDismiss!!.phase)
            advanceTimeBy(200); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.inboxDismiss!!.phase)
            assertFalse(f.state.readOnly)
            assertTrue(f.commands().isEmpty())
            // 迟到的权威整表仍然能证明这次忽略。
            f.push("bot-inbox", """"items":[]""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.inboxDismiss!!.phase)
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.push("bot-inbox", """"items":[
                {"key":"k1","kind":"silence","createdAt":1,"dismissible":true}]""")
            f.link.dismissBotInboxItem("k1"); runCurrent(); f.commands()
            f.push("command-rejected", """"command":"bot-inbox-dismiss","error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.inboxDismiss!!.phase)
        }
    }

    // ── 建群 ────────────────────────────────────────────────────────────────

    @Test fun `group create sends the exact command and waits for the receipt and directory`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.createBotGroup(" 新组 ", listOf("b1", "b2"), "b1")
            f.link.createBotGroup("新组", listOf("b1", "b2"), "b1")
            runCurrent()
            val command = f.commands().single()
            assertEquals(setOf("type", "requestId", "title", "memberIds", "bossBotId"), command.keys)
            assertEquals("bot-group-create", command["type"].linkString())
            assertEquals("新组", command["title"].linkString())
            assertEquals(listOf("b1", "b2"), (command["memberIds"] as JsonArray).map { it.linkString() })
            assertEquals("b1", command["bossBotId"].linkString())
            val requestId = command["requestId"].linkString()!!
            assertEquals(DesktopBotGroupCreate(requestId, "新组", listOf("b1", "b2"), "b1",
                SessionCommandPhase.Waiting), f.bots!!.groupCreate)
            // 不乐观建群：目录里没有新聊天，也不切换任何选择。
            assertEquals(listOf("c1", "c2"), f.bots!!.chats.map { it.id })
            f.push("bot-group-create-result", """"requestId":"other","ok":true,"chatId":"c3"""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.groupCreate!!.phase)
            f.push("bot-group-create-result", """"requestId":"$requestId","ok":true,"chatId":"c3"""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.groupCreate!!.phase)
            assertEquals("c3", f.bots!!.groupCreate!!.chatId)
            // 目录仍然只由桌面推送决定。
            assertEquals(listOf("c1", "c2"), f.bots!!.chats.map { it.id })
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `group create refuses unknown archived duplicate or boss-less members`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.createBotGroup("t", listOf("b1"), "b1")                    // 少于两名成员
            f.link.createBotGroup("t", listOf("b1", "b2"), "b9")              // 群主不在成员里
            f.link.createBotGroup("t", listOf("b1", "b9"), "b1")              // 未知成员
            f.link.createBotGroup("t", listOf("b1", "b1"), "b1")              // 重复成员
            f.link.createBotGroup("   ", listOf("b1", "b2"), "b1")            // 空标题
            f.link.createBotGroup("t", listOf("b1", "b3"), "b1")              // 已归档成员
            f.link.createBotGroup("t".repeat(BOT_TITLE_LIMIT + 1), listOf("b1", "b2"), "b1")
            f.link.createBotGroup("t", (0..BOT_CHAT_MEMBER_LIMIT).map { "b$it" }, "b0")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.groupCreate)
        }
        // 没有 groupCreate 能力位。
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"newSession":true,"bots":[]""")
            f.directory()
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
        // 只读与隐藏的前台都不发。
        fixture { f ->
            f.ready(readOnly = true); f.catalog(); f.directory()
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); f.link.setVisible(true)
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1"); runCurrent()
            assertFalse(f.sentTypes().contains("bot-group-create"))
        }
        // 已有写等待时不再排队。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.sendBotMessage("c1", "hi"); runCurrent(); f.commands()
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1"); runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.groupCreate)
        }
    }

    @Test fun `group create settles its own receipt rejects with the host reason and never resends`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1"); runCurrent()
            val requestId = f.bots!!.groupCreate!!.requestId
            f.commands()
            advanceTimeBy(15_100); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.groupCreate!!.phase)
            assertTrue(f.commands().isEmpty())
            f.push("bot-group-create-result",
                """"requestId":"$requestId","ok":false,"error":"members-unavailable"""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.groupCreate!!.phase)
            assertEquals("members-unavailable", f.bots!!.groupCreate!!.error)
            // 成功必须有聊天 id：桌面建群回执总会点名它复用或新建的群。
            f.link.createBotGroup("t2", listOf("b1", "b2"), "b2"); runCurrent()
            val second = f.bots!!.groupCreate!!.requestId
            f.commands()
            f.push("bot-group-create-result", """"requestId":"$second","ok":true""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.groupCreate!!.phase)
            assertNull(f.bots!!.groupCreate!!.chatId)
            f.push("bot-group-create-result", """"requestId":"$second","ok":true,"chatId":null""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.groupCreate!!.phase)
            // 迟到但完整的回执仍然结算。
            f.push("bot-group-create-result", """"requestId":"$second","ok":true,"chatId":"c4"""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.groupCreate!!.phase)
            assertEquals("c4", f.bots!!.groupCreate!!.chatId)
            // 出现但不可用的 id 不算这次回执。
            f.link.createBotGroup("t3", listOf("b1", "b2"), "b1"); runCurrent()
            val third = f.bots!!.groupCreate!!.requestId
            f.commands()
            f.push("bot-group-create-result", "\"requestId\":\"$third\",\"ok\":true,\"chatId\":\"\"")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.groupCreate!!.phase)
        }
        // 只读回执把链路降级为只读。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1"); runCurrent()
            val requestId = f.bots!!.groupCreate!!.requestId
            f.commands()
            f.push("bot-group-create-result", """"requestId":"$requestId","ok":false,"error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.groupCreate!!.phase)
            f.link.createBotGroup("t2", listOf("b1", "b2"), "b1"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
        // 通用 scope 拒绝也结算当前这次建群。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1"); runCurrent(); f.commands()
            f.push("command-rejected", """"command":"bot-group-create","error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.groupCreate!!.phase)
        }
    }

    // ── 产物 ────────────────────────────────────────────────────────────────

    @Test fun `artifact lists are matched by their echoed target`() = runTest {
        fixture { f ->
            f.ready(); f.directory()
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c1", entryId = "e1"))
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c1", entryId = "e1"))
            runCurrent()
            assertEquals(listOf("""{"type":"bot-artifacts","target":{"chatId":"c1","entryId":"e1"}}"""),
                f.sent())
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.artifacts!!.phase)
            // 另一条消息的清单不是这次请求的应答。
            f.push("bot-artifacts",
                """"target":{"chatId":"c1","entryId":"other"},"artifacts":[],"media":[]""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.artifacts!!.phase)
            f.push("bot-artifacts", """"target":{"chatId":"c1","entryId":"e1"},"artifacts":[
                {"rel":"reports/a.md","name":"a.md","size":12,"kind":"markdown"},
                {"rel":"","name":"bad","size":1,"kind":"text"},
                {"rel":"img.png","name":"img.png","size":7,"kind":"image"}],"media":[
                {"ok":true,"mediaId":"${"a".repeat(64)}.png","thumb":"data:image/png;base64,AA",
                 "source":"file","name":"a.png","caption":"截图"},
                {"ok":false,"error":"too-large","source":"web"}]""")
            val artifacts = f.bots!!.artifacts!!
            assertEquals(SessionCommandPhase.Observed, artifacts.phase)
            assertEquals(listOf("reports/a.md", "img.png"), artifacts.artifacts.map { it.rel })
            assertEquals(DesktopBotArtifact("reports/a.md", "a.md", 12, "markdown"),
                artifacts.artifacts.first())
            assertEquals(2, artifacts.media.size)
            assertEquals("a.png", artifacts.media[0].name)
            assertEquals("截图", artifacts.media[0].caption)
            assertEquals("data:image/png;base64,AA", artifacts.media[0].thumb)
            assertNull(artifacts.media[1].mediaId)
            assertEquals("too-large", artifacts.media[1].error)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a direct message artifact target carries its conversation and index`() = runTest {
        fixture { f ->
            f.ready(); f.directory()
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c2", conversationId = "cv2", messageIndex = 3))
            runCurrent()
            assertEquals(listOf(
                """{"type":"bot-artifacts","target":{"chatId":"c2","conversationId":"cv2","messageIndex":3}}"""),
                f.sent())
            f.push("bot-artifacts", """"target":{"chatId":"c2","conversationId":"cv2","messageIndex":3},
                "artifacts":[{"rel":"x.png","name":"x.png","size":1,"kind":"image"}],"media":[]""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.artifacts!!.phase)
            assertEquals(listOf("x.png"), f.bots!!.artifacts!!.artifacts.map { it.rel })
        }
    }

    @Test fun `artifact images settle by request id and drop unusable payloads`() = runTest {
        fixture { f ->
            f.ready(); f.directory()
            val target = DesktopBotArtifactTarget("c1", entryId = "e1")
            f.link.loadBotArtifactImage(target, mediaId = "${"a".repeat(64)}.png")
            runCurrent()
            val command = f.commands().single()
            assertEquals(setOf("type", "requestId", "target", "mediaId"), command.keys)
            val requestId = command["requestId"].linkString()!!
            f.push("bot-artifact-image", """"requestId":"other","dataUrl":"data:image/png;base64,AA"""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.artifactImage!!.phase)
            f.push("bot-artifact-image", """"requestId":"$requestId","dataUrl":"data:image/png;base64,AA"""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.artifactImage!!.phase)
            assertEquals("data:image/png;base64,AA", f.bots!!.artifactImage!!.dataUrl)
            // 主机给的原因照实显示。
            f.link.loadBotArtifactImage(target, rel = "img.png")
            runCurrent()
            val failed = f.commands().single()
            assertEquals(setOf("type", "requestId", "target", "rel"), failed.keys)
            f.push("bot-artifact-image", """"requestId":"${failed["requestId"].linkString()}","error":"too-large"""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.artifactImage!!.phase)
            assertEquals("too-large", f.bots!!.artifactImage!!.error)
            // 过大的图不是可显示的大图。
            f.link.loadBotArtifactImage(target, rel = "img.png")
            runCurrent()
            val oversized = f.commands().single()["requestId"].linkString()
            f.push("bot-artifact-image", """"requestId":"$oversized",
                "dataUrl":"data:image/png;base64,${"A".repeat(BOT_IMAGE_DATA_LIMIT + 1)}"""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.artifactImage!!.phase)
            assertEquals("无效的响应", f.bots!!.artifactImage!!.error)
            assertNull(f.bots!!.artifactImage!!.dataUrl)
        }
    }

    @Test fun `artifact reads need a usable target and stay available on a readonly device`() = runTest {
        fixture { f ->
            f.ready(); f.directory()
            // 一个 target 只能是群条目或私聊某条消息，不能两者都不是/都是。
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c1"))
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c1", entryId = "e1", conversationId = "cv1",
                messageIndex = 1))
            f.link.loadBotArtifacts(DesktopBotArtifactTarget(""))
            f.link.loadBotArtifactImage(DesktopBotArtifactTarget("c1", entryId = "e1"))
            f.link.loadBotArtifactImage(DesktopBotArtifactTarget("c1", entryId = "e1"),
                mediaId = "m1", rel = "x.png")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.artifacts)
            assertNull(f.bots!!.artifactImage)
        }
        // 只读设备的产物读取是读命令，仍然可用。
        fixture { f ->
            f.ready(readOnly = true); f.directory()
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c1", entryId = "e1"))
            runCurrent()
            assertEquals(listOf("bot-artifacts"), f.sentTypes())
            f.push("bot-artifacts", """"target":{"chatId":"c1","entryId":"e1"},"artifacts":[],"media":[]""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.artifacts!!.phase)
        }
        // 隐藏的前台不发产物请求。
        fixture { f ->
            f.ready(); f.directory()
            f.link.setBackgroundAllowed(true); runCurrent()
            f.link.setVisible(false); runCurrent()
            f.commands()
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c1", entryId = "e1"))
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `dropping the connection discards the member feature attempts`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.createBotGroup("t", listOf("b1", "b2"), "b1")
            f.link.requestBotNewSession("c1")
            f.link.loadBotArtifacts(DesktopBotArtifactTarget("c1", entryId = "e1"))
            runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.groupCreate!!.phase)
            f.socket.failed(); runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.state.bots)
        }
    }

    @Test fun `a group title is bounded at 200 raw characters before trimming`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            // 先按原文长度判界：超长的纯空白不会被 trim 救回来。
            f.link.createBotGroup("t".repeat(BOT_TITLE_LIMIT + 1), listOf("b1", "b2"), "b1")
            f.link.createBotGroup(" ".repeat(BOT_TITLE_LIMIT + 1), listOf("b1", "b2"), "b1")
            f.link.createBotGroup("  ${"t".repeat(BOT_TITLE_LIMIT)}  ", listOf("b1", "b2"), "b1")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.groupCreate)
        }
        // 上限本身可用：桌面判的是线上原文长度，所以恰好 200 个字符仍然发得出去。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.createBotGroup("t".repeat(BOT_TITLE_LIMIT), listOf("b1", "b2"), "b1")
            runCurrent()
            assertEquals("t".repeat(BOT_TITLE_LIMIT),
                f.commands().single { it["type"].linkString() == "bot-group-create" }["title"].linkString())
        }
    }

    @Test fun `a silent artifact target is never asked again in this generation`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            val target = DesktopBotArtifactTarget("c1", entryId = "e1")
            f.link.loadBotArtifacts(target); runCurrent(); f.commands()
            advanceTimeBy(20_100); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.artifacts!!.phase)
            // 答复不带 requestId，同 target 再发就无法分辨这次和上一次的答案。
            f.link.loadBotArtifacts(target); runCurrent()
            assertTrue(f.commands().isEmpty())
            // 那次请求的迟到答复仍然结算它，之后同 target 才能重新读。
            f.push("bot-artifacts", """"target":{"chatId":"c1","entryId":"e1"},"artifacts":[],"media":[]""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.artifacts!!.phase)
            f.link.loadBotArtifacts(target); runCurrent()
            assertEquals(listOf("bot-artifacts"), f.sentTypes())
        }
        // 换代后可以重新问：抑制只属于一个连接。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            val target = DesktopBotArtifactTarget("c1", entryId = "e1")
            f.link.loadBotArtifacts(target); runCurrent(); f.commands()
            advanceTimeBy(20_100); runCurrent()
            f.socket.failed(); runCurrent()
            advanceTimeBy(1_000); runCurrent()
            f.begin(); f.prove(); f.catalog(); f.directory()
            f.link.loadBotArtifacts(target); runCurrent()
            assertTrue(f.sentTypes().contains("bot-artifacts"))
        }
    }

    @Test fun `a turn keeps up to the host's twenty images`() = runTest {
        fixture { f ->
            f.ready(); f.directory()
            val target = DesktopBotArtifactTarget("c1", entryId = "e1")
            f.link.loadBotArtifacts(target); runCurrent(); f.commands()
            f.push("bot-artifacts", """"target":{"chatId":"c1","entryId":"e1"},"artifacts":[],"media":[${
                mediaRows(20)}]""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.artifacts!!.phase)
            assertEquals(20, f.bots!!.artifacts!!.media.size)
            // 超过 20 张不是一轮消息的形状，整表无效。
            f.link.loadBotArtifacts(target); runCurrent(); f.commands()
            f.push("bot-artifacts", """"target":{"chatId":"c1","entryId":"e1"},"artifacts":[],"media":[${
                mediaRows(21)}]""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.artifacts!!.phase)
        }
    }

    @Test fun `a direct open is a receipt-bound write that must name the chat`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotDirect("b1")
            f.link.openBotDirect("b1")
            runCurrent()
            val command = f.commands().single()
            assertEquals(setOf("type", "requestId", "botId"), command.keys)
            assertEquals("bot-direct-open", command["type"].linkString())
            assertEquals("b1", command["botId"].linkString())
            val requestId = command["requestId"].linkString()!!
            assertEquals(DesktopBotDirectOpen(requestId, "b1", SessionCommandPhase.Waiting),
                f.bots!!.directOpen)
            // 回执必须点名这次请求；成功的回执还必须点名聊天。
            f.push("bot-direct-open-result", """"requestId":"other","ok":true,"chatId":"c9"""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.directOpen!!.phase)
            f.push("bot-direct-open-result", """"requestId":"$requestId","ok":true""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.directOpen!!.phase)
            assertNull(f.bots!!.directOpen!!.chatId)
            // 迟到的完整回执仍然结算，且不乐观改目录。
            f.push("bot-direct-open-result", """"requestId":"$requestId","ok":true,"chatId":"c3"""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.directOpen!!.phase)
            assertEquals("c3", f.bots!!.directOpen!!.chatId)
            assertEquals(listOf("c1", "c2"), f.bots!!.chats.map { it.id })
            assertTrue(f.commands().isEmpty())
        }
        // 失败只显示主机原因，不猜聊天。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotDirect("b2"); runCurrent()
            val requestId = f.bots!!.directOpen!!.requestId
            f.commands()
            f.push("bot-direct-open-result", """"requestId":"$requestId","ok":false,"error":"chat-archived"""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.directOpen!!.phase)
            assertEquals("chat-archived", f.bots!!.directOpen!!.error)
        }
        // 超时只标未确认，绝不自动重发。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotDirect("b1"); runCurrent(); f.commands()
            advanceTimeBy(15_100); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.directOpen!!.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a direct open needs the capability a known member read-write and the foreground`() = runTest {
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotDirect("b3")             // 已归档成员
            f.link.openBotDirect("b9")             // 未知成员
            f.link.openBotDirect("")               // 空 bot id
            f.link.openBotDirect("b".repeat(BOT_TEXT_LIMIT + 1))
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.directOpen)
        }
        // catalog 没有 directOpen 能力位。
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"newSession":true,"groupCreate":true,"bots":[]""")
            f.directory()
            f.link.openBotDirect("b1"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
        // 只读设备不能开新私聊。
        fixture { f ->
            f.ready(readOnly = true); f.catalog(); f.directory()
            f.link.openBotDirect("b1"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
        // 隐藏的前台不发。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); f.link.setVisible(true)
            f.link.openBotDirect("b1"); runCurrent()
            assertFalse(f.sentTypes().contains("bot-direct-open"))
        }
        // 已有写等待时不再排队。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.sendBotMessage("c1", "hi"); runCurrent(); f.commands()
            f.link.openBotDirect("b1"); runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.bots!!.directOpen)
        }
        // 通用 scope 拒绝也结算这次请求。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotDirect("b1"); runCurrent(); f.commands()
            f.push("command-rejected", """"command":"bot-direct-open","error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.directOpen!!.phase)
        }
        // 断开连接后不再留任何直接开启的痕迹。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotDirect("b1"); runCurrent()
            f.socket.failed(); runCurrent()
            assertNull(f.state.bots)
        }
    }

    @Test fun `a direct chat and a bot role may legitimately be empty`() = runTest {
        fixture { f ->
            f.ready()
            // 成员的头衔是可选资料：缺键与空串都是真实的线上形态。
            f.push("bot-catalog", """"enabled":true,"directOpen":true,"bots":[
                {"id":"b1","name":"Ada","title":"","avatarColor":"#f00","status":"idle"},
                {"id":"b2","name":"Bo","avatarColor":"#0f0","status":"idle"}]""")
            assertEquals(listOf("b1", "b2"), f.bots!!.members.map { it.id })
            assertEquals(listOf("", ""), f.bots!!.members.map { it.title })
            // 桌面新建私聊的标题就是空串：不能被当成坏行丢掉，否则私聊消失。
            f.push("bot-chats", """"chats":[
                {"id":"c1","kind":"direct","title":"","members":["b1"],"bossBotId":null,
                 "updatedAt":1,"lastSeq":0,"sessions":{}}]""")
            assertEquals(listOf("c1"), f.bots!!.chats.map { it.id })
            assertEquals("", f.bots!!.chats.first().title)
            assertNotNull(f.bots!!.botChat("c1"))
            // 但标题仍然是必需的文本类型：缺键或非文本都不算标题。
            f.push("bot-chats", """"chats":[
                {"id":"c2","kind":"direct","members":["b1"],"bossBotId":null,
                 "updatedAt":1,"lastSeq":0,"sessions":{}},
                {"id":"c3","kind":"direct","title":7,"members":["b1"],"bossBotId":null,
                 "updatedAt":1,"lastSeq":0,"sessions":{}}]""")
            assertTrue(f.bots!!.chats.isEmpty())
        }
        // 打开私聊后，目录里那条空标题的聊天可以直接进入历史。
        fixture { f ->
            f.ready(); f.catalog(); f.directory()
            f.link.openBotDirect("b1"); runCurrent()
            val requestId = f.bots!!.directOpen!!.requestId
            f.commands()
            f.push("bot-direct-open-result", """"requestId":"$requestId","ok":true,"chatId":"c3"""")
            f.push("bot-chats", """"chats":[
                {"id":"c3","kind":"direct","title":"","members":["b1"],"bossBotId":null,
                 "updatedAt":2,"lastSeq":0,"sessions":{"b1":{"conversationId":"cv3"}}}]""")
            assertNotNull(f.bots!!.botChat("c3"))
            f.link.openBotChat("c3"); runCurrent()
            assertEquals(listOf("bot-chat-open"), f.sentTypes())
        }
    }

    // ── 夹具 ────────────────────────────────────────────────────────────────

    private fun Fixture.catalog() = push("bot-catalog", """"enabled":true,"newSession":true,
        "groupCreate":true,"directOpen":true,"threads":true,"bots":[
        {"id":"b1","name":"Ada","title":"PM","avatarColor":"#f00","status":"idle"},
        {"id":"b2","name":"Bo","title":"Dev","avatarColor":"#0f0","status":"idle"},
        {"id":"b3","name":"Cy","title":"Old","avatarColor":"#00f","status":"idle","archived":true}]""")

    private fun Fixture.directory() = frame(json("""{"type":"bot-chats","chats":[
        {"id":"c1","kind":"group","title":"Team","members":["b1","b2"],"bossBotId":"b1",
         "updatedAt":1,"lastSeq":3,"sessions":{"b1":{"conversationId":"cv1"},
         "b2":{"conversationId":"cv2"}}},
        {"id":"c2","kind":"direct","title":"私聊","members":["b1"],"bossBotId":null,
         "updatedAt":1,"lastSeq":0,"sessions":{"b1":{"conversationId":"cv2"}}}]}"""))

    private fun TestScope.fixture(block: (Fixture) -> Unit) {
        val f = Fixture(this)
        try { block(f) } finally { f.link.close(); runCurrent(); advanceTimeBy(1_001); runCurrent() }
    }

    private class Fixture(val scope: TestScope) {
        val key = ByteArray(32)
        val host = FrameReplay(key, ReplayRole.Host, announce = true)
        val sockets = mutableListOf<FakeSocket>()
        val socket get() = sockets.last()
        val link = DesktopLink(PairCredentials("pair-1", "token", key, "Eaves", "https://example.test"),
            {}, false, StandardTestDispatcher(scope.testScheduler), { scope.testScheduler.currentTime }, { 0.5 },
            { request, listener -> FakeSocket(request, listener).also(sockets::add) })
        val state get() = link.state.value
        val bots get() = state.bots
        fun begin() {
            link.setVisible(true)
            scope.runCurrent()
            socket.opened(); socket.text("pong"); socket.text("""{"type":"host-online"}""")
            scope.runCurrent(); host.peerReset()
        }
        fun prove() {
            socket.sent.forEach { host.open(it) }; socket.sent.clear()
            frame(json("""{"type":"replay-hello"}"""))
            assertEquals(LinkPhase.Online, state.phase)
        }
        fun ready(readOnly: Boolean = false) {
            begin(); prove()
            frame(json("""{"type":"host-info","hostname":"Host","readOnly":$readOnly}"""))
            commands()
        }
        fun push(type: String, body: String) = frame(json("""{"type":"$type",$body}"""))
        fun frame(frame: JsonObject) { socket.binary(host.seal(frame)); scope.runCurrent() }
        fun commands(): List<JsonObject> = socket.sent.mapNotNull { host.open(it)?.payload }.also { socket.sent.clear() }
        fun sent(): List<String> =
            socket.sent.mapNotNull { host.open(it)?.payload?.toString() }.also { socket.sent.clear() }
        fun sentTypes(): List<String> = sent().map { json(it)["type"].linkString()!! }
    }

    private class FakeSocket(private val request: Request, private val listener: WebSocketListener) : WebSocket {
        val sent = mutableListOf<ByteArray>()
        var accept = true
        override fun request() = request
        override fun queueSize() = 0L
        override fun send(text: String) = accept
        override fun send(bytes: ByteString): Boolean {
            if (!accept) return false
            sent.add(bytes.toByteArray()); return true
        }
        override fun close(code: Int, reason: String?) = false
        override fun cancel() = Unit
        fun opened() = listener.onOpen(this, Response.Builder().request(request)
            .protocol(Protocol.HTTP_1_1).code(101).message("Upgrade").build())
        fun text(value: String) = listener.onMessage(this, value)
        fun binary(value: ByteArray) = listener.onMessage(this, value.toByteString())
        fun failed() = listener.onFailure(this, IOException(), null)
    }

    private companion object {
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
        fun mediaRows(count: Int) = (0 until count).joinToString(",") { i ->
            """{"ok":true,"mediaId":"${"a".repeat(64)}-$i.png","source":"file","name":"$i.png"}"""
        }
    }
}
