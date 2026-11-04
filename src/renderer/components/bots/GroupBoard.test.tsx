// @vitest-environment happy-dom
import type { BotChat, GroupTask } from '@shared/types/bot';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBotsStore } from '@/stores/bots';
import { TaskBoard } from './GroupBoard';

vi.mock('@/stores/bots', async () => ({
  useBotsStore: (await import('zustand')).create(() => ({})),
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/chat/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('./BotFields', () => ({ FieldLabel: () => null }));
vi.mock('./TaskReply', () => ({ TaskReply: () => null }));
vi.mock('./TaskRuns', () => ({ TaskRuns: () => null }));
vi.mock('./DelegationCard', () => ({
  useNow: () => 100,
  CheckBadge: () => null,
  failureText: () => 'failed',
}));

const chat = { id: 'root-group', members: [], kind: 'group' } as unknown as BotChat;
const task = (seq: number, status: GroupTask['status']): GroupTask => ({
  id: `task-${seq}`,
  seq,
  title: `Work ${seq}`,
  detail: 'First line\nSecond line\nThird line\nFull task detail',
  status,
  createdBy: 'human',
  createdAt: seq,
  updatedAt: seq,
});

let root: Root;
let host: HTMLDivElement;
let review: ReturnType<typeof vi.fn>;
const scroll = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
const props = {
  chat,
  attentionIds: new Set(['task-3']),
  onOpenConversation: vi.fn(),
};
const render = async () => {
  await act(async () => root.render(createElement(TaskBoard, props)));
};
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent?.includes(label) || item.getAttribute('aria-label') === label
  );
  expect(button, label).toBeTruthy();
  await act(async () => button?.click());
};
const ids = () =>
  Array.from(host.querySelectorAll('[data-task-id]'), (item) => item.getAttribute('data-task-id'));

describe('协作看板', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    review = vi.fn(async () => ({ ok: true }));
    Object.assign(window, { electronAPI: { bots: { tasks: { review } } } });
    scroll.mockClear();
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scroll);
    useBotsStore.setState({
      bots: [],
      delegations: [],
      tasks: { [chat.id]: [task(1, 'todo'), task(2, 'doing'), task(3, 'review')] },
      taskFocus: null,
      refreshTasks: vi.fn(async () => {}),
      clearTaskFocus: (nonce) => {
        if (useBotsStore.getState().taskFocus?.nonce === nonce)
          useBotsStore.setState({ taskFocus: null });
      },
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('筛选需要处理的任务、展开完整详情，并沿现有 API 验收', async () => {
    await render();
    await click('Needs your attention');
    expect(ids()).toEqual(['task-3']);
    await click('Work 3');
    expect(
      host.querySelector('[data-task-id="task-3"] button[aria-expanded="true"]')
    ).not.toBeNull();
    expect(host.querySelector('[data-task-id="task-3"] .line-clamp-3')).toBeNull();
    await click('Accept result');
    expect(review).toHaveBeenCalledWith({ chatId: chat.id, id: 'task-3', accept: true });
    await click('All tasks');
    expect(ids()).toEqual(['task-1', 'task-2', 'task-3']);
  });

  it('群任务的待处理筛选也展示旧数据中标作进行中的失败任务', async () => {
    const failed: GroupTask = {
      ...task(3, 'doing'),
      delegationId: 'd',
      runs: [{ id: 'd', botId: 'b', trigger: 'delegate', state: 'failed', createdAt: 1 }],
    };
    useBotsStore.setState({ tasks: { [chat.id]: [task(1, 'todo'), failed] } });
    await render();
    await click('Needs your attention');
    expect(ids()).toEqual(['task-3']);
    expect(
      host.querySelector('[data-task-id="task-3"]')?.closest('section')?.textContent
    ).toContain('Stuck tasks');
  });

  it('任务深链解除筛选，也能定位默认折叠的旧完成卡片，不丢卡片', async () => {
    await render();
    await click('Needs your attention');
    await act(async () => {
      useBotsStore.setState({
        tasks: { [chat.id]: Array.from({ length: 8 }, (_, n) => task(n + 1, 'done')) },
        taskFocus: { chatId: chat.id, taskId: 'task-1', nonce: 1 },
      });
    });
    expect(ids()).toContain('task-1');
    expect(host.querySelector('[data-task-id="task-1"]')?.className).toContain('ring-2');
    expect(scroll).toHaveBeenCalled();
    expect(useBotsStore.getState().taskFocus).toBeNull();
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toContain('All tasks');
  });
});
