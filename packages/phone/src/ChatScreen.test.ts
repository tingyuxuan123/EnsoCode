import { emptyGuestView } from '@shared/pair/guestProjection';
import type { TodoItem } from '@shared/types/agent';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { ChatScreen } from './ChatScreen';

const prefs = vi.hoisted(() => ({ pinUnfinishedTodos: true }));
vi.mock('@/stores/sessions', () => import('./stubs/sessions-store'));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: { pinUnfinishedTodos: boolean }) => unknown) => select(prefs),
}));
vi.mock('./chatHost', () => ({ phoneChatHost: () => ({}) }));
vi.mock('@/components/chat/Composer', () => ({
  Composer: ({ focusKey }: { focusKey: string }) =>
    createElement('div', { 'data-draft-key': focusKey }),
}));
vi.mock('@/components/chat/MessageTimeline', () => ({
  MessageTimeline: ({ busy }: { busy?: boolean }) =>
    createElement('div', { 'data-timeline': '', 'data-busy': String(Boolean(busy)) }),
  CHAT_COL: '',
}));
vi.mock('@/components/chat/ApprovalBar', () => ({ ApprovalBar: () => null }));
vi.mock('@/components/chat/AskBar', () => ({ AskBar: () => null }));
vi.mock('@/components/chat/GoalBar', () => ({ GoalBar: () => null }));
vi.mock('@/components/chat/TaskBar', () => ({
  TaskBar: ({ todos }: { todos?: { todos: TodoItem[] } | null }) =>
    todos
      ? createElement(
          'button',
          { type: 'button', 'data-task-dock-button': 'todo' },
          `Current progress ${todos.todos.filter((item) => item.status === 'completed').length}/${todos.todos.length}`
        )
      : null,
}));
vi.mock('@/components/chat/RetryBar', () => ({ RetryBar: () => null }));
vi.mock('@/components/chat/MessageQueue', () => ({ MessageQueue: () => null }));
vi.mock('./SessionStatsLine', () => ({ SessionStatsLine: () => null }));

const noop = () => {};
beforeEach(() => {
  prefs.pinUnfinishedTodos = true;
});
const render = (patch: Partial<Parameters<typeof ChatScreen>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ChatScreen, {
      sessionId: 'direct',
      title: 'Bot',
      projectName: '',
      view: null,
      connState: 'online',
      stateLabel: 'online',
      canCreate: true,
      onOpenDrawer: noop,
      onNewSession: noop,
      onSend: noop,
      onAbort: noop,
      onApproval: noop,
      onAsk: noop,
      bot: {},
      ...patch,
    })
  );

it('offers new-session in direct Bot and Code, but not the read-only group process', () => {
  expect(render()).toContain('aria-label="新建会话"');
  expect(render({ bot: undefined })).toContain('aria-label="新建会话"');
  expect(render({ bot: { readOnly: true } })).not.toContain('aria-label="新建会话"');
});

it('Code 和 Bot 都能看到本地握手发送失败，而不是只有 Bot notice', () => {
  for (const bot of [undefined, {}]) {
    expect(render({ bot, notice: '操作未发送：handshake timeout' })).toContain(
      '操作未发送：handshake timeout'
    );
  }
});

it('retains a direct Bot draft across session replacement, without merging Code drafts', () => {
  for (const sessionId of ['old', 'new']) {
    expect(render({ sessionId, bot: { chatId: 'chat' } })).toContain(
      'data-draft-key="bot-chat:chat"'
    );
    expect(render({ sessionId, bot: undefined })).toContain(`data-draft-key="${sessionId}"`);
  }
});

it.each([{ canCreate: false }, { deviceReadOnly: true }, { connState: 'offline' as const }])(
  'disables direct new-session when unavailable: %j',
  (patch) => {
    expect(render(patch).match(/<button[^>]*aria-label="新建会话"[^>]*>/)?.[0]).toContain(
      'disabled=""'
    );
  }
);

it('同步超时后给出可重试的失败态，而不是一直显示加载中', () => {
  const retry = vi.fn();
  const waiting = render({ view: null, syncing: true, onRetrySync: retry });
  expect(waiting).not.toContain('没读到会话历史');
  const failed = render({
    view: null,
    syncing: true,
    syncFailed: true,
    onRetrySync: retry,
  });
  expect(failed).toContain('没读到会话历史');
  expect(failed).toContain('重试');
  // 有本地缓存正文时不盖失败态：正文仍可看
  const cached = emptyGuestView();
  cached.messages.set(0, { role: 'user', content: [{ type: 'text', text: 'hi' }] });
  expect(render({ view: cached, syncing: true, syncFailed: true })).not.toContain('没读到会话历史');
});

it('有缓存正文时同步失败仍保留正文，并给出不遮挡的重试入口', () => {
  const retry = vi.fn();
  const cached = emptyGuestView();
  cached.messages.set(0, { role: 'user', content: [{ type: 'text', text: 'cached body' }] });
  const html = render({ view: cached, syncing: true, syncFailed: true, onRetrySync: retry });
  // 正文继续渲染：失败态不接管时间线，也不假装还在同步
  expect(html).toContain('data-timeline');
  expect(html).toContain('data-busy="false"');
  expect(html).not.toContain('没读到会话历史');
  // 非遮挡的失败提示 + 可操作的重试按钮
  expect(html).toContain('data-sync-failed-banner');
  expect(html).toContain('未读到最新历史');
  expect(html).toContain('重试');
  // 顶栏状态灯不能继续宣称「同步中…」
  expect(html).not.toContain('同步中…');
  expect(html).toContain('未读到最新历史');
  expect(html).toContain('data-sync-state="failed"');
  expect(html).not.toContain('animate-pulse bg-warning');
});

it('连接不在线时同步失败提示优先归因连接状态，不宣称桌面端没有回应', () => {
  const cached = emptyGuestView();
  cached.messages.set(0, { role: 'user', content: [{ type: 'text', text: 'cached body' }] });
  const offline = render({
    view: cached,
    connState: 'host-offline',
    stateLabel: '与桌面连接已断开',
    syncing: true,
    syncFailed: true,
  });
  expect(offline).toContain('data-timeline');
  expect(offline).not.toContain('桌面端没有回应');
  expect(offline).not.toContain('未读到最新历史');
  expect(offline).toContain('与桌面连接已断开');
});

it('keeps current progress in the shared task dock, including read-only conversations', () => {
  const view = emptyGuestView();
  view.messages.set(20, {
    role: 'toolResult',
    toolName: 'todo',
    toolCallId: 'list',
    content: [],
    todos: [
      { content: 'Test', status: 'completed' },
      { content: 'Implement', status: 'in_progress' },
    ],
  });
  for (const deviceReadOnly of [false, true]) {
    const html = render({ view, deviceReadOnly });
    expect(html).toContain('data-task-dock-button="todo"');
    expect(html).toContain('Current progress 1/2');
  }
  view.messages.set(21, {
    role: 'toolResult',
    toolName: 'todo',
    toolCallId: 'finished',
    content: [],
    todos: [{ content: 'Done', status: 'completed' }],
  });
  expect(render({ view })).not.toContain('data-task-dock-button="todo"');
});

it('respects the host pinned-progress preference without leaking progress across sessions', () => {
  const view = emptyGuestView();
  view.messages.set(0, {
    role: 'toolResult',
    toolName: 'todo',
    content: [],
    todos: [{ content: 'Unfinished', status: 'pending' }],
  });
  expect(render({ view })).toContain('data-task-dock-button="todo"');
  expect(render({ sessionId: 'other', view: emptyGuestView() })).not.toContain(
    'data-task-dock-button="todo"'
  );
  prefs.pinUnfinishedTodos = false;
  expect(render({ view })).not.toContain('data-task-dock-button="todo"');
});
