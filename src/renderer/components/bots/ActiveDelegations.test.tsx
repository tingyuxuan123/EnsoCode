// @vitest-environment happy-dom
import { translate } from '@shared/i18n';
import type { BotProfile, Delegation } from '@shared/types/bot';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ActiveDelegations } from './ActiveDelegations';

const h = vi.hoisted(() => ({
  cancel: vi.fn().mockResolvedValue({ ok: true }),
  refresh: vi.fn(),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => translate('zh', key, params),
  }),
}));
vi.mock('@/components/chat/MessageTimeline', () => ({ CHAT_COL: '' }));
vi.mock('@/stores/bots', () => ({
  useBotsStore: Object.assign(
    (select: (state: unknown) => unknown) =>
      select({ delegations: [], sessions: {}, queue: [], silences: [] }),
    { getState: () => ({ refreshDelegations: h.refresh }) }
  ),
}));

const bots = new Map([
  ['boss', { id: 'boss', name: '林经理', avatar: { color: '#888' } } as BotProfile],
  ['worker', { id: 'worker', name: '阿全', avatar: { color: '#888' } } as BotProfile],
]);
const record: Delegation = {
  id: 'd1',
  parentConversationId: 'parent',
  parentBotId: 'boss',
  targetBotId: 'worker',
  chatId: 'direct',
  task: '验证安卓面板滚动，不要修改实现',
  context: '',
  childConversationId: 'child',
  state: 'running',
  depth: 1,
  createdAt: Date.now() - 60_000,
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const open = vi.fn();
const render = (items = [record]) =>
  act(async () =>
    root.render(createElement(ActiveDelegations, { items, bots, onOpenConversation: open }))
  );
const click = (button: HTMLButtonElement | null | undefined) => act(async () => button?.click());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { bots: { cancelDelegation: h.cancel } });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('侧栏中显示当前委派数量与目标成员，可独立滚动', async () => {
  await render([record, { ...record, id: 'd2', childConversationId: 'child2', state: 'queued' }]);
  expect(container.textContent).toContain('进行中的委派 · 2');
  expect(container.textContent).toContain('阿全');
  expect(
    container.querySelectorAll('[data-slot="active-delegations"] [data-slot="bot-card"]')
  ).toHaveLength(2);
});

it('保留任务、状态与耗时，查看过程仍打开正确子会话', async () => {
  await render();
  expect(container.textContent).toContain(record.task);
  expect(container.textContent).toContain('1m');
  expect(container.textContent).toContain('思考');
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')];
  await click(buttons.find((button) => button.textContent === '查看过程'));
  expect(open).toHaveBeenCalledWith('child', '林经理 → 阿全 · 委派');
  expect(h.cancel).not.toHaveBeenCalled();
});

it('取消只操作对应委派，随后刷新状态', async () => {
  await render();
  await click(
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '取消'
    )
  );
  expect(h.cancel).toHaveBeenCalledExactlyOnceWith('d1');
  expect(h.refresh).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
});

it('没有活动委派时展示明确空态；成员已删除也能查看和取消', async () => {
  await render([]);
  expect(container.textContent).toContain('暂无进行中的委派');
  expect(container.querySelectorAll('[data-slot="bot-card"]')).toHaveLength(0);
  await render([{ ...record, targetBotId: 'deleted' }]);
  expect(container.textContent).toContain('已删除成员');
  await click(
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '查看过程'
    )
  );
  expect(open).toHaveBeenCalledWith('child', '林经理 → 已删除成员 · 委派');
});
