import type { BackgroundTaskInfo, ProjectedMessage, TodoItem } from '@shared/types/agent';
import type { SubagentDirectoryEntry } from '@/lib/subagentTargets';
import { splitTrailingJson } from '@/stores/sessions/timeline';

/** 弹层筛选：最近（最新若干条）/ 进行中 / 已完成 / 全部 */
export type DockFilter = 'recent' | 'running' | 'done' | 'all';
export const DOCK_FILTERS: readonly DockFilter[] = ['recent', 'running', 'done', 'all'];
/** 「最近」显示的条数 */
const RECENT_LIMIT = 6;

export interface DockSummary {
  total: number;
  running: number;
  failed: number;
}

export const defaultDockFilter = (running: number): DockFilter =>
  running > 0 ? 'running' : 'recent';

/** 输入框上方「当前进度」按钮：最新未完成清单的 已完成/总数 */
export interface TodoDockSummary {
  done: number;
  total: number;
  /** 有进行中的项（按钮转圈） */
  active: boolean;
}

export function todoDockSummary(
  list: { id: string; todos: readonly TodoItem[] } | null | undefined
): TodoDockSummary | null {
  if (!list || list.todos.length === 0) return null;
  return {
    done: list.todos.filter((todo) => todo.status === 'completed').length,
    total: list.todos.length,
    active: list.todos.some((todo) => todo.status === 'in_progress'),
  };
}

/** 活跃 Run：与侧边栏 Agents 目录同口径，待命协作者与已结束实例不算运行 */
export const isDockAgentRunning = (entry: SubagentDirectoryEntry): boolean =>
  !entry.closed && !entry.ended && entry.status !== 'waiting';

export function bashDockSummary(tasks: readonly BackgroundTaskInfo[]): DockSummary | null {
  if (tasks.length === 0) return null;
  return {
    total: tasks.length,
    running: tasks.filter((task) => task.status === 'running').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
  };
}

/** 会话派过子代理就保留入口；全部结束后按钮仍在，只是运行数为 0 */
export function agentDockSummary(entries: readonly SubagentDirectoryEntry[]): DockSummary | null {
  if (entries.length === 0) return null;
  return {
    total: entries.length,
    running: entries.filter(isDockAgentRunning).length,
    failed: entries.filter((entry) => entry.status === 'failed').length,
  };
}

const applyFilter = <T>(
  items: T[],
  filter: DockFilter,
  running: (item: T) => boolean,
  done: (item: T) => boolean
): T[] =>
  filter === 'running'
    ? items.filter(running)
    : filter === 'done'
      ? items.filter(done)
      : filter === 'recent'
        ? items.slice(0, RECENT_LIMIT)
        : items;

export function filterDockTasks(
  tasks: readonly BackgroundTaskInfo[],
  filter: DockFilter
): BackgroundTaskInfo[] {
  return applyFilter(
    [...tasks].sort((a, b) => b.startedAt - a.startedAt),
    filter,
    (task) => task.status === 'running',
    (task) => task.status !== 'running'
  );
}

export function filterDockAgents(
  entries: readonly SubagentDirectoryEntry[],
  filter: DockFilter
): SubagentDirectoryEntry[] {
  return applyFilter(
    [...entries].sort((a, b) => b.createdAt - a.createdAt),
    filter,
    isDockAgentRunning,
    (entry) => entry.closed || entry.ended
  );
}

/** Main 生成的实例名是 `标题-<instanceId 前 8 位>`；卡片只显示标题 */
export function agentCardTitle(instanceName: string): string {
  return instanceName.replace(/-[0-9a-f]{8}$/i, '') || instanceName;
}

/**
 * 卡片耗时，全部用 Main 时钟：已结束 = Run 结束 − Run 开始；运行中优先 Main 推送的 elapsedMs，
 * 缺失时用本地创建时刻兜底。子会话 createdAt 是渲染层收到事件的时刻，不能和 Main 的结束时间相减。
 */
export function agentDurationMs(
  entry: {
    createdAt: number;
    startedAt?: number;
    finishedAt?: number;
    elapsedMs?: number;
    running?: boolean;
  },
  now: number
): number | undefined {
  if (entry.running) {
    if (entry.elapsedMs !== undefined) return entry.elapsedMs;
    return entry.createdAt && now >= entry.createdAt ? now - entry.createdAt : undefined;
  }
  const { startedAt, finishedAt } = entry;
  return startedAt !== undefined && finishedAt !== undefined && finishedAt >= startedAt
    ? finishedAt - startedAt
    : undefined;
}

/**
 * 父会话里 subagent spawn 调用的 prompt，按回执 agentId 索引，作为卡片的任务摘要。
 * 只认本会话真实发生且拿到回执的 spawn；正文被回收时返回空表，卡片不显示摘要。
 */
export function spawnBriefs(messages: readonly ProjectedMessage[]): Map<string, string> {
  const prompts = new Map<string, string>();
  const briefs = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const part of message.content) {
        if (part.type !== 'toolCall' || part.name !== 'subagent') continue;
        const args = part.arguments as Record<string, unknown> | undefined;
        if (args?.operation !== 'spawn' || typeof args.prompt !== 'string') continue;
        const prompt = args.prompt.replace(/\s+/g, ' ').trim();
        if (prompt) prompts.set(part.id, prompt);
      }
      continue;
    }
    if (message.role !== 'toolResult' || message.toolName !== 'subagent' || !message.toolCallId)
      continue;
    const prompt = prompts.get(message.toolCallId);
    if (!prompt) continue;
    const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
    const agentId = splitTrailingJson(text)?.value.agentId;
    if (typeof agentId === 'string' && agentId) briefs.set(agentId, prompt);
  }
  return briefs;
}
