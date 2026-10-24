import type { BackgroundTaskInfo, ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import type { SubagentDirectoryEntry } from '@/lib/subagentTargets';
import {
  agentCardTitle,
  agentDockSummary,
  agentDurationMs,
  bashDockSummary,
  defaultDockFilter,
  filterDockAgents,
  filterDockTasks,
  spawnBriefs,
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
  it('有运行中时默认打开「进行中」，否则「最近」', () => {
    expect(defaultDockFilter(1)).toBe('running');
    expect(defaultDockFilter(0)).toBe('recent');
  });

  it('Bash：进行中 / 已完成 / 全部按开始时间倒序；最近只取前 6 条', () => {
    const tasks = [task('old', 'done', 1), task('live', 'running', 2), task('new', 'failed', 3)];
    expect(filterDockTasks(tasks, 'running').map((t) => t.taskId)).toEqual(['live']);
    expect(filterDockTasks(tasks, 'done').map((t) => t.taskId)).toEqual(['new', 'old']);
    expect(filterDockTasks(tasks, 'all').map((t) => t.taskId)).toEqual(['new', 'live', 'old']);
    const many = Array.from({ length: 8 }, (_, i) => task(`t${i}`, 'done', i));
    expect(filterDockTasks(many, 'recent').map((t) => t.taskId)).toEqual([
      't7',
      't6',
      't5',
      't4',
      't3',
      't2',
    ]);
  });

  it('Agent：进行中排除待命与已结束；已完成只含已结束；全部按创建时间倒序', () => {
    const entries = [
      entry('a', { createdAt: 1, status: 'succeeded', ended: true }),
      entry('b', { createdAt: 2 }),
      entry('c', { createdAt: 3, mode: 'coworker', status: 'waiting' }),
    ];
    expect(filterDockAgents(entries, 'running').map((e) => e.title)).toEqual(['b']);
    expect(filterDockAgents(entries, 'done').map((e) => e.title)).toEqual(['a']);
    expect(filterDockAgents(entries, 'all').map((e) => e.title)).toEqual(['c', 'b', 'a']);
    expect(filterDockAgents(entries, 'recent').map((e) => e.title)).toEqual(['c', 'b', 'a']);
  });
});

describe('子代理卡片', () => {
  it('标题去掉 Main 生成的 -<8 位 id> 后缀，其它连字符保留', () => {
    expect(agentCardTitle('核对浏览器标签路由-4afa7410')).toBe('核对浏览器标签路由');
    expect(agentCardTitle('fix-worker-capability-9cf78500')).toBe('fix-worker-capability');
    expect(agentCardTitle('run-e2e')).toBe('run-e2e');
  });

  it('已结束：用 Main 结算的 Run 起止时间，不用渲染层收到事件的时刻', () => {
    expect(
      agentDurationMs({ createdAt: 1_000_500, startedAt: 1_000, finishedAt: 319_000 }, 999_999)
    ).toBe(318_000);
    // 没有 Run 起点（旧数据）时不猜
    expect(agentDurationMs({ createdAt: 1_000, finishedAt: 319_000 }, 999_999)).toBeUndefined();
  });

  it('运行中：用 Main 推送的 elapsedMs；缺失时用创建时刻兜底', () => {
    expect(agentDurationMs({ createdAt: 1_000, running: true, elapsedMs: 4_200 }, 12_000)).toBe(
      4_200
    );
    expect(agentDurationMs({ createdAt: 1_000, running: true }, 12_000)).toBe(11_000);
    expect(agentDurationMs({ createdAt: 0, running: true }, 12_000)).toBeUndefined();
  });

  it('从父会话 spawn 调用取 prompt 作摘要，按回执 agentId 索引；非 spawn / 无回执忽略', () => {
    const messages: ProjectedMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'c1',
            name: 'subagent',
            arguments: { operation: 'spawn', description: 'x', prompt: '只读排查最新截图\n第二行' },
          },
          {
            type: 'toolCall',
            id: 'c2',
            name: 'subagent',
            arguments: { operation: 'send', agentId: 'a1', message: 'steer' },
          },
          {
            type: 'toolCall',
            id: 'c3',
            name: 'subagent',
            arguments: { operation: 'spawn', prompt: 'no receipt' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'c1',
        content: [{ type: 'text', text: 'note\n{"agentId":"a1","runId":"r1"}' }],
      },
      {
        role: 'toolResult',
        toolName: 'subagent',
        toolCallId: 'c2',
        content: [{ type: 'text', text: '{"agentId":"a1","runId":"r2"}' }],
      },
    ];
    expect(spawnBriefs(messages)).toEqual(new Map([['a1', '只读排查最新截图 第二行']]));
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
