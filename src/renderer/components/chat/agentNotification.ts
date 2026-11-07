export interface SubagentNotice {
  header: string;
  report: string;
  usage: { tokens: number; toolUses: number; durationMs: number };
}

const HEADER =
  /^Subagent "[^\n]*" \(agentId ([^,\s]+), runId ([^)\s]+)\) (?:succeeded|failed|cancelled|interrupted) after [^\n]+\.\n/;
const FOOTER =
  /\n<usage>subagent_tokens: (\d+)\ntool_uses: (\d+)\nduration_ms: (\d+)<\/usage>\nUse subagent report with runId (\S+) for the full result\.(?: To continue this coworker, use subagent send with agentId (\S+)\.)?$/;

/** 只投影 Main completionText 的完整包络；未知格式退回原文，不修改模型收到的通知。 */
export function parseAgentNotification(body: string): SubagentNotice[] | null {
  const text = body.replaceAll('\r\n', '\n').trim();
  const chunks = text.split(/\n\n---\n\n(?=Subagent "[^\n]*" \(agentId )/);
  const notices: SubagentNotice[] = [];
  for (const chunk of chunks) {
    const header = HEADER.exec(chunk);
    const footer = FOOTER.exec(chunk);
    if (
      !header ||
      !footer ||
      footer.index < header[0].length - 1 ||
      footer[4] !== header[2] ||
      (footer[5] !== undefined && footer[5] !== header[1])
    )
      return null;
    const [tokens, toolUses, durationMs] = footer.slice(1, 4).map(Number);
    if (![tokens, toolUses, durationMs].every(Number.isSafeInteger)) return null;
    notices.push({
      header: header[0].trimEnd(),
      report: chunk.slice(header[0].length, footer.index).trim(),
      usage: { tokens, toolUses, durationMs },
    });
  }
  return notices;
}
