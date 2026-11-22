package io.github.tingyuxuan123.codekiln.ui

import io.github.tingyuxuan123.codekiln.mirror.DesktopSessionState
import io.github.tingyuxuan123.codekiln.pair.SessionMessage
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal data class SessionWorkingStatus(
    val phrases: List<String>,
    val lastOutput: SessionMessage?,
    val showElapsed: Boolean = true,
)

private val generalPhrases = listOf("理清脉络", "核对边界", "梳理上下文", "推演一番")
private val editTools = setOf("write", "edit", "apply_patch", "write_file")
private val searchTools = setOf("grep", "find", "glob", "code_search", "tool_search")
private val shellTools = setOf("bash", "powershell")

/** The cue is presentation only: no tool argument, approval summary or thinking text is replayed. */
internal fun sessionWorkingStatus(state: DesktopSessionState?, online: Boolean): SessionWorkingStatus? {
    if (!online || state == null || state.loading || state.error) return null
    val compacting = state.compaction?.state == "start"
    if (!state.running && !compacting) return null
    val timeline = state.timeline
    val waiting = when {
        timeline.approvals.any { !it.reviewing } -> "等待你批准"
        timeline.asks.isNotEmpty() -> "等你回答"
        timeline.approvals.isNotEmpty() -> "正在检查操作"
        else -> null
    }
    if (waiting != null) return SessionWorkingStatus(listOf(waiting), null, showElapsed = false)
    val messages = timeline.messages
    val user = messages.indexOfLast { it.role == "user" && it.sessionNotice() == null }
    val currentTurn = messages.subList(user + 1, messages.size)
    val pulse = currentTurn.lastOrNull { it.role == "assistant" || it.role == "toolResult" }
        ?: messages.getOrNull(user)
    val phrases = if (compacting) listOf("正在压缩上下文") else cuePhrases(currentTurn)
    return SessionWorkingStatus(phrases, pulse)
}

private fun cuePhrases(turn: List<SessionMessage>): List<String> {
    for (i in turn.indices.reversed()) {
        val message = turn[i]
        when (message.role) {
            "toolResult" -> {
                val call = message.toolCallId?.takeIf { it.isNotBlank() }?.let { id ->
                    (i - 1 downTo 0).asSequence().filter { turn[it].role == "assistant" }
                        .flatMap { turn[it].content.asReversed().asSequence() }
                        .firstOrNull { it["type"].workingString() == "toolCall" && it["id"].workingString() == id &&
                            (message.toolName == null || it["name"].workingString() == message.toolName) }
                }
                return toolPhrases(message.toolName ?: call?.get("name").workingString(), call, message)
            }
            "assistant" -> for (part in message.content.asReversed()) when (part["type"].workingString()) {
                "toolCall" -> return toolPhrases(part["name"].workingString(), part, null)
                "text" -> if (part["text"].workingString()?.isNotBlank() == true) {
                    return listOf("正在整理回复", "组织表达", "核对回复细节")
                }
                // Thinking does not displace the last actual tool cue or leak the reasoning body.
            }
        }
    }
    return generalPhrases
}

private fun toolPhrases(tool: String?, call: JsonObject?, result: SessionMessage?): List<String> {
    val args = call?.get("arguments") as? JsonObject
    val path = args?.get("path").workingString() ?: args?.get("file_path").workingString()
    val file = shortName(result?.toolFileName ?: path)
    val pending = result == null
    if (result?.isError == true && tool !in shellTools) return listOf("检查工具返回的错误", "回看上一步的结果")
    return when (tool) {
        "read" -> if (file == null) listOf("查看文件内容", "梳理文件上下文") else
            if (pending) listOf("正在查看 $file") else listOf("细看 $file 的上下文", "对照 $file 的实现")
        in editTools -> if (file == null) listOf("检查文件改动", "核对修改范围") else
            if (pending) listOf("准备修改 $file") else listOf("确认 $file 的边界情况", "复核刚改的 $file", "检查 $file 的改动影响")
        in shellTools -> when {
            pending -> listOf("等待命令执行结果", "留意命令的实时输出")
            result?.isError == true -> listOf("顺着命令报错溯源", "检查命令为什么失败")
            else -> listOf("细读命令输出", "从运行结果里找线索")
        }
        in searchTools -> listOf("筛选检索结果", "顺着命中的线索摸排")
        "ls" -> if (file != null) listOf("摸清 $file 的目录结构", "盘点 $file 里的文件") else listOf("查看目录结构")
        "subagent" -> listOf("跟进子代理的进展", "汇合子代理的结果")
        "generate_image", "edit_image" -> if (pending) listOf("等待图片处理结果") else listOf("端详刚生成的画面", "审视新图的细节")
        "exec", "codemode", "workflow" -> listOf("跟进工具编排", "整理工具返回的结果")
        else -> when {
            tool?.startsWith("browser_") == true -> listOf("查看浏览器里的页面", "核对页面的最新状态")
            tool != null && ("web" in tool || "fetch" in tool) -> listOf("查看网页资料", "提炼网页上的关键信息")
            else -> generalPhrases
        }
    }
}

private fun shortName(path: String?): String? {
    if (path == null || path.length > 4_096) return null
    val name = path.trim().trimEnd('/', '\\').substringAfterLast('/').substringAfterLast('\\').trim()
    if (name.isEmpty() || name == "." || name == ".." || name.any(Char::isISOControl) || name.startsWith('{') || name.startsWith('[')) return null
    val count = name.codePointCount(0, name.length)
    return if (count <= 24) name else name.substring(0, name.offsetByCodePoints(0, 23)) + "…"
}

private fun JsonElement?.workingString(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

internal fun formatWorkingElapsed(elapsedMs: Long): String {
    val seconds = elapsedMs.coerceAtLeast(0) / 1_000
    return if (seconds < 60) "$seconds 秒" else "${seconds / 60} 分 ${seconds % 60} 秒"
}
