import type { BackgroundTaskInfo } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import type { SubagentDirectoryEntry } from '@/lib/subagentTargets';
import {
  agentDockSummary,
  bashDockSummary,
  defaultDockFilter,
  filterDockAgents,
  filterDockTasks,
  todoDockSummary,
} from './taskDock';

const task = (
  taskId: string,
  status: BackgroundTaskInfo['status'],
  startedAt = 0
): BackgroundTaskInfo => ({ taskId, command: `cmd ${taskId}`, status, tail: '', startedAt });

const entry = (
  id: string,
  overrides: Partial<SubagentDirectoryEntry> = {}
): SubagentDirectoryEntry => ({
  childConversationId: id,
  agentId: `agent-${id}`,
  title: id,
  mode: 'task',
  origin: 'agent-tool',
  status: 'running',
  createdAt: 0,
  ended: false,
  closed: false,
  canOpenConversation: true,
  ...overrides,
});

describe('后台 Bash 按钮状态', () => {
  it('没有任务时不显示按钮', () => {
    expect(bashDockSummary([])).toBeNull();
  });

  it('按钮直接给出运行数，失败单独标出，不用点开才知道', () => {
    expect(
      bashDockSummary([task('a', 'running'), task('b', 'running'), task('c', 'failed')])
    ).toEqual({ total: 3, running: 2, failed: 1 });
  });

  it('全部结束后按钮仍保留（B 方案），运行数为 0', () => {
    expect(bashDockSummary([task('a', 'done')])).toEqual({ total: 1, running: 0, failed: 0 });
  });
});

describe('后台 Agent 按钮状态', () => {
  it('会话从未派过子代理时不显示按钮', () => {
    expect(agentDockSummary([])).toBeNull();
  });

  it('运行数只算活跃 Run；待命协作者和已结束的不算，但按钮仍在', () => {
    expect(
      agentDockSummary([
        entry('run'),
        entry('validating', { status: 'validating' }),
        entry('idle', { mode: 'coworker', status: 'waiting' }),
        entry('done', { status: 'succeeded', ended: true }),
        entry('late', { status: 'running', closed: true, ended: true }),
        entry('bad', { status: 'failed', ended: true }),
      ])
    ).toEqual({ total: 6, running: 2, failed: 1 });
  });
});

describe('筛选', () => {
  it('有运行中时默认打开「运行中」，否则「全部」', () => {
    expect(defaultDockFilter(1)).toBe('running');
    expect(defaultDockFilter(0)).toBe('all');
  });

  it('Bash：运行中只留 running；全部按开始时间倒序，最新在上', () => {
    const tasks = [task('old', 'done', 1), task('live', 'running', 2), task('new', 'failed', 3)];
    expect(filterDockTasks(tasks, 'running').map((t) => t.taskId)).toEqual(['live']);
    expect(filterDockTasks(tasks, 'all').map((t) => t.taskId)).toEqual(['new', 'live', 'old']);
  });

  it('Agent：运行中排除待命与已结束；全部按创建时间倒序', () => {
    const entries = [
      entry('a', { createdAt: 1, status: 'succeeded', ended: true }),
      entry('b', { createdAt: 2 }),
      entry('c', { createdAt: 3, mode: 'coworker', status: 'waiting' }),
    ];
    expect(filterDockAgents(entries, 'running').map((e) => e.title)).toEqual(['b']);
    expect(filterDockAgents(entries, 'all').map((e) => e.title)).toEqual(['c', 'b', 'a']);
  });
});

describe('当前进度按钮', () => {
  it('没有未完成清单时不显示', () => {
    expect(todoDockSummary(null)).toBeNull();
    expect(todoDockSummary({ id: 't', todos: [] })).toBeNull();
  });

  it('按钮给出 已完成/总数，并标出是否有进行中的项', () => {
    expect(
      todoDockSummary({
        id: 't',
        todos: [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'in_progress' },
          { content: 'c', status: 'pending' },
        ],
      })
    ).toEqual({ done: 1, total: 3, active: true });
    expect(todoDockSummary({ id: 't', todos: [{ content: 'a', status: 'pending' }] })).toEqual({
      done: 0,
      total: 1,
      active: false,
    });
  });
});
