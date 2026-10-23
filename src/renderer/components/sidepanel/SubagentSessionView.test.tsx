import { createContext, createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@/stores/sessions';
import { emptyProjection } from '@/stores/sessions/reducer';
import { SubagentDirectoryView } from './SubagentDirectoryView';
import { SubagentSessionView } from './SubagentSessionView';

const mock = vi.hoisted(() => ({
  state: { activeId: 'parent', conversations: {} as Record<string, Conversation> },
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign(
    (select: (state: typeof mock.state) => unknown) => select(mock.state),
    { getState: () => mock.state }
  ),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      projects: [{ id: 'project', path: '/repo' }],
      autoCollapseTurns: false,
      collapseCompletedActivity: false,
      compactReadOnlyTools: false,
    }),
}));
vi.mock('@/lib/sidePanelDock', () => ({
  addSidePanelSubagent: vi.fn(),
  openSidePanelFile: vi.fn(),
}));
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));
vi.mock('@/components/chat/Markdown', () => ({
  MarkdownLinkContext: createContext(null),
  Markdown: ({ text }: { text: string }) => createElement('div', null, text),
}));
// SSR normally renders no virtual rows. Render the real MessageTimeline rows synchronously;
// this does not emulate layout, scrolling, effects or the observation acquire/release lifecycle.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
    components,
    firstItemIndex,
  }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => ReactNode;
    components: { Header: () => ReactNode; Footer: () => ReactNode };
    firstItemIndex: number;
  }) =>
    createElement(
      'div',
      null,
      createElement(components.Header),
      ...data.map((item, index) =>
        createElement('div', { key: index }, itemContent(firstItemIndex + index, item))
      ),
      createElement(components.Footer)
    ),
}));

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    ...emptyProjection,
    id,
    projectId: 'project',
    title: id,
    createdAt: 1,
    started: true,
    spawning: false,
    ...overrides,
  };
}
beforeEach(() => {
  mock.state.conversations = {
    parent: conversation('parent', {
      status: 'idle',
      activeTabId: 'child',
      messages: [
        {
          role: 'user',
          entryId: 'parent-user',
          content: [{ type: 'text', text: 'parent secret text' }],
        },
      ],
    }),
    child: conversation('child', {
      parentId: 'parent',
      status: 'idle',
      lastModelId: 'model-observer',
      sessionFile: '/recorded.jsonl',
      historyLoadAttempted: true,
      child: {
        parentId: 'parent',
        agentInstanceId: 'agent',
        agentInstanceName: 'Scout',
        agentTypeKey: 'builtin:scout',
        childGeneration: 'g',
        dispatchOrigin: 'agent-tool',
        mode: 'task',
      },
      messages: [
        { role: 'user', entryId: 'child-user', content: [{ type: 'text', text: 'child task' }] },
        {
          role: 'assistant',
          entryId: 'child-answer',
          content: [{ type: 'text', text: 'recorded answer' }],
        },
      ],
    }),
  };
});

const render = () =>
  renderToStaticMarkup(
    createElement(SubagentSessionView, {
      parentConversationId: 'parent',
      childConversationId: 'child',
      visible: true,
    })
  );

describe('read-only subagent observation surface (SSR)', () => {
  const renderDirectory = () =>
    renderToStaticMarkup(createElement(SubagentDirectoryView, { parentConversationId: 'parent' }));
  const makeCollaborator = () => {
    mock.state.conversations.child.child!.mode = 'coworker';
    mock.state.conversations.parent.coworkerIds = ['child'];
  };

  it('目录明确区分一次性任务、持久协作者和准确的来源标签', () => {
    for (const [origin, label] of [
      ['manual', 'Created manually'],
      ['agent-tool', 'Dispatched by agent'],
      ['typed-mention', 'Dispatched via mention'],
    ] as const) {
      mock.state.conversations.child.child!.dispatchOrigin = origin;
      const html = renderDirectory();
      expect(html).toContain('Agents');
      expect(html).toContain('One-off task');
      expect(html).toContain(label);
      expect(html).toContain('View process');
      expect(html).not.toContain('Open conversation');
    }
  });

  it('活协作者提供独立会话动作，多个 Run 结束后仍显示待命而非销毁', () => {
    makeCollaborator();
    mock.state.conversations.child.lastSubagentRun = {
      runId: 'run-2',
      status: 'succeeded',
      finishedAt: 10,
    };
    const html = renderDirectory();
    expect(html).toContain('Persistent collaborator');
    expect(html).toContain('Collaborator standing by');
    expect(html).toContain('Last run: Succeeded');
    expect(html.match(/>View process</g)).toHaveLength(1);
    expect(html.match(/>Open conversation</g)).toHaveLength(1);
    expect(html).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/);
    expect(mock.state.conversations.parent.activeTabId).toBe('child');
  });

  it('历史、已结束、非法 mode 和非直属成员没有会话动作，缺省 mode 兼容旧协作者', () => {
    makeCollaborator();
    const c = mock.state.conversations.child;
    for (const lifecycle of [{ ended: true }, { historyOnly: true }]) {
      Object.assign(c, { ended: undefined, historyOnly: undefined }, lifecycle);
      const html = renderDirectory();
      expect(html).toContain('Ended');
      expect(html).toContain('View process');
      expect(html).not.toContain('Open conversation');
    }
    Object.assign(c, { ended: undefined, historyOnly: undefined });
    c.child!.mode = undefined;
    expect(renderDirectory()).toContain('Open conversation');
    Object.assign(c.child!, { mode: 'invalid' });
    expect(renderDirectory()).not.toContain('Open conversation');
    c.child!.mode = 'coworker';
    mock.state.conversations.parent.coworkerIds = [];
    expect(renderDirectory()).not.toContain('Open conversation');
  });

  it('只读详情明确不能发消息且关闭视图不结束代理', () => {
    const html = render();
    expect(html).toContain('Process observation only. Messages cannot be sent here.');
    expect(html).toContain('Closing this view does not stop the agent.');
    expect(html).not.toContain('Open conversation');
  });

  it('活协作者详情提供会话入口但结束后只保留观察', () => {
    makeCollaborator();
    expect(render()).toContain('Open conversation');
    expect(render()).toContain('Collaborator standing by');
    mock.state.conversations.child.ended = true;
    expect(render()).not.toContain('Open conversation');
  });

  it('renders the child body and model while suppressing timeline write controls', () => {
    mock.state.conversations.parent.activeTabId = undefined;
    const html = render();
    expect(html).toContain('recorded answer');
    expect(html).toContain('child task');
    expect(html).toContain('model-observer');
    expect(html).toContain('Read-only');
    expect(html).not.toContain('parent secret text');
    for (const label of [
      'title="Retry"',
      'Retry resume',
      'Rewind',
      'Withdraw message',
      'Conversation branch',
      'Send message',
      'Move to background',
    ]) {
      expect(html).not.toContain(label);
    }
    expect(html).not.toMatch(/<textarea|contenteditable|<form/);
    expect(mock.state.activeId).toBe('parent');
    expect(mock.state.conversations.parent.activeTabId).toBeUndefined();
  });

  it('preserves recorded body when history fails and exposes only a read-only reload action', () => {
    Object.assign(mock.state.conversations.child, {
      historyError: 'History file is missing',
      status: 'failed',
      error: 'worker exited',
    });
    const html = render();
    expect(html).toContain('role="alert"');
    expect(html).toContain('History file is missing');
    expect(html).toContain('recorded answer');
    expect(html).toContain('worker exited');
    expect(html).toContain('Reload recorded history');
    expect(html).not.toContain('Retry resume');
  });

  it('reports missing ended history and incomplete journal explicitly', () => {
    Object.assign(mock.state.conversations.child, {
      ended: true,
      messages: [],
      sessionFile: undefined,
      historyPartial: true,
    });
    const html = render();
    expect(html).toContain('Recorded history is unavailable for this ended subagent.');
    expect(html).toContain(
      'Only recorded history is shown. Some earlier content may be unavailable.'
    );
    expect(html).not.toContain('Preparing session');
  });

  it('does not render another child when parent metadata becomes invalid', () => {
    mock.state.conversations.child.parentId = 'other';
    const html = render();
    expect(html).toContain('Subagent session is unavailable.');
    expect(html).not.toContain('recorded answer');
    expect(html).not.toContain('Reload recorded history');
  });

  it('renders directory lifecycle groups without presenting a complete run ledger', () => {
    mock.state.conversations.ended = conversation('ended', {
      ...mock.state.conversations.child,
      id: 'ended',
      ended: true,
      child: {
        ...mock.state.conversations.child.child!,
        agentInstanceId: 'ended-agent',
        agentInstanceName: 'Finished scout',
      },
    });
    const html = renderToStaticMarkup(
      createElement(SubagentDirectoryView, { parentConversationId: 'parent' })
    );
    expect(html).toContain('In progress');
    expect(html).toContain('Ended');
    expect(html).toContain('Finished scout');
    expect(html).toContain('Recorded child sessions, not a complete run history.');
    expect(mock.state.activeId).toBe('parent');
  });

  it('shows the authoritative latest run failure only until the next run starts', () => {
    Object.assign(mock.state.conversations.child, {
      lastSubagentRun: {
        runId: 'last-run',
        status: 'failed',
        finishedAt: 10,
        error: 'run gate rejected output',
      },
    });
    expect(render()).toContain('run gate rejected output');
    expect(render()).toContain('Failed');
    mock.state.conversations.child.status = 'running';
    const next = render();
    expect(next).toContain('Running');
    expect(next).not.toContain('run gate rejected output');
  });
});
