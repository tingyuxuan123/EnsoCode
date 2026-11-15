import type { CatalogEntry } from '@enso/pair';
import { rowTone } from './StatusGlyph';

/** 会话列表右上角的筛选档位：点一下换一档，循环回「全部」 */
export type SessionStatusFilter = 'all' | 'waiting' | 'running' | 'error';

const CYCLE: Record<SessionStatusFilter, SessionStatusFilter> = {
  all: 'waiting',
  waiting: 'running',
  running: 'error',
  error: 'all',
};

export const STATUS_FILTER_LABEL: Record<SessionStatusFilter, string> = {
  all: '全部会话',
  waiting: '只看等你处理',
  running: '只看运行中',
  error: '只看出错',
};

export function cycleStatusFilter(current: SessionStatusFilter): SessionStatusFilter {
  return CYCLE[current];
}

/** 设计稿 sessions.tsx 的「N 个等你」：归档不参与首屏提示 */
export function countWaiting(catalog: readonly CatalogEntry[]): number {
  return catalog.filter((session) => !session.archived && rowTone(session) === 'waiting').length;
}

export function filterSessionsByStatus(
  sessions: readonly CatalogEntry[],
  filter: SessionStatusFilter
): CatalogEntry[] {
  if (filter === 'all') return [...sessions];
  return sessions.filter((session) => rowTone(session) === filter);
}
