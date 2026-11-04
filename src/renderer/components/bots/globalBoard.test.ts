import type { BotChat, GroupTask } from '@shared/types/bot';
import { describe, expect, it } from 'vitest';
import { globalBoard, rootBoardGroups } from './globalBoard';

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
  updatedAt: seq,
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
      []
    );
    expect(columns.todo.map(({ task }) => task.id)).toEqual(['todo-first', 'todo-later']);
    expect(columns.doing).toEqual([]);
    expect(columns.blocked[0]).toMatchObject({ task: failed, needsAttention: true });
    expect(columns.review[0]?.needsAttention).toBe(true);
    expect(columns.done.map(({ task }) => task.id)).toEqual(['done-later', 'done-earlier']);
    expect([total, attention]).toEqual([6, 2]);
  });
});
