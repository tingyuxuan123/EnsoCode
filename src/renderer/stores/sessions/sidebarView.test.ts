import { describe, expect, it } from 'vitest';
import { sessionSwitchSlotIds } from './sessionSwitchSlots';
import { newSidebarConversationProjectId, sidebarViewOrder } from './sidebarDirectory';

const projects = [
  { id: 'project', kind: 'local' },
  { id: 'remote', kind: 'ssh' },
  { id: 'scratch', kind: 'scratch' },
];
const conversation = (projectId: string, pinned = false) => ({
  projectId,
  pinned,
  createdAt: 1,
  messages: [],
});
const conversations = {
  task: conversation('project'),
  temporary: conversation('scratch'),
  pinnedTemporary: conversation('scratch', true),
  remoteTask: conversation('remote'),
  pinnedTask: conversation('project', true),
  archivedTemporary: { ...conversation('scratch'), archived: true },
};
const order = ['task', 'temporary', 'pinnedTemporary', 'remoteTask', 'pinnedTask'];

describe('项目 / 临时对话侧栏目录', () => {
  it('新建操作跟随当前页，避免从项目页创建临时会话或从对话页创建项目任务', () => {
    expect(newSidebarConversationProjectId(projects, 'scratch', 'projects')).toBe('project');
    expect(newSidebarConversationProjectId(projects, 'remote', 'projects')).toBe('remote');
    expect(newSidebarConversationProjectId(projects, 'project', 'conversations')).toBe('scratch');
    expect(newSidebarConversationProjectId([], undefined, 'projects')).toBeUndefined();
    expect(newSidebarConversationProjectId([], undefined, 'conversations')).toBeUndefined();
    expect(
      newSidebarConversationProjectId([{ id: 'scratch', kind: 'scratch' }], 'scratch', 'projects')
    ).toBeUndefined();
  });

  it('项目页仅保留普通与 SSH 项目的会话，并保持目录顺序', () => {
    expect(sidebarViewOrder(order, conversations, projects, 'projects')).toEqual([
      'task',
      'remoteTask',
      'pinnedTask',
    ]);
  });

  it('对话页只保留临时会话，归档状态留给既有分组规则处理', () => {
    expect(
      sidebarViewOrder([...order, 'archivedTemporary'], conversations, projects, 'conversations')
    ).toEqual(['temporary', 'pinnedTemporary', 'archivedTemporary']);
  });

  it('缺少临时项目时对话页为空，忽略失效目录项', () => {
    expect(sidebarViewOrder(order, conversations, [], 'conversations')).toEqual([]);
    expect(sidebarViewOrder(['missing'], conversations, projects, 'projects')).toEqual([]);
  });

  it('数字快捷键只分配当前页的会话，包括当前页的置顶项', () => {
    for (const [view, projectIds, expected] of [
      ['projects', ['project', 'remote'], ['pinnedTask', 'task', 'remoteTask']],
      ['conversations', ['scratch'], ['pinnedTemporary', 'temporary']],
    ] as const) {
      expect(
        sessionSwitchSlotIds({
          order: sidebarViewOrder(order, conversations, projects, view),
          conversations,
          projectIds,
        })
      ).toEqual(expected);
    }
  });
});
