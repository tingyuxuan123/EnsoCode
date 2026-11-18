package io.github.tingyuxuan123.eaves.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionStepIconTest {
    @Test fun `工作记录的思考和工具图标与桌面一致`() {
        assertEquals(EnsoIcon.Brain, SessionStep("思考", null, kind = SessionStepKind.Thinking).worklogIcon)
        val examples = mapOf(
            EnsoIcon.FileText to listOf("read"),
            EnsoIcon.FolderOpen to listOf("ls"),
            EnsoIcon.Search to listOf("grep", "find", "glob", "code_search"),
            EnsoIcon.TerminalSquare to listOf("bash", "powershell", "task_output"),
            EnsoIcon.Pencil to listOf("edit", "apply_patch"),
            EnsoIcon.FilePlus to listOf("write"),
            EnsoIcon.BoxSelect to listOf("exec", "codemode"),
            EnsoIcon.Bot to listOf("subagent"),
            EnsoIcon.Globe to listOf("web_fetch", "web_search", "mcp__docs__fetch"),
            EnsoIcon.Wrench to listOf("unknown_tool", "browser_click", ""),
        )
        for ((icon, names) in examples) for (name in names) {
            assertEquals(name, icon, SessionStep(name, "summary").worklogIcon)
        }
    }

    @Test fun `调用失败仍能认出实际工具类型`() {
        assertEquals(EnsoIcon.FileText, SessionStep("read", "test.txt", failed = true).worklogIcon)
    }
}
