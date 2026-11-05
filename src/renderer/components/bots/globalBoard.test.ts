import type { BotChat, GroupTask } from '@shared/types/bot';
import { describe, expect, it } from 'vitest';
import { filterBoard, globalBoard, rootBoardGroups } from './globalBoard';

const NOW = Date.UTC(2026, 10, 5, 12);
const WEEK = 7 * 24 * 60 * 60 * 1000;

const chat = (id: string, extra?: Partial<BotChat>): BotChat => ({
  id,
  title: id,
  kind: 'group',
  members: [],
  bossBotId: null,
  workspace: { kind: 'member-home' },
  routing: { mode: 'boss', maxHops: 1, maxTurnsPerBot: 1 },
  pinned: false,
  sessions: {},
  createdAt: 1,
  updatedAt: 1,
  version: 1,
  ...extra,
});
const task = (id: string, seq: number, status: GroupTask['status'] = 'todo'): GroupTask => ({
  id,
  seq,
  title: 'Same title',
  status,
  createdBy: 'human',
  createdAt: 1,
  updatedAt: NOW + seq,
});

describe('全局协作看板投影', () => {
  it('只读未归档根群，按群和任务 ID 去重，不按群内编号或标题去重', () => {
    const chats = [
      chat('a'),
      chat('b'),
      chat('thread', { parentId: 'a' }),
      chat('direct', { kind: 'direct' }),
      chat('archived', { archivedAt: 0 }),
    ];
    const shared = task('shared-id', 1);
    const { columns, total } = globalBoard(
      chats,
      {
        a: [shared, { ...shared }, task('same-seq', 1)],
        b: [shared],
        thread: [task('thread-copy', 1)],
        direct: [task('direct-task', 1)],
        archived: [task('archived-task', 1)],
      },
      []
    );
    expect(rootBoardGroups(chats).map((group) => group.id)).toEqual(['a', 'b']);
    expect(columns.todo.map(({ group, task }) => [group.id, task.id])).toEqual([
      ['a', 'shared-id'],
      ['a', 'same-seq'],
      ['b', 'shared-id'],
    ]);
    expect(total).toBe(3);
  });

  it('继承看板排序和待处理语义，旧失败任务归为卡住，不把取消任务计入列', () => {
    const failed: GroupTask = {
      ...task('failed', 2, 'doing'),
      delegationId: 'd',
      runs: [{ id: 'd', botId: 'b', trigger: 'delegate', state: 'failed', createdAt: 1 }],
    };
    const { columns, total, attention } = globalBoard(
      [chat('a'), chat('b')],
      {
        a: [task('todo-later', 4), failed, task('done-earlier', 1, 'done')],
        b: [
          task('todo-first', 1),
          task('review', 3, 'review'),
          task('done-later', 4, 'done'),
          task('canceled', 5, 'canceled'),
        ],
      },
      [],
      NOW
    );
    expect(columns.todo.map(({ task }) => task.id)).toEqual(['todo-first', 'todo-later']);
    expect(columns.doing).toEqual([]);
    expect(columns.blocked[0]).toMatchObject({ task: failed, needsAttention: true });
    expect(columns.review[0]?.needsAttention).toBe(true);
    expect(columns.done.map(({ task }) => task.id)).toEqual(['done-later', 'done-earlier']);
    expect([total, attention]).toEqual([6, 2]);
  });

  it('搜索与群、执行人、待处理条件取交集，计数只反映可见任务', () => {
    const board = globalBoard(
      [chat('a'), chat('b')],
      {
        a: [
          { ...task('t1', 1), detail: 'Run SMOKE tests', assigneeBotId: 'bot' },
          task('t2', 2, 'review'),
        ],
        b: [{ ...task('t3', 1, 'review'), result: 'smoke passed', assigneeBotId: 'bot' }],
      },
      []
    );
    const scoped = filterBoard(board, { query: ' smoke ', assignee: 'bot', attentionOnly: true });
    expect(scoped.columns.review.map(({ task }) => task.id)).toEqual(['t3']);
    expect(scoped.total).toBe(1);
    expect(scoped.attention).toBe(1);
    expect(filterBoard(board, { query: '#2' }).columns.review[0]?.task.id).toBe('t2');
    expect(filterBoard(board, { assignee: null }).total).toBe(1);
    expect(filterBoard(board, { groupId: 'a', query: 'passed' }).total).toBe(0);
    expect(board.total).toBe(3);
  });

  it('仅隐藏完成超过七天的任务，恰好七天仍展示，不删除缓存或影响未完成任务', () => {
    const cutoff = NOW - WEEK;
    const recent = { ...task('recent', 1, 'done'), updatedAt: NOW - 1 };
    const boundary = { ...task('boundary', 2, 'done'), updatedAt: cutoff };
    const expired = { ...task('expired', 3, 'done'), title: 'expired', updatedAt: cutoff - 1 };
    const oldTodo = { ...task('old-todo', 4), updatedAt: cutoff - 1 };
    const oldDoing = { ...task('old-doing', 5, 'doing'), updatedAt: cutoff - 1 };
    const oldReview = { ...task('old-review', 6, 'review'), updatedAt: cutoff - 1 };
    const oldBlocked = {
      ...task('old-blocked', 7, 'blocked'),
      blockedReason: 'need' as const,
      blockedNeed: 'Waiting for your reply',
      updatedAt: cutoff - 1,
    };
    const cache = { a: [recent, boundary, expired, oldTodo, oldDoing, oldReview, oldBlocked] };
    const board = globalBoard([chat('a')], cache, [], NOW);
    expect(board.columns.done.map(({ task }) => task.id)).toEqual(['recent', 'boundary']);
    expect(board.total).toBe(6);
    expect(board.attention).toBe(2);
    expect(board.columns.todo[0]?.task.id).toBe('old-todo');
    expect(board.columns.doing[0]?.task.id).toBe('old-doing');
    expect(board.columns.review[0]?.task.id).toBe('old-review');
    expect(board.columns.blocked[0]?.task.id).toBe('old-blocked');
    expect(filterBoard(board, { query: 'expired' }).total).toBe(0);
    expect(cache.a).toEqual([recent, boundary, expired, oldTodo, oldDoing, oldReview, oldBlocked]);
    expect(
      globalBoard([chat('a')], cache, [], NOW + 1).columns.done.map(({ task }) => task.id)
    ).toEqual(['recent']);
  });
});
