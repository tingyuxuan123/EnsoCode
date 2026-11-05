// @vitest-environment happy-dom
import type { BotChat, BotProfile, GroupTask } from '@shared/types/bot';
import type { BotChatsListResult, BotTasksResult } from '@shared/types/botIpc';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBotsStore } from '@/stores/bots';
import { GlobalTaskBoard } from './GlobalTaskBoard';

vi.mock('@/stores/bots', async () => ({
  useBotsStore: (await import('zustand')).create(() => ({})),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, string>) =>
      key.replace(/{{(\w+)}}/g, (_, name) => values?.[name] ?? ''),
  }),
}));
vi.mock('./BotFields', () => ({ FieldLabel: () => null }));
vi.mock('./BotAvatar', () => ({ BotAvatar: () => null }));
vi.mock('./DelegationCard', () => ({ useNow: () => 100, CheckBadge: () => null }));
vi.mock('@/stores/settings', async () => ({
  useSettingsStore: (await import('zustand')).create(() => ({ keybindings: {} })),
}));

const alpha = { id: 'a', kind: 'group', title: 'Alpha' } as BotChat;
const beta = { ...alpha, id: 'b', title: 'Beta' };
const thread = { ...alpha, id: 'thread', parentId: 'a', title: 'Alpha topic' };
const task: GroupTask = {
  id: 'shared-task',
  seq: 1,
  title: 'Release checklist',
  detail: 'Run the desktop smoke tests.',
  status: 'todo',
  assigneeBotId: 'bot',
  createdBy: 'human',
  createdAt: 1,
  updatedAt: 1,
};
const onOpenTask = vi.fn();
const onOpenGroup = vi.fn();
const openSettings = vi.fn();
const refreshChats = vi.fn(async () => {});
const chats = vi.fn<() => Promise<BotChatsListResult>>();
const list = vi.fn<(id: string) => Promise<BotTasksResult>>();
const save = vi.fn(async () => ({ ok: true, task }));
const review = vi.fn(async () => ({ ok: true, task }));
const assign = vi.fn(async () => ({ ok: true, task }));
let host: HTMLDivElement;
let root: Root;

const render = (enabled = true) =>
  act(async () =>
    root.render(
      <GlobalTaskBoard
        enabled={enabled}
        onBack={vi.fn()}
        onOpenTask={onOpenTask}
        onOpenGroup={onOpenGroup}
      />
    )
  );
const cards = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-task-id]'));
const click = async (label: string) => {
  const button = Array.from(document.querySelectorAll('button')).find(
    (item) => item.textContent?.includes(label) || item.getAttribute('aria-label') === label
  );
  expect(button, label).toBeTruthy();
  await act(async () => button?.click());
};
const fill = async (label: string, value: string) => {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(input, label).toBeTruthy();
  if (!input) return;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('全局协作看板', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    list.mockImplementation(async (id) => ({
      ok: true,
      enabled: true,
      tasks: [id === 'b' ? { ...task, status: 'review' } : task],
    }));
    chats.mockResolvedValue({ ok: true, enabled: true, chats: [alpha, beta, thread], queue: [] });
    vi.stubGlobal('electronAPI', {
      bots: { chats, tasks: { list, save, review, assign } },
      window: { openSettings, setTrafficLightsVisible: vi.fn(async () => {}) },
      env: { platform: 'linux' },
    });
    useBotsStore.setState({
      chats: [alpha, beta, thread],
      bots: [{ id: 'bot', name: 'Scout' } as BotProfile],
      delegations: [],
      tasks: { thread: [task] },
      refreshCatalog: vi.fn(async () => {}),
      refreshChats,
      refreshDelegations: vi.fn(async () => {}),
      refreshTasks: vi.fn(async () => {}),
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('按状态展示来自不同根群的任务，保留来源和执行人，不重复显示话题', async () => {
    await render();
    expect(list.mock.calls).toEqual([['a'], ['b']]);
    expect(
      host.querySelector('[data-slot="global-collaboration-board-columns"]')?.children
    ).toHaveLength(5);
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['a', 'b']);
    expect(cards()[0]?.textContent).toContain('Alpha');
    expect(cards()[0]?.textContent).toContain('Scout');
    expect(cards()[1]?.closest('section')?.textContent).toContain('Awaiting review');
    await click('Needs your attention');
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['b']);
    await click('Release checklist');
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(host.querySelector('aside')?.textContent).toContain('Run the desktop smoke tests.');
    await click('Accept result');
    expect(review).toHaveBeenCalledWith({ chatId: 'b', id: 'shared-task', accept: true });
    await click('Open in group');
    expect(onOpenTask).toHaveBeenCalledWith('b', 'shared-task');
    expect(useBotsStore.getState().tasks.b[0].status).toBe('review');
  });

  it('搜索会匹配任务说明和编号，且可以清除筛选', async () => {
    await render();
    await fill('Search tasks', ' SMOKE tests ');
    expect(cards()).toHaveLength(2);
    await fill('Search tasks', '#1');
    expect(cards()).toHaveLength(2);
    await fill('Search tasks', 'different content');
    expect(cards()).toHaveLength(0);
    expect(host.textContent).toContain('No tasks match these filters.');
    await click('Clear filters');
    expect(cards()).toHaveLength(2);
  });

  it('从全局看板创建任务时选择所属群，并回到该群的全部任务', async () => {
    await render();
    await click('Needs your attention');
    await click('New task');
    await fill('Task title', 'Verify release artifacts');
    await click('Task group');
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes('Alpha')
    );
    expect(option).toBeTruthy();
    await act(async () => option?.click());
    await click('Save');
    expect(save).toHaveBeenCalledWith({
      chatId: 'a',
      title: 'Verify release artifacts',
      detail: '',
      check: '',
    });
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['a']);
  });

  it('同 ID 的跨群任务详情保持独立，接收权威更新，删除后关闭详情', async () => {
    await render();
    await act(async () => cards()[1]?.click());
    expect(host.querySelector('aside')?.textContent).toContain('Beta');
    await act(async () =>
      useBotsStore.setState((state) => ({
        tasks: {
          ...state.tasks,
          b: [{ ...task, status: 'done', result: 'Authoritative result' }],
        },
      }))
    );
    expect(host.querySelector('aside')?.textContent).toContain('Authoritative result');
    expect(host.querySelector('aside')?.textContent).toContain('Completed');
    await act(async () => useBotsStore.setState((state) => ({ tasks: { ...state.tasks, b: [] } })));
    expect(host.querySelector('aside')).toBeNull();
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['a']);
  });

  it('按未指派筛选后，从详情直接指派给所属群成员', async () => {
    useBotsStore.setState({ chats: [{ ...alpha, members: ['bot'] }, beta] });
    list.mockImplementation(async (id) => ({
      ok: true,
      enabled: true,
      tasks: [id === 'a' ? { ...task, assigneeBotId: undefined } : { ...task, status: 'review' }],
    }));
    await render();
    await click('Filter by assignee');
    const unassigned = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent === 'Unassigned'
    );
    expect(unassigned).toBeTruthy();
    await act(async () => unassigned?.click());
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['a']);
    await click('Release checklist');
    await click('Assign to');
    const member = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent?.includes('Scout')
    );
    expect(member).toBeTruthy();
    await act(async () => member?.click());
    expect(assign).toHaveBeenCalledWith({ chatId: 'a', id: task.id, botId: 'bot' });
  });

  it('没有群聊时给出引导且不可新建任务', async () => {
    useBotsStore.setState({ chats: [], tasks: {} });
    await render();
    expect(host.textContent).toContain(
      'Create a group chat in the workspace to start collaborating.'
    );
    const create = Array.from(host.querySelectorAll('button')).find((item) =>
      item.textContent?.includes('New task')
    );
    expect(create?.disabled).toBe(true);
    expect(list).not.toHaveBeenCalled();
  });

  it('异常的历史更新时间不会让其他任务卡片消失', async () => {
    list.mockResolvedValueOnce({
      ok: true,
      enabled: true,
      tasks: [{ ...task, updatedAt: Number.MAX_VALUE }],
    });
    await render();
    expect(cards()).toHaveLength(2);
    expect(cards()[0]?.querySelector('time')).toBeNull();
  });

  it('新建时必须选择群，保存失败保留输入并允许重试', async () => {
    await render();
    await click('New task');
    await fill('Task title', 'Keep this draft');
    await click('Save');
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Choose a group for this task.');
    await click('Task group');
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes('Alpha')
    );
    await act(async () => option?.click());
    save.mockRejectedValueOnce(new Error('connection lost'));
    await click('Save');
    expect(document.body.textContent).toContain('Task not updated');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Task title"]')?.value).toBe(
      'Keep this draft'
    );
    await click('Save');
    expect(save).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('单群失败时保留成功卡片并提供重试', async () => {
    list.mockImplementationOnce(async () => ({ ok: false, error: 'unavailable' }));
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Alpha');
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['b']);
    expect(host.querySelector('[role="status"]')).toBeNull();
    await click('Retry');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['a', 'b']);
  });

  it('群目录更新时补载新根群，任务缓存更新不会触发请求循环', async () => {
    await render();
    list.mockClear();
    await act(async () =>
      useBotsStore.setState({ chats: [alpha, beta, { ...alpha, id: 'c', title: 'Gamma' }] })
    );
    expect(list).toHaveBeenCalledWith('c');
    expect(cards().map((card) => card.dataset.groupId)).toContain('c');
    list.mockClear();
    await act(async () => useBotsStore.setState((state) => ({ tasks: { ...state.tasks, c: [] } })));
    expect(list).not.toHaveBeenCalled();
    expect(cards().map((card) => card.dataset.groupId)).not.toContain('c');
  });

  it('目录读取失败也结束加载并可重试，不把旧缓存冒充完整目录', async () => {
    chats.mockResolvedValueOnce({ ok: false, error: 'unavailable' });
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not refresh collaboration board data.'
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Showing available tasks.');
    expect(host.querySelector('[role="status"]')).toBeNull();
    await click('Retry');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(cards()).toHaveLength(2);
  });

  it('筛选单个群后可以打开原群看板，也能回到全部群聊', async () => {
    await render();
    await click('Filter by group');
    const alphaOption = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes('Alpha')
    );
    expect(alphaOption).toBeTruthy();
    await act(async () => alphaOption?.click());
    expect(cards().map((card) => card.dataset.groupId)).toEqual(['a']);
    await click('Open group board');
    expect(onOpenGroup).toHaveBeenCalledWith('a');
    await click('Filter by group');
    const all = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((item) =>
      item.textContent?.includes('All group chats')
    );
    await act(async () => all?.click());
    expect(cards()).toHaveLength(2);
  });

  it('功能关闭时不加载或展示缓存，只引导打开设置', async () => {
    await render();
    expect(cards()).toHaveLength(2);
    list.mockClear();
    refreshChats.mockClear();
    await render(false);
    expect(cards()).toHaveLength(0);
    expect(list).not.toHaveBeenCalled();
    expect(refreshChats).not.toHaveBeenCalled();
    await click('Open settings');
    expect(openSettings).toHaveBeenCalledOnce();
  });
});
