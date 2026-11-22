import type { VaultPreset } from './constants';

export const PRESET_TYPES: Record<VaultPreset, readonly string[]> = {
  engineering: ['systems', 'domains', 'incidents', 'practices', 'workflows', 'decisions', 'status'],
  personal: ['preferences', 'decisions', 'projects', 'people', 'notes', 'status'],
  minimal: ['notes'],
};

export function defaultPresetForSpace(spaceId: string): VaultPreset {
  if (spaceId.startsWith('proj:') || spaceId.startsWith('chat:')) return 'engineering';
  return 'personal';
}

export function buildPresetSchemaMarkdown(preset: VaultPreset, language: string = 'zh'): string {
  const zh = language === 'zh' || language === 'auto';
  if (preset === 'engineering') {
    return zh
      ? `# 知识库约定（通用软件工程）

本目录遵循 **Open Knowledge Format (OKF v0.2)** 与 **LLM Wiki** 规范，可直接在 Obsidian 中打开和编辑。

## 目录分工
- \`wiki/\`：AI 与人共同演化的 Evergreen 知识页，按概念/主题组织，使用 \`[[wikilink]]\` 互联。
- \`raw/\`：只读参考资料（例如由脚本自动导出的数据库表字段元数据、外部 PRD、规格稿）。AI 只读不改，Wiki 页面通过 \`[[raw/...]]\` 引用并补充业务语义。
- \`archive/\`：过时或被替代的笔记（标 \`status: deprecated\` 与 \`superseded_by\`），不静默删除。
- \`index.md\`：由 Collabra 自动维护的目录总览（不要手工改动托管区块）。
- \`log.md\`：只追加的变更审计日志。

## 推荐分类（Frontmatter \`type\`）
- \`systems\`：系统架构、模块契约、数据流与边界
- \`domains\`：业务领域模型、核心概念、术语与规则
- \`incidents\`：真实故障与踩坑复盘（症状 / 根因 / 修法 / 回归防线）
- \`practices\`：可复用工程最佳实践、编码与测试规范
- \`workflows\`：常用操作流程、发版与排查 Runbook
- \`decisions\`：重要架构/技术选型决策及放弃的备选方案
- \`status\`：当前进展、下一步与卡点的单页视图，不是知识页

## 状态页（每空间唯一）
- 固定放在 \`wiki/status.md\`，\`type: status\`；一个空间只有这一篇描述“现在”。
- 只写仍然活跃的工作、下一步和卡点，每条带日期与来源；完成的事项移出状态页，结论写进对应主题页。
- 整篇覆盖写，首行保留 \`As of YYYY-MM-DD\`；正文预算 60 行。

## 沉淀时机与原则
仅在以下高价值时机主动沉淀，常规小修不写入：
1. **排障收口**：定位到非显然根因或跨层边界坑。
2. **认知突破**：对复杂系统、协议或业务规则形成稳定新理解。
3. **同题第二次出现**：同一类问题或提醒再次发生，应升格为规则或 Runbook。
4. **决策落地**：用户明确拍板的架构、风格、约束或取舍。

**写入纪律**：先查 \`index.md\` / 搜索已有页面，**更新优先于新建**；每篇聚焦单一主题，通过 \`[[slug]]\` 互相链接，写明证据来源（\`sources\`）。

**就地重写**：页面只描述当前成立的事实。更新同一主题时改写原文并删掉被取代的陈述，不要留 \`Update (日期)\`、变更记录或"以前是 X、现在是 Y"；一个事实只写在一处，其余页面用 \`[[slug]]\` 引用。

**写结论，不写路径**：只写已经确立的结论，不记录被排除的候选、放弃的假设和尝试顺序（用户明确要求保留时才写）。
`
      : `# Vault Schema (Software Engineering)

This vault follows **Open Knowledge Format (OKF v0.2)** and the **LLM Wiki** pattern, fully compatible with Obsidian.

## Layout
- \`wiki/\`: Evergreen concept pages co-maintained by human and AI, connected with \`[[wikilink]]\`.
- \`raw/\`: Read-only source inputs (e.g. script-generated DB schema exports, PRDs, external specs). AI reads without overwriting.
- \`archive/\`: Superseded pages (\`status: deprecated\` + \`superseded_by\`); never silently deleted.
- \`index.md\`: Auto-maintained catalog managed by Collabra.
- \`log.md\`: Append-only change audit trail.

## Recommended \`type\` Categories
- \`systems\`: Architecture, module boundaries, data flows
- \`domains\`: Business concepts, domain rules, terminology
- \`incidents\`: Root-cause postmortems (symptom, root cause, fix, guardrails)
- \`practices\`: Reusable engineering conventions and testing rules
- \`workflows\`: Runbooks, release and debugging procedures
- \`decisions\`: Committed design choices and rejected alternatives
- \`status\`: One-screen view of current work, next step, and blockers (not a knowledge page)

## Status Page (one per vault)
- Always lives at \`wiki/status.md\` with \`type: status\`; one page per vault describes "now".
- Keep only active work, the next step and blockers, each with its date and source. Finished work leaves the page; its conclusions go to the owning topic page.
- Overwrite the whole body and keep an \`As of YYYY-MM-DD\` first line. Budget: 60 lines.

## Capture Triggers & Discipline
Capture only when durable value emerges (zero writes is normal):
1. Root-cause incident wrap-up
2. Non-trivial mental model breakthrough
3. Recurring issue appearing a second time
4. Confirmed user decision or standing constraint

Always search \`index.md\` first; **update existing pages over creating duplicates**, interlink with \`[[wikilink]]\`, and cite \`sources\`.

**Rewrite in place**: a page states what is true now. When updating a topic, rewrite the affected text and delete the statements it supersedes. No \`Update (date)\` lines, changelog sections, or "previously X, now Y"; one fact lives in one page, other pages reference it with \`[[slug]]\`.

**Write conclusions, not the path**: record what was established, not the eliminated candidates, abandoned hypotheses, or order of attempts (unless the user asked to keep them).
`;
  }

  if (preset === 'personal') {
    return zh
      ? `# 知识库约定（个人与偏好）

本目录遵循 **Open Knowledge Format (OKF v0.2)**，可直接在 Obsidian 中浏览和修订。

## 推荐分类（Frontmatter \`type\`）
- \`preferences\`：长期有效的协作偏好、沟通风格、工具与环境约束
- \`decisions\`：跨项目的长期决策与原则
- \`projects\`：正在推进的重点主题背景与目标
- \`people\`：协作者、团队分工与语境
- \`notes\`：其他可复用的通用知识卡片
- \`status\`：正在进行的事与卡点的单页视图（\`wiki/status.md\`，整篇覆盖写，≤60 行，首行 \`As of YYYY-MM-DD\`）

## 写入原则
- 先搜后写，更新既有主题页优先于新建碎片笔记。
- 只记录跨会话有复利价值的稳定事实与偏好，不写一次性寒暄或临时进度。
- 用 \`[[wikilink]]\` 连接相关概念，保留 \`sources\` 溯源。
`
      : `# Vault Schema (Personal & Preferences)

This vault follows **Open Knowledge Format (OKF v0.2)** and works natively in Obsidian.

## Recommended \`type\` Categories
- \`preferences\`: Standing working style, tool choices, and behavioral constraints
- \`decisions\`: Long-term cross-project decisions and principles
- \`projects\`: Active multi-session goals and context
- \`people\`: Collaborators, roles, and shared context
- \`notes\`: General evergreen notes
- \`status\`: One-screen view of what is in progress (\`wiki/status.md\`, overwrite, <=60 lines, first line \`As of YYYY-MM-DD\`)

## Principles
- Search first; update existing evergreen pages rather than creating fragments.
- Store only durable preferences, decisions, and reusable insights.
- Interlink related notes with \`[[wikilink]]\` and record \`sources\`.
`;
  }

  return zh
    ? `# 知识库约定（极简模式）

本目录兼容已有 Obsidian Vault 结构，遵循 **OKF v0.2** Frontmatter 规范（\`type\` 为开放词表，默认 \`notes\`）。

- 先搜后写，更新优先于新建。
- 使用 \`[[wikilink]]\` 关联已有笔记，保留用户原有 Frontmatter 属性。
`
    : `# Vault Schema (Minimal)

Compatible with existing Obsidian vaults using **OKF v0.2** frontmatter (open \`type\` vocabulary, default \`notes\`).

- Search first; prefer updating existing pages over creating duplicates.
- Interlink notes using \`[[wikilink]]\` while preserving custom frontmatter properties.
`;
}
