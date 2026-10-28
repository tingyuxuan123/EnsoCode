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
vi.mock('@/components/chat/MessageTimeline', () => ({ MessageTimeline: () => null, CHAT_COL: '' }));
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
