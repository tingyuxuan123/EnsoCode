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

@OptIn(ExperimentalCoroutinesApi::class)
class DesktopBotsTest {
    @Test fun `a catalog request sends the exact command and projects its members`() = runTest {
        fixture { f ->
            f.ready()
            assertNull(f.state.bots)
            f.link.requestBots()
            runCurrent()
            assertEquals(listOf("""{"type":"bot-catalog-request"}"""), f.sent())
            assertEquals(DesktopBotsState(catalogRequested = true), f.bots)
            f.push("bot-catalog", """"enabled":true,"newSession":true,"threads":true,"bots":[
                {"id":"b1","name":"Ada","title":"PM","avatarColor":"#f00","status":"idle","archived":true},
                {"id":"b2","name":"Bo","title":"Dev","avatarColor":"#0f0","status":"running"}]""")
            val bots = f.bots!!
            assertEquals(true, bots.enabled)
            assertFalse(bots.catalogRequested)
            assertNull(bots.error)
            assertEquals(listOf(DesktopBotMember("b1", "Ada", "PM", "#f00", "idle", archived = true),
                DesktopBotMember("b2", "Bo", "Dev", "#0f0", "running")), bots.members)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `an inbox request sends the exact command and projects its items`() = runTest {
        fixture { f ->
            f.ready()
            f.link.requestInbox()
            runCurrent()
            assertEquals(listOf("""{"type":"bot-inbox-request"}"""), f.sent())
            assertTrue(f.bots!!.inboxRequested)
            f.push("bot-inbox", """"items":[
                {"key":"i1","kind":"approval","chatId":"c1","botId":"b1","text":"允许?","createdAt":3,"dismissible":false},
                {"key":"i2","kind":"routine-blocked","chatId":null,"createdAt":0,"dismissible":true}]""")
            val bots = f.bots!!
            assertFalse(bots.inboxRequested)
            assertNull(bots.error)
            assertEquals(listOf(DesktopBotInboxItem("i1", "approval", "c1", "b1", "允许?", 3, false),
                DesktopBotInboxItem("i2", "routine-blocked", null, null, null, 0, true)), bots.inbox)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `chats and activity pushes project their visible fields`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-chats", """"chats":[
                {"id":"c1","kind":"group","title":"Team","members":["b1","b2"],"bossBotId":"b1",
                 "updatedAt":5,"lastSeq":9,"pinned":true,"parentId":"root","status":"running",
                 "last":{"kind":"bot","text":"hi","botId":"b2","at":7},
                 "sessions":{"b1":{"conversationId":"cv1"}}},
                {"id":"c2","kind":"direct","title":"私聊","members":["b1"],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0}]""")
            assertEquals(listOf(
                DesktopBotChat("c1", "group", "Team", listOf("b1", "b2"), "b1", 5, 9, "root", "hi", "running"),
                DesktopBotChat("c2", "direct", "私聊", listOf("b1"), null, 0, 0)), f.bots!!.chats)
            f.push("bot-activity", """"now":1000,"items":[
                {"conversationId":"cv1","botId":"b1","chatId":"c1","state":"tool","startedAt":900,
                 "steps":[{"name":"bash","detail":"ls","status":"running"}],"more":0},
                {"conversationId":"cv2","botId":"b2","chatId":null,"state":"queued","reason":"capacity"}]""")
            val bots = f.bots!!
            assertEquals(1000L, bots.activityNow ?: -1L)
            assertEquals(listOf(
                DesktopBotActivityItem("cv1", "b1", "c1", "tool", null, 900),
                DesktopBotActivityItem("cv2", "b2", null, "queued", "capacity", null)), bots.activity)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `opening a chat projects only human bot and system timeline rows`() = runTest {
        fixture { f ->
            f.ready()
            f.link.openBotChat("c1")
            runCurrent()
            assertEquals(listOf("""{"type":"bot-chat-open","chatId":"c1"}"""), f.sent())
            assertEquals("c1", f.bots!!.timelineChatId)
            assertTrue(f.bots!!.timelineRequested)
            assertTrue(f.bots!!.timelineLoading)
            f.push("group-timeline", """"chatId":"c1","lastSeq":12,"hasOlder":true,"entries":[
                {"seq":1,"id":"e1","at":10,"kind":"human","text":"hi","mentions":[]},
                {"seq":2,"id":"e2","at":11,"kind":"bot","text":"hello","botId":"b1",
                 "conversationId":"cv1","turnId":"t1"},
                {"seq":3,"id":"e3","at":12,"kind":"system","text":"joined"},
                {"seq":4,"id":"e4","at":13,"kind":"delegation","delegationId":"d1","from":"b1",
                 "to":"b2","state":"running"},
                {"seq":5,"id":"e5","at":14,"kind":"progress","botId":"b1","taskId":"k","taskSeq":1,
                 "delegationId":"d1","phase":"started","text":"p"},
                {"seq":6,"id":"e6","at":15,"kind":"reaction","text":"?"}]""")
            val bots = f.bots!!
            assertEquals(listOf(
                DesktopGroupEntry(1, "e1", 10, "human", "hi", null),
                DesktopGroupEntry(2, "e2", 11, "bot", "hello", "b1"),
                DesktopGroupEntry(3, "e3", 12, "system", "joined", null)), bots.timeline)
            assertFalse(bots.timelineRequested)
            assertFalse(bots.timelineLoading)
            assertNull(bots.timelineError)
            assertEquals(12L, bots.timelineLastSeq)
            assertTrue(bots.timelineHasOlder)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a timeline for another chat is dropped and an older page is prepended once`() = runTest {
        fixture { f ->
            f.ready()
            f.link.openBotChat("c1")
            runCurrent()
            f.commands()
            // A page for a chat that is not open is not this screen's answer.
            f.push("group-timeline", """"chatId":"c2","lastSeq":4,"hasOlder":true,"entries":[
                {"seq":4,"id":"x","at":4,"kind":"human","text":"x"}]""")
            assertTrue(f.bots!!.timeline.isEmpty())
            assertTrue(f.bots!!.timelineLoading)
            f.push("group-timeline", """"chatId":"c1","lastSeq":6,"hasOlder":true,"entries":[
                {"seq":5,"id":"e5","at":5,"kind":"human","text":"five"},
                {"seq":6,"id":"e6","at":6,"kind":"human","text":"six"}]""")
            assertEquals(listOf(5L, 6L), f.bots!!.timeline.map { it.seq })
            assertFalse(f.bots!!.timelineLoading)
            // Paging asks for the rows before the oldest one shown, and repeats stay inside one window.
            f.link.loadBotTimeline("c1", 5)
            f.link.loadBotTimeline("c1", 5)
            runCurrent()
            assertEquals(listOf("""{"type":"bot-timeline","chatId":"c1","beforeSeq":5}"""), f.sent())
            assertTrue(f.bots!!.timelineLoading)
            // Older rows are prepended, de-duplicated by seq and kept ascending.
            f.push("group-timeline", """"chatId":"c1","beforeSeq":5,"lastSeq":6,"hasOlder":false,"entries":[
                {"seq":4,"id":"e4","at":4,"kind":"system","text":"four"},
                {"seq":3,"id":"e3","at":3,"kind":"human","text":"three"},
                {"seq":5,"id":"dup","at":5,"kind":"human","text":"duplicate"}]""")
            assertEquals(listOf(3L, 4L, 5L, 6L), f.bots!!.timeline.map { it.seq })
            assertEquals("five", f.bots!!.timeline.first { it.seq == 5L }.text)
            assertFalse(f.bots!!.timelineLoading)
            assertFalse(f.bots!!.timelineHasOlder)
            assertEquals(6L, f.bots!!.timelineLastSeq)
            // A page without beforeSeq replaces the whole timeline once the window has passed.
            advanceTimeBy(10_001)
            runCurrent()
            f.link.loadBotTimeline("c1")
            runCurrent()
            assertEquals(listOf("""{"type":"bot-timeline","chatId":"c1"}"""), f.sent())
            f.push("group-timeline", """"chatId":"c1","lastSeq":8,"hasOlder":true,"entries":[
                {"seq":7,"id":"e7","at":7,"kind":"bot","text":"seven","botId":"b1"},
                {"seq":8,"id":"e8","at":8,"kind":"human","text":"eight"}]""")
            assertEquals(listOf(7L, 8L), f.bots!!.timeline.map { it.seq })
            // Paging a chat that is not on screen never merges its rows into the open chat.
            f.link.loadBotTimeline("c2", 9)
            runCurrent()
            f.commands()
            assertEquals("c2", f.bots!!.timelineChatId)
            assertTrue(f.bots!!.timeline.isEmpty())
            f.push("group-timeline", """"chatId":"c2","beforeSeq":9,"lastSeq":9,"hasOlder":true,"entries":[
                {"seq":8,"id":"f8","at":8,"kind":"human","text":"other"}]""")
            assertEquals(listOf(8L), f.bots!!.timeline.map { it.seq })
        }
    }

    @Test fun `an empty table is a valid answer`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"bots":[]""")
            f.push("bot-chats", """"chats":[]""")
            f.push("bot-inbox", """"items":[]""")
            f.push("bot-activity", """"now":0,"items":[]""")
            val bots = f.bots!!
            assertEquals(emptyList<DesktopBotMember>(), bots.members)
            assertEquals(emptyList<DesktopBotChat>(), bots.chats)
            assertEquals(emptyList<DesktopBotInboxItem>(), bots.inbox)
            assertEquals(emptyList<DesktopBotActivityItem>(), bots.activity)
            assertEquals(0L, bots.activityNow ?: -1L)
            f.link.openBotChat("c1")
            runCurrent()
            f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":0,"hasOlder":false,"entries":[]""")
            assertEquals(emptyList<DesktopGroupEntry>(), f.bots!!.timeline)
            assertEquals(0L, f.bots!!.timelineLastSeq)
            assertFalse(f.bots!!.timelineLoading)
        }
    }

    @Test fun `a disabled catalog hides members without reporting an error`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"bots":[
                {"id":"b1","name":"Ada","title":"PM","avatarColor":"#f00","status":"idle"}]""")
            assertEquals(listOf("b1"), f.bots!!.members.map { it.id })
            f.push("bot-catalog", """"enabled":false,"bots":[
                {"id":"b2","name":"Bo","title":"Dev","avatarColor":"#0f0","status":"idle"}]""")
            val bots = f.bots!!
            assertEquals(false, bots.enabled)
            assertTrue(bots.members.isEmpty())
            assertNull(bots.error)
        }
    }

    @Test fun `bad rows are dropped one by one without failing the table`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"bots":[
                {"id":"good","name":"n","title":"t","avatarColor":"#1","status":"idle"},
                {"id":"","name":"n","title":"t","avatarColor":"#1","status":"idle"},
                {"id":"blank-name","name":"  ","title":"t","avatarColor":"#1","status":"idle"},
                {"id":"no-title","name":"n","avatarColor":"#1","status":"idle"},
                {"id":"long-color","name":"n","title":"t",
                 "avatarColor":"${"#".repeat(BOT_TEXT_LIMIT + 1)}","status":"idle"},
                {"id":"bad-status","name":"n","title":"t","avatarColor":"#1","status":"blocked"},
                {"id":"bad-archived","name":"n","title":"t","avatarColor":"#1","status":"idle",
                 "archived":"yes"},
                "row",
                {"id":"good","name":"duplicate","title":"t","avatarColor":"#1","status":"running"},
                {"id":"max","name":"n","title":"t","avatarColor":"#1","status":"queued"}]""")
            assertEquals(listOf("good", "max"), f.bots!!.members.map { it.id })
            // The first row of a duplicate id wins; a later duplicate is not a second member.
            assertEquals("n", f.bots!!.members.first().name)
            assertNull(f.bots!!.error)

            val manyMembers = (0..BOT_CHAT_MEMBER_LIMIT).joinToString(",") { "\"b$it\"" }
            f.push("bot-chats", """"chats":[
                {"id":"ok","kind":"direct","title":"t","members":[],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0},
                {"id":"no-kind","title":"t","members":[],"bossBotId":null,"updatedAt":0,"lastSeq":0},
                {"id":"bad-kind","kind":"channel","title":"t","members":[],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0},
                {"id":"no-members","kind":"direct","title":"t","bossBotId":null,"updatedAt":0,"lastSeq":0},
                {"id":"bad-member","kind":"direct","title":"t","members":[""],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0},
                {"id":"too-many","kind":"group","title":"t","members":[$manyMembers],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0},
                {"id":"no-boss","kind":"direct","title":"t","members":[],"updatedAt":0,"lastSeq":0},
                {"id":"bad-boss","kind":"direct","title":"t","members":[],"bossBotId":"",
                 "updatedAt":0,"lastSeq":0},
                {"id":"neg-updated","kind":"direct","title":"t","members":[],"bossBotId":null,
                 "updatedAt":-1,"lastSeq":0},
                {"id":"fractional","kind":"direct","title":"t","members":[],"bossBotId":null,
                 "updatedAt":0.5,"lastSeq":0},
                {"id":"string-seq","kind":"direct","title":"t","members":[],"bossBotId":null,
                 "updatedAt":0,"lastSeq":"0"},
                {"id":"ok","kind":"group","title":"duplicate","members":[],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0}]""")
            assertEquals(listOf("ok"), f.bots!!.chats.map { it.id })
            assertEquals("direct", f.bots!!.chats.single().kind)

            f.push("bot-inbox", """"items":[
                {"key":"k1","kind":"approval","createdAt":0,"dismissible":true},
                {"key":"","kind":"approval","createdAt":0,"dismissible":true},
                {"key":"no-kind","createdAt":0,"dismissible":true},
                {"key":"blank-kind","kind":" ","createdAt":0,"dismissible":true},
                {"key":"long-kind","kind":"${"k".repeat(BOT_KIND_LIMIT + 1)}","createdAt":0,
                 "dismissible":true},
                {"key":"neg-created","kind":"budget","createdAt":-1,"dismissible":true},
                {"key":"bad-dismiss","kind":"budget","createdAt":0,"dismissible":"yes"},
                "row",
                {"key":"k1","kind":"budget","createdAt":0,"dismissible":true}]""")
            assertEquals(listOf("k1"), f.bots!!.inbox.map { it.key })

            f.push("bot-activity", """"now":5,"items":[
                {"conversationId":"cv","botId":"b","state":"tool"},
                {"conversationId":"","botId":"b","state":"tool"},
                {"conversationId":"cv","botId":"","state":"tool"},
                {"conversationId":"cv","botId":"b","state":""},
                {"conversationId":"cv","botId":"b","state":"tool","startedAt":-5},
                "row"]""")
            assertEquals(listOf("cv"), f.bots!!.activity.map { it.conversationId })
            assertNull(f.bots!!.error)
        }
    }

    @Test fun `tables and pages above their bounds are refused`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"bots":[
                {"id":"b1","name":"A","title":"t","avatarColor":"#1","status":"idle"}]""")
            f.push("bot-chats", """"chats":[
                {"id":"c1","kind":"direct","title":"t","members":[],"bossBotId":null,
                 "updatedAt":0,"lastSeq":0}]""")
            f.push("bot-inbox", """"items":[
                {"key":"k1","kind":"approval","createdAt":0,"dismissible":true}]""")
            f.push("bot-activity", """"now":1,"items":[
                {"conversationId":"cv1","botId":"b1","state":"tool"}]""")
            val member = """{"id":"b","name":"n","title":"t","avatarColor":"#","status":"idle"}"""
            f.push("bot-catalog", """"enabled":true,"bots":[${(0..BOT_TABLE_LIMIT)
                .joinToString(",") { member.replace("\"b\"", "\"b$it\"") }}]""")
            assertEquals(listOf("b1"), f.bots!!.members.map { it.id })
            // The bound itself is inclusive.
            f.push("bot-catalog", """"enabled":true,"bots":[${(0 until BOT_TABLE_LIMIT)
                .joinToString(",") { member.replace("\"b\"", "\"b$it\"") }}]""")
            assertEquals(BOT_TABLE_LIMIT, f.bots!!.members.size)

            val chat = """{"id":"c","kind":"direct","title":"t","members":[],"bossBotId":null,
                "updatedAt":0,"lastSeq":0}"""
            f.push("bot-chats", """"chats":[${(0..BOT_TABLE_LIMIT)
                .joinToString(",") { chat.replace("\"c\"", "\"c$it\"") }}]""")
            assertEquals(listOf("c1"), f.bots!!.chats.map { it.id })
            f.push("bot-inbox", """"items":[${(0..BOT_TABLE_LIMIT)
                .joinToString(",") { """{"key":"k$it","kind":"budget","createdAt":0,"dismissible":true}""" }}]""")
            assertEquals(listOf("k1"), f.bots!!.inbox.map { it.key })
            f.push("bot-activity", """"now":2,"items":[${(0..BOT_TABLE_LIMIT).joinToString(",")
                { """{"conversationId":"cv$it","botId":"b1","state":"tool"}""" }}]""")
            assertEquals(1L, f.bots!!.activityNow ?: -1L)
            assertEquals(listOf("cv1"), f.bots!!.activity.map { it.conversationId })

            f.link.openBotChat("c1")
            runCurrent()
            f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[
                {"seq":1,"id":"e1","at":1,"kind":"human","text":"one"}]""")
            assertEquals(listOf(1L), f.bots!!.timeline.map { it.seq })
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[
                ${(0..BOT_PAGE_LIMIT).joinToString(",") {
                    """{"seq":$it,"id":"e$it","at":1,"kind":"human","text":"x"}""" }}]""")
            assertEquals("无效的响应", f.bots!!.timelineError)
            assertEquals(listOf(1L), f.bots!!.timeline.map { it.seq })
            // A page at the bound is still a valid answer.
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[
                ${(0 until BOT_PAGE_LIMIT).joinToString(",") {
                    """{"seq":$it,"id":"e$it","at":1,"kind":"human","text":"x"}""" }}]""")
            assertEquals(BOT_PAGE_LIMIT, f.bots!!.timeline.size)
            assertNull(f.bots!!.timelineError)
        }
    }

    @Test fun `a silent request is reported once and never re-sent`() = runTest {
        fixture { f ->
            f.ready()
            f.link.requestBots()
            f.link.requestInbox()
            f.link.openBotChat("c1")
            runCurrent()
            assertEquals(listOf("bot-catalog-request", "bot-inbox-request", "bot-chat-open"), f.sentTypes())
            advanceTimeBy(9_900)
            runCurrent()
            assertTrue(f.bots!!.catalogRequested)
            assertTrue(f.bots!!.inboxRequested)
            assertTrue(f.bots!!.timelineRequested)
            advanceTimeBy(200)
            runCurrent()
            val bots = f.bots!!
            assertFalse(bots.catalogRequested)
            assertFalse(bots.inboxRequested)
            assertFalse(bots.timelineRequested)
            assertFalse(bots.timelineLoading)
            assertEquals("没有收到桌面响应", bots.error)
            assertEquals("没有收到桌面响应", bots.timelineError)
            // Nothing is re-sent by itself, and a late page still lands and clears the hint.
            assertTrue(f.commands().isEmpty())
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[]""")
            assertNull(f.bots!!.timelineError)
            // A manual retry is allowed once the window has passed.
            f.link.requestBots()
            runCurrent()
            assertEquals(listOf("bot-catalog-request"), f.sentTypes())
            f.push("bot-catalog", """"enabled":true,"bots":[]""")
            assertNull(f.bots!!.error)
            assertEquals(true, f.bots!!.enabled)
        }
    }

    @Test fun `repeated requests inside one window reach the wire once`() = runTest {
        fixture { f ->
            f.ready()
            repeat(3) { f.link.requestBots() }
            runCurrent()
            assertEquals(listOf("bot-catalog-request"), f.sentTypes())
            // An answer does not reopen the same window.
            f.push("bot-catalog", """"enabled":true,"bots":[]""")
            f.link.requestBots()
            runCurrent()
            assertTrue(f.commands().isEmpty())
            repeat(3) { f.link.requestInbox() }
            runCurrent()
            assertEquals(listOf("bot-inbox-request"), f.sentTypes())
            repeat(3) { f.link.openBotChat("c1") }
            runCurrent()
            assertEquals(listOf("bot-chat-open"), f.sentTypes())
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[]""")
            repeat(3) { f.link.loadBotTimeline("c1", 1) }
            runCurrent()
            assertEquals(listOf("""{"type":"bot-timeline","chatId":"c1","beforeSeq":1}"""), f.sent())
            // A different chat is a different request.
            f.link.openBotChat("c2")
            runCurrent()
            assertEquals(listOf("""{"type":"bot-chat-open","chatId":"c2"}"""), f.sent())
        }
    }

    @Test fun `a read-only link still reads bots`() = runTest {
        fixture { f ->
            f.ready(readOnly = true)
            assertTrue(f.state.readOnly)
            f.link.requestBots()
            runCurrent()
            f.push("bot-catalog", """"enabled":true,"bots":[
                {"id":"b1","name":"A","title":"t","avatarColor":"#1","status":"idle"}]""")
            assertEquals(listOf("b1"), f.bots!!.members.map { it.id })
            f.link.openBotChat("c1")
            runCurrent()
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[
                {"seq":1,"id":"e","at":1,"kind":"human","text":"hi"}]""")
            assertEquals(1, f.bots!!.timeline.size)
            assertNull(f.bots!!.timelineError)
        }
    }

    @Test fun `a hidden background link refuses bot requests but still projects pushes`() = runTest {
        fixture { f ->
            f.ready()
            f.link.setBackgroundAllowed(true)
            runCurrent()
            f.link.setVisible(false)
            runCurrent()
            f.commands()
            f.link.requestBots()
            f.link.requestInbox()
            f.link.openBotChat("c1")
            f.link.loadBotTimeline("c1", 1)
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.state.bots)
            f.push("bot-catalog", """"enabled":true,"bots":[
                {"id":"b1","name":"A","title":"t","avatarColor":"#1","status":"idle"}]""")
            assertEquals(listOf("b1"), f.bots!!.members.map { it.id })
            f.push("bot-inbox", """"items":[
                {"key":"k","kind":"approval","createdAt":0,"dismissible":true}]""")
            assertEquals(listOf("k"), f.bots!!.inbox.map { it.key })
            // Dropping the retained transport drops the projection with it.
            f.link.setBackgroundAllowed(false)
            runCurrent()
            assertNull(f.state.bots)
        }
    }

    @Test fun `a dropped revoked or replaced link never keeps the old tables`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"bots":[
                {"id":"b1","name":"A","title":"t","avatarColor":"#1","status":"idle"}]""")
            f.push("bot-inbox", """"items":[
                {"key":"k","kind":"approval","createdAt":0,"dismissible":true}]""")
            assertEquals(1, f.bots!!.inbox.size)
            f.socket.failed()
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.state.bots)
        }
        fixture { f ->
            f.ready()
            f.push("bot-inbox", """"items":[
                {"key":"k","kind":"approval","createdAt":0,"dismissible":true}]""")
            f.socket.text("""{"type":"revoked"}""")
            runCurrent()
            assertEquals(LinkPhase.Revoked, f.state.phase)
            assertNull(f.state.bots)
        }
        fixture { f ->
            f.ready()
            f.push("bot-inbox", """"items":[
                {"key":"k","kind":"approval","createdAt":0,"dismissible":true}]""")
            f.socket.closing(1000, "replaced")
            runCurrent()
            assertEquals(LinkPhase.Replaced, f.state.phase)
            assertNull(f.state.bots)
        }
    }

    @Test fun `a bot frame before the replay proof never projects`() = runTest {
        fixture { f ->
            f.link.setVisible(true)
            runCurrent()
            f.socket.binary(f.host.seal(json("""{"type":"bot-catalog","enabled":true,"bots":[]}""")))
            runCurrent()
            assertNull(f.state.bots)
            f.socket.opened()
            f.socket.text("pong")
            f.socket.text("""{"type":"host-online"}""")
            runCurrent()
            f.host.peerReset()
            f.prove()
            assertEquals(LinkPhase.Online, f.state.phase)
            assertNull(f.state.bots)
        }
    }

    @Test fun `a bot send carries the exact command and one generated delivery id`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "  hi  ")
            runCurrent()
            val row = f.commands().single()
            assertEquals(setOf("type", "chatId", "text", "deliveryId"), row.keys)
            assertEquals("bot-send", row["type"].linkString())
            assertEquals("c1", row["chatId"].linkString())
            // The desktop trims with ECMAScript String.trim; the phone sends what the host would store.
            assertEquals("hi", row["text"].linkString())
            val deliveryId = row["deliveryId"].linkString()!!
            assertTrue(deliveryId.isNotBlank())
            val bots = f.bots!!
            val send = bots.send!!
            assertEquals(DesktopBotSendAttempt(deliveryId, "c1", "hi", SessionCommandPhase.Waiting), send)
            assertNull(send.error)
            assertTrue(bots.chatStates.isEmpty())
            assertNull(bots.stop)
            assertNull(bots.error)
        }
    }

    @Test fun `bot text and chat id bounds are inclusive before and after the trim`() = runTest {
        fixture { f ->
            f.ready()
            val maxText = "x".repeat(SESSION_TEXT_LIMIT)
            // The bound applies to the trimmed text, so surrounding JS whitespace does not count.
            f.link.sendBotMessage("c".repeat(BOT_TEXT_LIMIT), "\u2003 $maxText \uFEFF")
            runCurrent()
            val row = f.commands().single()
            assertEquals(BOT_TEXT_LIMIT, row["chatId"].linkString()!!.length)
            assertEquals(maxText, row["text"].linkString())
            f.push("bot-send-result", """"chatId":"${row["chatId"].linkString()}",
                "deliveryId":"${row["deliveryId"].linkString()}","ok":true""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.send!!.phase)
            // One character more is not a message the desktop would accept.
            f.link.sendBotMessage("c1", "y".repeat(SESSION_TEXT_LIMIT + 1))
            runCurrent()
            assertEquals(SessionCommandPhase.Observed, f.bots!!.send!!.phase)
            assertTrue(f.commands().isEmpty())
            // The same bound reached after the trim is still one valid message.
            f.link.sendBotMessage("c1", "\u2003${"y".repeat(SESSION_TEXT_LIMIT)}\u2003")
            runCurrent()
            assertEquals("y".repeat(SESSION_TEXT_LIMIT), f.commands().single()["text"].linkString())
        }
    }

    @Test fun `blank or oversized bot writes never reach the wire`() = runTest {
        fixture { f ->
            f.ready()
            listOf("", "   ", "\u3000\uFEFF", "x".repeat(SESSION_TEXT_LIMIT + 1)).forEach {
                f.link.sendBotMessage("c1", it)
            }
            listOf("", "   ", "c".repeat(BOT_TEXT_LIMIT + 1)).forEach { f.link.sendBotMessage(it, "hi") }
            listOf("", "   ", "c".repeat(BOT_TEXT_LIMIT + 1)).forEach { f.link.stopBotChat(it) }
            runCurrent()
            assertTrue(f.commands().isEmpty())
            // A refused write is refused before any optimistic echo.
            assertNull(f.state.bots)
        }
    }

    @Test fun `a read-only hidden or offline link refuses bot writes`() = runTest {
        fixture { f ->
            f.ready(readOnly = true)
            f.link.sendBotMessage("c1", "hi")
            f.link.stopBotChat("c1")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.state.bots)
        }
        fixture { f ->
            f.ready()
            f.link.setBackgroundAllowed(true)
            runCurrent()
            f.link.setVisible(false)
            runCurrent()
            f.commands()
            f.link.sendBotMessage("c1", "hi")
            f.link.stopBotChat("c1")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.state.bots)
        }
        fixture { f ->
            f.ready()
            f.socket.failed()
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            f.link.sendBotMessage("c1", "hi")
            f.link.stopBotChat("c1")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertNull(f.state.bots)
        }
    }

    @Test fun `a bot send is sent once while one is waiting`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "first")
            runCurrent()
            f.commands()
            f.link.sendBotMessage("c1", "second")
            f.link.sendBotMessage("c2", "third")
            runCurrent()
            assertTrue(f.commands().isEmpty())
            assertEquals("first", f.bots!!.send!!.text)
        }
    }

    @Test fun `a matching bot send result settles success and failure`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "hi")
            runCurrent()
            val deliveryId = f.commands().single()["deliveryId"].linkString()!!
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"$deliveryId","ok":true""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.send!!.phase)
            assertNull(f.bots!!.send!!.error)
            f.link.sendBotMessage("c1", "again")
            runCurrent()
            val next = f.commands().single()["deliveryId"].linkString()!!
            assertNotEquals(deliveryId, next)
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"$next","ok":false,
                "error":"没有可用成员"""")
            val send = f.bots!!.send!!
            assertEquals(SessionCommandPhase.Rejected, send.phase)
            assertEquals("没有可用成员", send.error)
        }
    }

    @Test fun `a silent bot send becomes unconfirmed and is never re-sent`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "hi")
            runCurrent()
            val deliveryId = f.commands().single()["deliveryId"].linkString()!!
            advanceTimeBy(14_900)
            runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.send!!.phase)
            advanceTimeBy(200)
            runCurrent()
            val send = f.bots!!.send!!
            assertEquals(SessionCommandPhase.Unconfirmed, send.phase)
            assertEquals(deliveryId, send.deliveryId)
            assertEquals("hi", send.text)
            assertTrue(f.commands().isEmpty())
            // The expired attempt is kept but never re-sent.
            advanceTimeBy(3_000)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.send!!.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a late or mismatched bot send result only settles its own attempt`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "hi")
            runCurrent()
            val deliveryId = f.bots!!.send!!.deliveryId
            f.commands()
            advanceTimeBy(15_100)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.send!!.phase)
            // Another delivery, another chat or a malformed flag is not this attempt's answer.
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"other","ok":true""")
            f.push("bot-send-result", """"chatId":"c2","deliveryId":"$deliveryId","ok":true""")
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"$deliveryId","ok":"true"""")
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.send!!.phase)
            // A late answer still settles: the association outlives the timeout.
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"$deliveryId","ok":false,
                "error":"群已归档"""")
            val send = f.bots!!.send!!
            assertEquals(SessionCommandPhase.Rejected, send.phase)
            assertEquals("群已归档", send.error)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a bot stop is sent once and observed by a null running state`() = runTest {
        fixture { f ->
            f.ready()
            f.link.stopBotChat("c1")
            f.link.stopBotChat("c1")
            runCurrent()
            assertEquals(listOf("""{"type":"bot-stop","chatId":"c1"}"""), f.sent())
            assertEquals(DesktopBotStopAttempt("c1", SessionCommandPhase.Waiting), f.bots!!.stop)
            // Another chat proves nothing, and a chat that still runs is not stopped.
            f.push("bot-chat-state", """"chatId":"c2","current":null,"queue":[],"hops":0,
                "pendingHuman":false,"turnsByBot":{}""")
            f.push("bot-chat-state", """"chatId":"c1","current":"b1","queue":["x"],"hops":1,
                "pendingHuman":false,"turnsByBot":{"b1":1}""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.stop!!.phase)
            // current == null is the desktop's own answer, even while a queue row is still listed.
            f.push("bot-chat-state", """"chatId":"c1","current":null,"queue":["q"],"hops":0,
                "pendingHuman":true,"turnsByBot":{}""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.stop!!.phase)
            assertEquals(setOf("c1", "c2"), f.bots!!.chatStates.keys)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a silent bot stop becomes unconfirmed without resending`() = runTest {
        fixture { f ->
            f.ready()
            f.link.stopBotChat("c1")
            runCurrent()
            f.commands()
            advanceTimeBy(9_900)
            runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.stop!!.phase)
            advanceTimeBy(200)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.stop!!.phase)
            // A state that arrives after the window no longer proves the stop.
            f.push("bot-chat-state", """"chatId":"c1","current":null,"queue":[],"hops":0,
                "pendingHuman":false,"turnsByBot":{}""")
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.stop!!.phase)
            assertEquals("c1", f.bots!!.chatStates.getValue("c1").chatId)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `bot chat states are validated per chat and a bad frame only drops itself`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-chat-state", """"chatId":"c1","current":"b1","queue":["a","b"],"hops":2,
                "pendingHuman":true,"turnsByBot":{"b1":3}""")
            assertEquals(DesktopBotChatState("c1", "b1", listOf("a", "b"), 2, true),
                f.bots!!.chatStates.getValue("c1"))
            f.push("bot-chat-state", """"chatId":"c2","current":null,"queue":[],"hops":0,
                "pendingHuman":false,"turnsByBot":{}""")
            assertEquals(DesktopBotChatState("c2", null, emptyList(), 0, false),
                f.bots!!.chatStates.getValue("c2"))
            val bad = listOf(
                """"current":null,"queue":[],"hops":0,"pendingHuman":false""",
                """"chatId":"","current":null,"queue":[],"hops":0,"pendingHuman":false""",
                """"chatId":"c1","queue":[],"hops":0,"pendingHuman":false""",
                """"chatId":"c1","current":"","queue":[],"hops":0,"pendingHuman":false""",
                """"chatId":"c1","current":null,"queue":[],"hops":-1,"pendingHuman":false""",
                """"chatId":"c1","current":null,"queue":[],"hops":0.5,"pendingHuman":false""",
                """"chatId":"c1","current":null,"queue":[],"hops":"0","pendingHuman":false""",
                """"chatId":"c1","current":null,"queue":[],"hops":0""",
                """"chatId":"c1","current":null,"queue":[],"hops":0,"pendingHuman":"no"""",
                """"chatId":"c1","current":null,"queue":"none","hops":0,"pendingHuman":false""",
                """"chatId":"c1","current":null,"queue":[""],"hops":0,"pendingHuman":false""",
                """"chatId":"c1","current":null,"queue":["${"q".repeat(BOT_CHAT_QUEUE_TEXT_LIMIT + 1)}"],
                    "hops":0,"pendingHuman":false""",
                """"chatId":"c1","current":null,"queue":[
                    ${(0..BOT_CHAT_QUEUE_LIMIT).joinToString(",") { "\"q$it\"" }}],
                    "hops":0,"pendingHuman":false"""
            )
            bad.forEach { f.push("bot-chat-state", it) }
            // The good rows of both chats survive every malformed frame around them.
            assertEquals(DesktopBotChatState("c1", "b1", listOf("a", "b"), 2, true),
                f.bots!!.chatStates.getValue("c1"))
            assertEquals(DesktopBotChatState("c2", null, emptyList(), 0, false),
                f.bots!!.chatStates.getValue("c2"))
            assertNull(f.bots!!.error)
            // Both bounds are inclusive.
            val maxQueue = (0 until BOT_CHAT_QUEUE_LIMIT)
                .joinToString(",") { "\"${"q".repeat(BOT_CHAT_QUEUE_TEXT_LIMIT)}\"" }
            f.push("bot-chat-state", """"chatId":"c3","current":null,"queue":[$maxQueue],"hops":0,
                "pendingHuman":false""")
            assertEquals(BOT_CHAT_QUEUE_LIMIT, f.bots!!.chatStates.getValue("c3").queue.size)
            assertEquals(BOT_CHAT_QUEUE_TEXT_LIMIT,
                f.bots!!.chatStates.getValue("c3").queue.first().length)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a bot scope denial turns the link read-only and settles its own attempt`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "hi")
            runCurrent()
            val deliveryId = f.commands().single()["deliveryId"].linkString()!!
            f.push("command-rejected", """"command":"bot-send","error":"read-only"""")
            assertTrue(f.state.readOnly)
            val send = f.bots!!.send!!
            assertEquals(SessionCommandPhase.Rejected, send.phase)
            assertEquals(deliveryId, send.deliveryId)
            // A denied scope forbids any further write, and nothing is re-sent.
            f.link.sendBotMessage("c1", "again")
            f.link.stopBotChat("c1")
            runCurrent()
            assertTrue(f.commands().isEmpty())
        }
        fixture { f ->
            f.ready()
            f.link.stopBotChat("c1")
            runCurrent()
            f.commands()
            f.push("command-rejected", """"command":"bot-stop","error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.stop!!.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a late bot scope denial names its own attempt and never the newer one`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "first")
            runCurrent()
            f.commands()
            advanceTimeBy(15_100)
            runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.send!!.phase)
            f.link.sendBotMessage("c1", "second")
            runCurrent()
            val newer = f.bots!!.send!!.deliveryId
            f.commands()
            // The first denial answers the timed-out send; the newer attempt is untouched.
            f.push("command-rejected", """"command":"bot-send","error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.send!!.phase)
            assertEquals(newer, f.bots!!.send!!.deliveryId)
            // The second denial is the newer attempt's own.
            f.push("command-rejected", """"command":"bot-send","error":"read-only"""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.send!!.phase)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `dropping the connection discards bot sends stops and chat states`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "hi")
            f.link.stopBotChat("c1")
            runCurrent()
            val deliveryId = f.bots!!.send!!.deliveryId
            f.push("bot-chat-state", """"chatId":"c1","current":"b1","queue":[],"hops":1,
                "pendingHuman":false""")
            assertEquals(1, f.bots!!.chatStates.size)
            f.commands()
            f.socket.failed()
            runCurrent()
            assertEquals(LinkPhase.Offline, f.state.phase)
            assertNull(f.state.bots)
            // A result of the dead generation is never an answer.
            f.socket.binary(f.host.seal(json("""{"type":"bot-send-result","chatId":"c1",
                "deliveryId":"$deliveryId","ok":true}""")))
            runCurrent()
            assertNull(f.state.bots)
        }
    }

    @Test fun `queued bot writes cannot cross visibility or authenticated host generation`() = runTest {
        fixture { f ->
            f.ready()
            f.link.setBackgroundAllowed(true)
            f.link.setVisible(false)
            f.link.setVisible(true)
            f.link.sendBotMessage("c1", "stale foreground")
            f.link.stopBotChat("c1")
            runCurrent()
            assertFalse(f.sentTypes().any { it in setOf("bot-send", "bot-stop") })
            f.socket.text("""{"type":"host-offline"}""")
            f.socket.text("""{"type":"host-online"}""")
            f.link.sendBotMessage("c1", "stale host")
            f.link.stopBotChat("c1")
            runCurrent()
            assertFalse(f.sentTypes().any { it in setOf("bot-send", "bot-stop") })
        }
    }

    @Test fun `an older idle bot state cannot acknowledge a new stop or overwrite newer running state`() = runTest {
        fixture { f ->
            f.ready()
            val idle = f.host.seal(json("""{"type":"bot-chat-state","chatId":"c1","current":null,"queue":[],"hops":0,"pendingHuman":false}"""))
            f.push("bot-chat-state", """"chatId":"c1","current":"b1","queue":[],"hops":1,"pendingHuman":false""")
            f.link.stopBotChat("c1")
            runCurrent(); f.commands()
            f.socket.binary(idle); runCurrent()
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.stop!!.phase)
            assertEquals("b1", f.bots!!.chatStates.getValue("c1").current)
            f.push("bot-chat-state", """"chatId":"c1","current":null,"queue":[],"hops":0,"pendingHuman":false""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.stop!!.phase)
        }
    }

    @Test fun `bot events coalesce into a fresh read of the open group and never resend a message`() = runTest {
        fixture { f ->
            f.ready()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":1,"hasOlder":false,"entries":[{"seq":1,"id":"e1","at":1,"kind":"human","text":"first"}]""")
            repeat(3) { f.push("bot-event", """"event":{"kind":"timeline","chatId":"c1","seq":2}""") }
            advanceTimeBy(250); runCurrent()
            assertEquals(listOf("""{"type":"bot-chat-open","chatId":"c1"}"""), f.sent())
            // Keep the visible page while refreshing, rather than flashing empty on every event.
            assertEquals("first", f.bots!!.timeline.single().text)
            f.push("group-timeline", """"chatId":"c1","lastSeq":2,"hasOlder":false,"entries":[{"seq":2,"id":"e2","at":2,"kind":"bot","botId":"b1","text":"reply"}]""")
            assertEquals("reply", f.bots!!.timeline.single().text)
            f.push("bot-event", """"event":{"kind":"timeline","chatId":"c2","seq":3}""")
            advanceTimeBy(250); runCurrent()
            assertTrue(f.commands().isEmpty())
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); runCurrent(); f.commands()
            f.push("bot-event", """"event":{"kind":"timeline","chatId":"c1","seq":3}""")
            advanceTimeBy(250); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a bot send read-only response revokes write authority until newer host info`() = runTest {
        fixture { f ->
            f.ready()
            val oldHost = f.host.seal(json("""{"type":"host-info","hostname":"Host"}"""))
            f.link.sendBotMessage("c1", "first"); runCurrent()
            val id = f.commands().single()["deliveryId"].linkString()
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"$id","ok":false,"error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.send!!.phase)
            f.socket.binary(oldHost); runCurrent()
            assertTrue(f.state.readOnly)
            f.link.sendBotMessage("c1", "unauthorized"); f.link.stopBotChat("c1"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a late stop denial for the same chat cannot reject a newer stop`() = runTest {
        fixture { f ->
            f.ready()
            f.link.stopBotChat("c1"); runCurrent(); f.commands()
            advanceTimeBy(10_100); runCurrent()
            f.link.stopBotChat("c1"); runCurrent(); f.commands()
            f.push("command-rejected", """"command":"bot-stop","error":"read-only"""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.stop!!.phase)
            f.push("command-rejected", """"command":"bot-stop","error":"read-only"""")
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.stop!!.phase)
        }
    }

    @Test fun `closing a group drops its pending refresh without sending anything`() = runTest {
        fixture { f ->
            f.ready()
            f.link.openBotChat("c1"); runCurrent(); f.commands()
            f.push("group-timeline", """"chatId":"c1","lastSeq":0,"hasOlder":false,"entries":[]""")
            f.push("bot-event", """"event":{"kind":"timeline","chatId":"c1","seq":1}""")
            f.link.closeBotChat("c1"); runCurrent()
            advanceTimeBy(10_001); runCurrent()
            assertNull(f.bots!!.timelineChatId)
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `a late read-only send result downgrades scope without acknowledging the newer delivery`() = runTest {
        fixture { f ->
            f.ready()
            f.link.sendBotMessage("c1", "first"); runCurrent()
            val oldId = f.commands().single()["deliveryId"].linkString()
            advanceTimeBy(15_100); runCurrent()
            f.link.sendBotMessage("c1", "second"); runCurrent(); f.commands()
            f.push("bot-send-result", """"chatId":"c1","deliveryId":"$oldId","ok":false,"error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals("second", f.bots!!.send!!.text)
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.send!!.phase)
        }
    }

    @Test fun `thread capability and root linked children come only from valid authenticated catalog`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"threads":true,"bots":[]""")
            f.frame(threadDirectory())
            assertTrue(f.bots!!.threadsEnabled)
            assertEquals("child", f.bots!!.chats.single().activeThreadId)
            assertEquals(listOf("child"), f.bots!!.threads.map { it.id })
            f.push("bot-catalog", """"enabled":true,"bots":[]""")
            assertFalse(f.bots!!.threadsEnabled)
        }
    }

    @Test fun `thread changes send once and need matching result without optimistic navigation`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"threads":true,"bots":[]""")
            f.frame(threadDirectory())
            f.link.changeBotThread("root", BotThreadCommand.Select, "root", "child")
            f.link.changeBotThread("root", BotThreadCommand.Create, null, "child")
            runCurrent()
            val command = f.commands().single()
            assertEquals("bot-thread-select", command["type"].linkString())
            assertEquals("root", command["chatId"].linkString())
            assertEquals("root", command["threadId"].linkString())
            val id = command["requestId"].linkString()
            assertTrue(!id.isNullOrBlank())
            assertEquals("child", f.bots!!.chats.single().activeThreadId)
            f.push("bot-thread-result", """"chatId":"wrong","requestId":"$id","ok":true,"threadId":"root"""")
            f.push("bot-thread-result", """"chatId":"root","requestId":"wrong","ok":true,"threadId":"root"""")
            f.push("bot-thread-result", """"chatId":"root","requestId":"$id","ok":true,"threadId":"child"""")
            assertEquals(SessionCommandPhase.Waiting, f.bots!!.threadAction?.phase)
            f.push("bot-thread-result", """"chatId":"root","requestId":"$id","ok":true,"threadId":"root"""")
            assertEquals(SessionCommandPhase.Observed, f.bots!!.threadAction?.phase)
            assertEquals("child", f.bots!!.chats.single().activeThreadId) // Only a catalog changes the selection.
        }
    }

    @Test fun `thread writes reject absent capability readonly cross root stale expected and hidden UI`() = runTest {
        fixture { f ->
            f.ready(); f.frame(threadDirectory())
            f.link.changeBotThread("root", BotThreadCommand.Create, null, "child"); runCurrent()
            assertTrue(f.commands().isEmpty())
            f.push("bot-catalog", """"enabled":true,"threads":true,"bots":[]""")
            f.link.changeBotThread("root", BotThreadCommand.Select, "alien", "child")
            f.link.changeBotThread("root", BotThreadCommand.Create, null, "root")
            f.link.changeBotThread("child", BotThreadCommand.Create, null, "child")
            runCurrent(); assertTrue(f.commands().isEmpty())
            f.link.setBackgroundAllowed(true); f.link.setVisible(false); f.link.setVisible(true)
            f.link.changeBotThread("root", BotThreadCommand.Create, null, "child")
            runCurrent(); assertFalse(f.sentTypes().any { it == "bot-thread-create" })
            f.push("host-info", """"hostname":"Host","readOnly":true""")
            f.link.changeBotThread("root", BotThreadCommand.Create, null, "child"); runCurrent()
            assertTrue(f.commands().isEmpty())
        }
    }

    @Test fun `thread timeout never resends and only matching late result settles while denial revokes scope`() = runTest {
        fixture { f ->
            f.ready()
            f.push("bot-catalog", """"enabled":true,"threads":true,"bots":[]""")
            f.frame(threadDirectory())
            f.link.changeBotThread("root", BotThreadCommand.Create, null, "child"); runCurrent()
            val command = f.commands().single()
            assertEquals("bot-thread-create", command["type"].linkString())
            assertFalse("threadId" in command)
            advanceTimeBy(15_100); runCurrent()
            assertEquals(SessionCommandPhase.Unconfirmed, f.bots!!.threadAction?.phase)
            assertTrue(f.commands().isEmpty())
            f.push("bot-thread-result", """"chatId":"root","requestId":${command["requestId"]},"ok":false,"error":"read-only"""")
            assertTrue(f.state.readOnly)
            assertEquals(SessionCommandPhase.Rejected, f.bots!!.threadAction?.phase)
        }
    }

    private fun threadDirectory() = json("""{"type":"bot-chats","chats":[{"id":"root","kind":"group","title":"Group","members":["b1"],"bossBotId":"b1","updatedAt":1,"lastSeq":1,"activeThreadId":"child"}],"threads":[{"id":"child","parentId":"root","kind":"group","title":"Topic","threadTitle":"Fix login","members":["b1"],"bossBotId":"b1","updatedAt":2,"lastSeq":2},{"id":"archived","parentId":"root","archived":true,"kind":"group","title":"Old","members":[],"bossBotId":null,"updatedAt":0,"lastSeq":0},{"id":"alien","parentId":"another","kind":"group","title":"Other","members":[],"bossBotId":null,"updatedAt":0,"lastSeq":0}]}""")

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
        fun closing(code: Int, reason: String) = listener.onClosing(this, code, reason)
    }

    private companion object {
        fun json(value: String) = Json.parseToJsonElement(value) as JsonObject
    }
}
