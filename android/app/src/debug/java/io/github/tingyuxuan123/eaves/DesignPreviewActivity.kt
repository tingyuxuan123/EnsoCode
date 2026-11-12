package io.github.tingyuxuan123.eaves

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import io.github.tingyuxuan123.eaves.ui.NewTaskUiState
import io.github.tingyuxuan123.eaves.ui.PairSpecimen
import io.github.tingyuxuan123.eaves.ui.TaskStatus
import io.github.tingyuxuan123.eaves.ui.TaskSummary
import io.github.tingyuxuan123.eaves.ui.SessionHeader
import io.github.tingyuxuan123.eaves.ui.SessionSpecimen
import io.github.tingyuxuan123.eaves.mirror.DesktopSessionState
import io.github.tingyuxuan123.eaves.mirror.DesktopLinkState
import io.github.tingyuxuan123.eaves.mirror.DesktopProject
import io.github.tingyuxuan123.eaves.mirror.DesktopProvider
import io.github.tingyuxuan123.eaves.mirror.DesktopModel
import io.github.tingyuxuan123.eaves.mirror.DesktopQueuedMessage
import io.github.tingyuxuan123.eaves.mirror.LinkPhase
import io.github.tingyuxuan123.eaves.pair.SessionApproval
import io.github.tingyuxuan123.eaves.pair.SessionAsk
import io.github.tingyuxuan123.eaves.pair.SessionMessage
import io.github.tingyuxuan123.eaves.pair.SessionTimeline
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Debug-only canvas comparison. Never loads a real task or touches device credentials. */
class DesignPreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val frame = intent.getStringExtra("frame")
        val route = when (frame) {
            "pair" -> EavesRoute.Pair
            "home", "empty" -> EavesRoute.Home
            "session", "ask", "queue" -> EavesRoute.Session
            else -> EavesRoute.NewTask
        }
        setContent {
            if (frame in setOf("members", "group", "bot")) {
                MemberDesignPreview(frame ?: "members")
                return@setContent
            }
            EavesApp(route, state = if (frame == "empty") sample.copy(tasks = emptyList()) else sample,
                pairSpecimen = PairSpecimen("192.168.1.24:47821", "48219"),
                initialShowConfig = frame == "new-config",
                live = when (frame) { "new-config" -> configSample; "queue" -> DesktopLinkState(readOnly = false); else -> DesktopLinkState() },
                onSessionQueue = if (frame == "queue") ({ _, _, _, _ -> }) else null,
                sessionSpecimen = when (frame) { "session" -> approvalSample; "ask" -> askSample; "queue" -> queueSample; else -> null })
        }
    }
}

// Exact model copy from frames/new-config.tsx, only in the debug APK.
private val configSample = DesktopLinkState(phase = LinkPhase.Online, readOnly = false,
    projects = listOf(DesktopProject("sample-project", "小满")),
    providers = listOf(
        DesktopProvider("sample-anthropic", "Anthropic", listOf(DesktopModel("sample-opus", "Claude Opus 5.5"))),
        DesktopProvider("sample-openai", "OpenAI", listOf(DesktopModel("sample-gpt", "GPT-6.1"))),
        DesktopProvider("sample-deepseek", "DeepSeek", listOf(DesktopModel("sample-flash", "DeepSeek V4.1 Flash"))),
    ))

// ensocode-android.vetd/components/data.ts; keep source copy out of the release variant.
private val sample = NewTaskUiState(
    greeting = "下午好，tingyu",
    model = "Claude Opus 5.5 · 高",
    project = "小满",
    online = true,
    computer = "tingyu 的 MacBook Pro",
    pendingMemberCount = 2,
    tasks = listOf(
        TaskSummary("s1", "会话恢复后时间线为空", "小满", "刚刚", TaskStatus.Waiting, pinned = true),
        TaskSummary("s4", "首页 Hero 用哪张截图", "ensocode-site", "4 分钟前", TaskStatus.Waiting),
        TaskSummary("s2", "工作流面板显示运行进度", "小满", "2 分钟前", TaskStatus.Running),
        TaskSummary("s3", "Windows 版 CI 签名失败排查", "小满", "6 分钟前", TaskStatus.Running),
        TaskSummary("s8", "终端主题跟随桌面同步", "pi-extensions", "25 分钟前", TaskStatus.Error),
        TaskSummary("s5", "子代理报告被截断", "小满", "1 小时前", TaskStatus.Done),
        TaskSummary("s6", "解释 apply_patch 的格式", null, "2 小时前", TaskStatus.Done),
        TaskSummary("s7", "MCP env 明文只保留在 Main", "小满", "昨天", TaskStatus.Done),
        TaskSummary("s9", "发布 personal-v0.9.4", "小满", "周三", TaskStatus.Done),
    ),
)

private fun part(type: String, text: String) = JsonObject(mapOf("type" to JsonPrimitive(type), "text" to JsonPrimitive(text)))

private val queueSample = SessionSpecimen(
    header = SessionHeader("工作流面板显示运行进度", "小满 · Claude Opus 5.5 · 高"),
    state = DesktopSessionState(SessionTimeline("queue-specimen", status = "running", messages = listOf(
        SessionMessage(0, "user", listOf(part("text", "给工作流面板加上运行进度：每个审查员一格，完成打勾。"))),
        SessionMessage(1, "assistant", listOf(part("thinking", "检查工作流进度"),
            part("text", "进度条已经接上 `workflow/progress` 事件，每个审查员一格，完成后变成实心。现在跑一下相关测试。"))),
    )), loading = false, queueReady = true, queued = listOf(
        DesktopQueuedMessage("q1", "审查员卡住超过 5 分钟就把那一格标成黄色。"),
        DesktopQueuedMessage("q2", "完成后顺手把 workflowPanel 的快照测试更新一下。"),
        DesktopQueuedMessage("q3", "最后跑一遍 pnpm typecheck && pnpm lint，别提交。"),
    )), turnTime = "2 分钟前", steps = "已完成 6 步 · 改了 2 个文件",
)

// Original TSX copies and screenshot assets remain a debug-only design specimen.
private val approvalSample = SessionSpecimen(
    header = SessionHeader("会话恢复后时间线为空", "小满 · Claude Opus 5.5 · 高"),
    state = DesktopSessionState(SessionTimeline("approval-specimen", messages = listOf(
        SessionMessage(0, "user", listOf(part("text", "恢复会话后时间线是空的，但 jsonl 里明明有记录。帮我查根因，修好并补测试。"))),
        SessionMessage(1, "assistant", listOf(part("thinking", "检查 reducer 与回放事件"),
            part("text", "根因在 renderer 的 reducer：恢复时 worker 从 seq 1 重新回放事件，而 store 还留着旧连接的 `lastSeq = 412`，回放的事件全被当成过期丢掉了。\n\n- 恢复时用回放的第一个 seq 重置 lastSeq\n- 新增测试：断开再恢复，时间线条数与 jsonl 一致"))),
    ), approvals = listOf(SessionApproval("fixture-approval", "bash", "command", "pnpm test -- sessionReducer"))), loading = false),
    date = "今天 14:02", turnTime = "3 分钟前", steps = "已完成 7 步 · 读了 5 个文件，跑了 1 次测试",
    changeSummary = true, approvalMode = "全程审批", approvalNote = "在 E:\\project\\EnsoCode 中执行 · 只读，不会改动文件",
)

private val askSample = SessionSpecimen(
    header = SessionHeader("首页 Hero 用哪张截图", "ensocode-site · Claude Opus 5.5 · 高"),
    state = DesktopSessionState(SessionTimeline("ask-specimen", messages = listOf(
        SessionMessage(0, "user", listOf(part("text", "把官网首页的 Hero 换成新版工作区的截图。"))),
        SessionMessage(1, "assistant", listOf(part("thinking", "比较两张截图"),
            part("text", "仓库里有两张新截图可以用：浅色的 `workspace-current.png` 是项目导航加新任务，深色的那张展开了并行审查工作流。\n\n官网 Hero 是白底，我倾向浅色，但想先确认一下。"))),
    ), asks = listOf(SessionAsk("fixture-ask", "Hero 用浅色还是深色截图？",
        listOf("浅色", "深色", "两张都放，跟随系统主题切换"), expiresAt = 1))), loading = false),
    turnTime = "4 分钟前", steps = "已完成 3 步 · 读了 README 和 2 张截图",
    askImages = listOf("workspace-current.png", "workflows-current.png"),
)
