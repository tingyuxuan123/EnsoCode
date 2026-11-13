import type { ModelReasoningOverride, ModelThinkingLevelOverride } from './llm';

/** 技能与 MCP 服务器：均以引用方式登记，内容留在源应用目录 */

/** 设置页占用估算行；tokens 为 null 表示未探测或失败 */
export interface AssetOccupancyRow {
  id: string;
  tokens: number | null;
  error?: string;
  toolCount?: number;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  /** 技能目录绝对路径（内容不复制，按引用使用） */
  path: string;
  /** 来源展示名，如 Claude Code、插件名 */
  source: string;
  enabled: boolean;
}

export const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export interface McpServerEntry {
  id: string;
  name: string;
  /** 一行用途说明：进系统提示词的按需服务器清单，也是工具搜索的 namespace 描述 */
  description?: string;
  transport: McpTransport;
  /** stdio 用 */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http/sse 用 */
  url?: string;
  /** http/sse 请求头，可含鉴权凭据；配置明文导出时必须脱敏 */
  headers?: Record<string, string>;
  /** OAuth 动态注册时的 client_name：只接受已知客户端的服务器用；缺省 Enso Code */
  oauthClientName?: string;
  /** 授权服务器元数据地址：服务器声明的授权服务器不对或没有声明时，代替自动发现 */
  oauthMetadataUrl?: string;
  /** 连接 + listTools 超时（秒）；缺省 10 */
  connectTimeoutSec?: number;
  /** 单次 callTool 超时（秒）；缺省 120 */
  callTimeoutSec?: number;
  /** deferred：不注入工具 schema，经 `mcp` 代理工具按需连接；缺省 direct */
  loadMode?: McpLoadMode;
  source: string;
  enabled: boolean;
}

export type McpLoadMode = 'direct' | 'deferred';

/** 注入组合预设：会话级选用的 skill/MCP/指令文件集合。
 *  默认预设不入库（DEFAULT_PRESET_ID 运行时合成，语义 = 跟随各条目的 enabled 开关）；
 *  自定义预设按 id 显式集合过滤，忽略条目自身 enabled */
export interface Preset {
  id: string;
  name: string;
  skillIds: string[];
  mcpServerIds: string[];
  /** 注入的指令文件（单主源）；不选则不注入 */
  instructionId?: string;
  /** 自定义开头角色段落的外部正文 UUID 引用；缺省使用 pi 默认，工具及后续规则不变 */
  systemPromptId?: string;
  /** 自建预设可选叠加的原生插件预设；插件失效时仍可单独使用自建预设。 */
  pluginPresetId?: string;
  /** 提示词正文仍放外部存储，不把大段文本写入 settings。 */
  systemPromptTailId?: string;
  boostPromptId?: string;
  refusalRetryPromptId?: string;
  refusalRetry?: boolean;
}

export const DEFAULT_PRESET_ID = 'default';

/** 子代理模型选型模式：agent_pick（必须由主 agent 选择）、follow（跟随会话）、fixed（自选固定模型） */
export type AgentTypeModelMode = 'agent_pick' | 'follow' | 'fixed';

export const DESIGNER_AGENT_NAME = 'designer';

// Open Vetta vetta-ui-design role (resources/design/agents/designer.md, Apache-2.0).
// The final sentence replaces Vetta Team task ownership / Master with EnsoCode's parent messaging.
export const DESIGNER_SYSTEM_PROMPT = `## Core principles: the eight prides and shames

These are the spine of every design you make, from the first question to the last screenshot. They outrank the style defaults in the skill and in the direction sheet. Only the user's words outrank them: when the user asks for, or clearly implies, the opposite (a brutalist poster, a dense terminal, "make it busy"), follow the user and say in one line which principle you broke and why. Hold every design against them before you report back. Each has a test you can run on the screenshot; if you cannot answer a test, redo that part. They hold at every boldness level. The tools repeat them at create, in the direction sheet and after every screenshot; treat each repeat as a checkpoint, not as noise.

1. Take pride in one thing seen first; be ashamed of everything equally large and heavy. *Squint: one focal point is left.*
2. Take pride in grouping with space and alignment; be ashamed of lines and boxes propping up the hierarchy. *Remove every border in your head: the structure survives.*
3. Take pride in objects with light, grain and an edge; be ashamed of a card, ticket or record drawn as a flat rectangle. *The hero object looks like something you could pick up (\`references/taste/texture.md\`).*
4. Take pride in building from what only this product has; be ashamed of the industry template. *Swap in a competitor's logo: the screen stops working.*
5. Take pride in real data, pictures and words; be ashamed of invented figures, fake picture slots and lorem. *Every number traces to the brief or the data file.*
6. Take pride in one bold move with everything else quiet; be ashamed of effort and ornament everywhere. *You can name the screen's one thing in a sentence.*
7. Take pride in type with character and a real step in size; be ashamed of one face at two sizes. *Heading and body do not sound like the same voice.*
8. Take pride in colour with a source, used where it matters; be ashamed of default purple-blue gradients and accent on everything. *You can say where each colour comes from.*

You are the visual design specialist in an agent team. Produce the UI itself — app screens, landing pages, slides, posters, infographics — on the Vetta design canvas, and always work through the Vetta UI Design skill (vetta-ui-design): read it before your first frame and follow it over any habit of your own. A design document is a .vetd directory of real TSX frames, so create or open one with the vetd_* tools rather than describing a design in prose or writing HTML mockups by hand. Watch for these: pick the product type from what the user actually asked for before creating anything, and never default a dashboard to a phone frame; for a landing page or app screens pass brief (and sector for a landing page) and intent (only what the user actually said) to vetd_create; a landing page gets three dealt directions, while for app screens you write the obvious version you would make by habit and propose three directions of your own with vetd_direction that each depart from it, start from something only this product has, and differ from each other; ask the user the look question that comes back plus whatever else their prompt left open that would change the design — learn their preferences before designing without pestering them, and never ask what they already said — then choose one with vetd_direction and adopt its sheet, for slides and posters set one from the skill, and replace the scaffold palette before the first frame, because the defaults are exactly what reads as AI-generated; reach for whitespace, alignment and surface tone before borders, and ask of each line, divider or card wrapper what it does that space could not — plenty of them answer it, the ones drawn out of habit do not; declare the frame meta as the first statement of every frame file; keep icons as Iconify classes and never import an icon package, a CSS framework, or a router; add a theme token to theme.css before using it, because an unresolved class renders nothing at all; put shared chrome in a component or _layout.tsx instead of pasting it into each frame. Verify with vetd_screenshot and clear every reported issue before you report back, and describe the design decisions you made and the screens you delivered. This role covers design documents only: front-end work inside the user's own codebase belongs to the production specialist, and none of the canvas rules apply there. Report your results to the parent agent, and use message_main_agent to ask the parent agent when required information is missing.`;

/** 内置 subagent 类型（默认启用,可关闭不可删；模型默认由主 agent 选择） */
export const BUILTIN_AGENT_TYPES: Omit<AgentTypeEntry, 'id'>[] = [
  {
    name: 'scout',
    description: 'Fast read-only recon; returns compressed findings',
    systemPrompt:
      'You are a fast reconnaissance agent. Read and search only — never modify files or run commands with side effects. ' +
      'Return a compact, well-structured report of findings with concrete file paths.',
    tools: 'readonly',
    modelMode: 'agent_pick',
  },
  {
    name: 'worker',
    description: 'Implements a self-contained coding subtask end to end',
    systemPrompt:
      'You are an implementation agent. Complete the assigned coding subtask end to end: read the relevant code, ' +
      'make the changes, and verify them (typecheck/tests where available). Report what you changed and any follow-ups.',
    tools: 'all',
    modelMode: 'agent_pick',
  },
  {
    name: 'reviewer',
    description: 'Reviews code or diffs; read-only, returns prioritized issues',
    systemPrompt:
      'You are a code review agent. Read the relevant code or diff and return a prioritized list of concrete issues ' +
      '(correctness first), each with file:line and a suggested fix. Do not modify anything.',
    tools: 'readonly',
    modelMode: 'agent_pick',
  },
  {
    name: 'tester',
    description:
      'Writes failing tests first (TDD RED); can only write test files, never implementation',
    systemPrompt:
      'You are a test-first author. Write failing tests that pin down the contract described in the task, ' +
      'run them and confirm each fails because the behavior is missing (not because of a typo). ' +
      'Never write or edit implementation files — only test files (the toolset enforces this). ' +
      'Read specs, type contracts and existing tests; avoid reading the implementation body of the module ' +
      'under test so the tests stay independent of it. ' +
      'Do only the slice in this turn — do not expand to adjacent modules or the rest of the PRD. ' +
      'After the slice is red for the right reason, stop and wait for the parent to send the next slice or a green audit. ' +
      'Report the test files, case counts, and the exact failure reasons.',
    tools: 'all',
    writeScope: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', 'test/**'],
    modelMode: 'agent_pick',
  },
  {
    name: DESIGNER_AGENT_NAME,
    description:
      'Creates standalone UI mockups, posters, and slides on the design canvas; not for front-end implementation in the user’s codebase.',
    systemPrompt: DESIGNER_SYSTEM_PROMPT,
    tools: 'all',
    modelMode: 'agent_pick',
  },
];

/** 自定义 subagent 类型：绑定系统提示/模型/工具集,经 subagent 工具的 agent_type 参数选用 */
export interface AgentTypeEntry {
  id: string;
  /** slug（工具参数值,如 scout） */
  name: string;
  /** 模型选型依据（注入工具描述） */
  description: string;
  /** 子会话系统提示（前置进任务 prompt） */
  systemPrompt: string;
  /** 模型选型模式：agent_pick（必须由主 agent 选择）、follow（跟随会话）、fixed（自选固定模型） */
  modelMode?: AgentTypeModelMode;
  /** 绑定模型；在 modelMode 为 fixed 时必选 */
  providerId?: string;
  modelId?: string;
  /** 类型级推理覆盖（与模型选型模式无关）；缺省 = 跟随模型条目 / 父会话 */
  reasoning?: ModelReasoningOverride;
  thinkingLevel?: ModelThinkingLevelOverride;
  /** 工具集：all 全部 / readonly 仅只读（read+grep/find/ls + 本类型绑定的 MCP，无 bash/edit/write） */
  tools: 'all' | 'readonly';
  /** 可写路径 glob 白名单（相对 cwd，posix）；只约束 edit/write；缺省不限 */
  writeScope?: string[];
  /** 启用的 skill（按 SkillEntry id 精选；缺省无） */
  skillIds?: string[];
  /** 启用的 MCP server（按 McpServerEntry id 精选；缺省无） */
  mcpServerIds?: string[];
}

/**
 * 子代理可选模型条目（设置页「允许子代理指定模型」列表）。
 * 只存 provider entry id + model id，凭证由 main 在 spawn 时解析；
 * description 是选型依据，注入 subagent/coworker 工具的 model 参数说明。
 */
export interface SubagentModelEntry {
  id: string;
  providerId: string;
  modelId: string;
  description: string;
  /** 缺省启用；关闭仅移出子代理候选，保留条目配置 */
  enabled?: boolean;
  /** 条目级推理覆盖；缺省 = 跟随父会话（不存 'follow'） */
  reasoning?: ModelReasoningOverride;
  /** 推理开启时的思考档位覆盖；缺省 = 跟随父会话 */
  thinkingLevel?: ModelThinkingLevelOverride;
}

/** 全局指令 / 记忆文件：CLAUDE.md、AGENTS.md、GEMINI.md、SOUL.md 等
 *  默认指向源应用的原文件（跟随其更新）；一旦在应用内编辑，
 *  先复制为本地副本再改，不回写源文件 */
export interface InstructionEntry {
  id: string;
  /** 条目名，可重命名 */
  name: string;
  /** 来源展示名 */
  source: string;
  /** 原文件路径；无文件来源（如 CC Switch prompts）为空 */
  sourcePath?: string;
  /** true 表示内容已复制到 userData/instructions/<id>.md，不再跟随源文件 */
  local: boolean;
  bytes: number;
  enabled: boolean;
}
