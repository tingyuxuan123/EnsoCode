import type { VaultPreset } from './constants';

export const PRESET_TYPES: Record<VaultPreset, readonly string[]> = {
  engineering: ['systems', 'domains', 'incidents', 'practices', 'workflows', 'decisions'],
  personal: ['preferences', 'decisions', 'projects', 'people', 'notes'],
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

## 沉淀时机与原则
仅在以下高价值时机主动沉淀，常规小修不写入：
1. **排障收口**：定位到非显然根因或跨层边界坑。
2. **认知突破**：对复杂系统、协议或业务规则形成稳定新理解。
3. **同题第二次出现**：同一类问题或提醒再次发生，应升格为规则或 Runbook。
4. **决策落地**：用户明确拍板的架构、风格、约束或取舍。

**写入纪律**：先查 \`index.md\` / 搜索已有页面，**更新优先于新建**；每篇聚焦单一主题，通过 \`[[slug]]\` 互相链接，写明证据来源（\`sources\`）。
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

## Capture Triggers & Discipline
Capture only when durable value emerges (zero writes is normal):
1. Root-cause incident wrap-up
2. Non-trivial mental model breakthrough
3. Recurring issue appearing a second time
4. Confirmed user decision or standing constraint

Always search \`index.md\` first; **update existing pages over creating duplicates**, interlink with \`[[wikilink]]\`, and cite \`sources\`.
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
