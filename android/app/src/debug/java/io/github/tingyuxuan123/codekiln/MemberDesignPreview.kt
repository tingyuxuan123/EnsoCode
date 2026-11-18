package io.github.tingyuxuan123.eaves

import androidx.compose.runtime.Composable
import io.github.tingyuxuan123.eaves.mirror.*
import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import io.github.tingyuxuan123.eaves.ui.EnsoTheme
import io.github.tingyuxuan123.eaves.ui.MembersScreen
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Original members/group/bot TSX copy. Debug-only; never accesses a credential or real chat. */
@Composable
internal fun MemberDesignPreview(frame: String) {
    val now = System.currentTimeMillis()
    val members = listOf(
        DesktopBotMember("lin", "林经理", "项目经理", "#2f6f5e", "running"),
        DesktopBotMember("she", "小设", "设计", "#be185d", "running"),
        DesktopBotMember("ce", "小测", "测试", "#0e7490", "idle"),
        DesktopBotMember("quan", "阿全", "全栈工程师", "#c2410c", "queued"),
        DesktopBotMember("yun", "老运", "运维", "#4b5563", "idle"),
    )
    val texts = listOf("设计已派给小设，FCM 推送排在阿全那里。", "第一档的 8 个页面画好 5 个了。",
        "回归跑完了：38 通过，2 失败。", "等 Firebase 配置，推送先停在这里。", "relay 内存占用回落到 180 MB。")
    val group = DesktopBotChat("group", "group", "Collabra 安卓版", listOf("lin", "she", "quan", "ce"), "lin", now, 7,
        lastText = "林经理：先派设计，小设接一下。", threadTitle = "v1 规划")
    val direct = members.mapIndexed { index, member -> DesktopBotChat("direct-${member.id}", "direct", member.name,
        listOf(member.id), null, now - listOf(2L, 5L, 6L, 12L, 1440L)[index] * 60_000, 0,
        lastText = texts[index], sessions = mapOf(member.id to "sample-${member.id}")) }
    val entries = listOf(
        DesktopGroupEntry(1, "e1", now - 120_000, "human", "@林经理 把安卓版 v1 拆一下，设计稿先出。", null),
        DesktopGroupEntry(2, "e2", now - 60_000, "bot", "收到。拆成三块：设计稿给小设，配对和推送给阿全，回归给小测。先派设计。", "lin"),
        DesktopGroupEntry(3, "e3", now - 50_000, "delegation", "补齐第一档缺的 8 个页面", null,
            delegationId = "d1", from = "lin", to = "she", state = "running"),
        DesktopGroupEntry(4, "e4", now - 40_000, "progress", "已完成 5 / 8 · 正在画通知页", "she", delegationId = "d1", phase = "started"),
        DesktopGroupEntry(5, "e5", now - 30_000, "delegation", "安卓原生推送接 FCM", null,
            delegationId = "d2", from = "lin", to = "quan", state = "blocked"),
        DesktopGroupEntry(6, "e6", now - 20_000, "delegation", "会话恢复相关回归", null,
            delegationId = "d3", from = "lin", to = "ce", state = "completed"),
        DesktopGroupEntry(7, "e7", now - 10_000, "bot", "阿全卡在 Firebase 配置上，这个得你在 Firebase 控制台建好项目，把 json 发到群里。", "lin"),
    )
    val bots = DesktopBotsState(enabled = true, members = members, chats = listOf(group) + direct,
        threadsEnabled = true, groupCreateEnabled = true, newSessionEnabled = true,
        inbox = listOf(DesktopBotInboxItem("i1", "ask", "group", "lin", "安卓版 v1 先做第一档还是连第二档一起？", now, false),
            DesktopBotInboxItem("i2", "approval", "group", "yun", "重启 relay 服务：systemctl restart enso-relay", now, false)),
        timelineChatId = "group", timeline = entries, timelineLastSeq = 7,
        artifacts = DesktopBotArtifacts(DesktopBotArtifactTarget("direct-ce", conversationId = "sample-ce", messageIndex = 1),
            SessionCommandPhase.Observed, artifacts = listOf(
                DesktopBotArtifact("回归报告.md", "回归报告.md", 6348, "markdown"),
                DesktopBotArtifact("失败截图.png", "失败截图.png", 188416, "image"),
            )))
    fun text(type: String, value: String) = buildJsonObject { put("type", type); put("text", value) }
    val session = DesktopSessionState(SessionTimeline("sample-ce", messages = listOf(
        SessionMessage(0, "user", listOf(text("text", "把会话恢复相关的回归跑一遍，有失败给我截图。"))),
        SessionMessage(1, "assistant", listOf(text("thinking", "核对 40 个回归用例。"), text("text", "跑完了：38 通过，2 失败，都在恢复后的重放顺序上。\n\n- `replay keeps order after reconnect`\n- `restored session shows queued echo`\n\n第二个看起来是阿全刚改的 lastSeq 重置把排队回显也清掉了。"))),
    )), loading = false)
    EnsoTheme {
        MembersScreen(bots, {}, {}, { _, _ -> }, session = session, writable = true, onArtifacts = if (frame == "bot") ({}) else null,
            initialChatId = when (frame) { "group" -> "group"; "bot" -> "direct-ce"; else -> null })
    }
}
