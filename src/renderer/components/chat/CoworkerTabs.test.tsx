import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoworkerTabs } from './CoworkerTabs';

const mock = vi.hoisted(() => ({ state: { conversations: {} as Record<string, unknown> } }));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: object) => unknown) =>
    selector({ agentTypes: [], disabledBuiltinAgentTypes: [] }),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: Object.assign((selector: (s: object) => unknown) => selector(mock.state), {
    getState: () => mock.state,
  }),
}));
vi.mock('@/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
  ContextMenuTrigger: ({ render }: { render: React.ReactNode }) => render,
  ContextMenuPopup: () => null,
  ContextMenuItem: () => null,
}));
vi.mock('@/components/ui/menu', () => ({
  Menu: ({ children }: { children: React.ReactNode }) => children,
  MenuTrigger: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement('button', { ...props, type: 'button' }, children),
  MenuPopup: () => null,
  MenuItem: () => null,
}));

beforeEach(() => {
  mock.state.conversations = {
    parent: { id: 'parent', title: 'Main', started: true, coworkerIds: ['task', 'coworker'] },
    task: { id: 'task', parentId: 'parent', title: 'One-off test', child: { mode: 'task' } },
    coworker: {
      id: 'coworker',
      parentId: 'parent',
      title: 'Persistent test',
      child: {
        mode: 'coworker',
        parentId: 'parent',
        agentInstanceId: 'agent',
        agentInstanceName: 'Persistent test',
        dispatchOrigin: 'manual',
      },
    },
  };
});

describe('协作者标签操作语义', () => {
  it('一次性任务不出现，协作者关闭是关闭视图而非解雇', () => {
    const html = renderToStaticMarkup(
      createElement(CoworkerTabs, { parentId: 'parent', displayedId: 'parent' })
    );
    expect(html).not.toContain('One-off test');
    expect(html).toContain('Persistent test');
    expect(html).toContain('aria-label="Close conversation view"');
    expect(html).not.toContain('title="Dismiss coworker"');
    expect(html).toContain('aria-label="Collaborator actions"');
    expect(html).toContain('title="Add collaborator"');
  });

  it('隐藏协作者后仍有可发现的恢复入口', () => {
    mock.state.conversations.parent = {
      ...(mock.state.conversations.parent as object),
      hiddenCoworkerIds: ['coworker'],
    };
    const html = renderToStaticMarkup(
      createElement(CoworkerTabs, { parentId: 'parent', displayedId: 'parent' })
    );
    expect(html).not.toContain('Persistent test');
    expect(html).toContain('aria-label="Reopen collaborator"');
  });
});
