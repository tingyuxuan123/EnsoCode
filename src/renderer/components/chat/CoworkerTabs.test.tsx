import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoworkerTabs } from './CoworkerTabs';

const mock = vi.hoisted(() => ({
  state: { conversations: {} as Record<string, unknown> },
  settings: { agentTypes: [], disabledBuiltinAgentTypes: [], designEnabled: true },
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: object) => unknown) => selector(mock.settings),
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
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? children : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => children,
  DialogDescription: () => null,
  DialogFooter: () => null,
  DialogHeader: () => null,
  DialogPanel: ({ children }: { children: React.ReactNode }) => children,
  DialogTitle: () => null,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => children,
  SelectPopup: ({ children }: { children: React.ReactNode }) => children,
  SelectItem: ({ value }: { value: string }) => createElement('span', { 'data-agent-type': value }),
  SelectTrigger: () => null,
  SelectValue: () => null,
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
  it('旧系统助手页签展示新品牌，不改持久化实例名', () => {
    mock.state.conversations.coworker = {
      id: 'coworker',
      parentId: 'parent',
      title: 'Enso · a1',
      child: { mode: 'coworker', agentTypeKey: 'agent:enso', agentInstanceName: 'Enso · a1' },
    };
    const html = renderToStaticMarkup(
      createElement(CoworkerTabs, { parentId: 'parent', displayedId: 'parent' })
    );
    expect(html).toContain('Collabra · a1');
    expect(html).not.toContain('Enso · a1');
    expect(mock.state.conversations.coworker).toHaveProperty(
      'child.agentInstanceName',
      'Enso · a1'
    );
  });
  it('用户主动改过的系统助手页签标题不随品牌覆盖', () => {
    mock.state.conversations.coworker = {
      id: 'coworker',
      parentId: 'parent',
      title: 'Enso migration notes',
      child: { mode: 'coworker', agentTypeKey: 'agent:enso', agentInstanceName: 'Enso · a1' },
    };
    const html = renderToStaticMarkup(
      createElement(CoworkerTabs, { parentId: 'parent', displayedId: 'parent' })
    );
    expect(html).toContain('Enso migration notes');
  });
  it.each([true, false])('雇佣类型按设计开关过滤：%s', async (designEnabled) => {
    const dom = parseHTML('<html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.document);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = dom.document.getElementById('root') as unknown as HTMLElement;
    const root = createRoot(container);
    mock.settings.designEnabled = designEnabled;
    try {
      await act(async () =>
        root.render(createElement(CoworkerTabs, { parentId: 'parent', displayedId: 'parent' }))
      );
      await act(async () =>
        container.querySelector<HTMLButtonElement>('button[title="Add collaborator"]')!.click()
      );
      expect(container.querySelector('[data-agent-type="worker"]')).not.toBeNull();
      expect(Boolean(container.querySelector('[data-agent-type="designer"]'))).toBe(designEnabled);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });
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
