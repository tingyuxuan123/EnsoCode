import type { BackgroundTaskInfo, TodoItem } from '@shared/types/agent';
import type { SubagentDirectoryEntry } from '@/lib/subagentTargets';

/** 输入框上方按钮条的筛选：有运行中默认「运行中」，否则「全部」 */
export type DockFilter = 'running' | 'all';

export interface DockSummary {
  total: number;
  running: number;
  failed: number;
}

export const defaultDockFilter = (running: number): DockFilter => (running > 0 ? 'running' : 'all');

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

export function filterDockTasks(
  tasks: readonly BackgroundTaskInfo[],
  filter: DockFilter
): BackgroundTaskInfo[] {
  return tasks
    .filter((task) => filter === 'all' || task.status === 'running')
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function filterDockAgents(
  entries: readonly SubagentDirectoryEntry[],
  filter: DockFilter
): SubagentDirectoryEntry[] {
  return entries
    .filter((entry) => filter === 'all' || isDockAgentRunning(entry))
    .sort((a, b) => b.createdAt - a.createdAt);
}
