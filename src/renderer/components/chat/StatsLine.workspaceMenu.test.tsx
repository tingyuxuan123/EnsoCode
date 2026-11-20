// @vitest-environment happy-dom
import type { OpenInApp } from '@shared/types';
import { act, createElement, type ReactNode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProjection } from '@/stores/sessions/reducer';
import { StatsLine } from './StatsLine';

const harness = vi.hoisted(() => ({
  conversations: {} as Record<string, object>,
  projects: [] as object[],
  apps: [] as OpenInApp[],
  reveal: vi.fn(async () => ({ ok: true as const })),
  openInApps: vi.fn(async () => harness.apps),
  writeText: vi.fn(async () => {}),
}));

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: (select: (state: object) => unknown) =>
    select({
      conversations: harness.conversations,
      worktreeStatuses: {},
    }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      virtualModels: [],
      projects: harness.projects,
      statusLineSegments: [],
    }),
}));
vi.mock('@/stores/modelDirectory/useProviders', () => ({ useMaterializedProviders: () => [] }));
vi.mock('./ContextInspector', () => ({ ContextInspector: () => null }));
vi.mock('./StatusLineSettings', () => ({ StatusLineSettings: () => null }));
vi.mock('@/hooks/useAccountUsage', () => ({
  fetchAccountUsage: vi.fn(),
  USAGE_CACHE_TTL_MS: 60_000,
  usageCache: new Map(),
}));

// Menu 定位与 Portal 由 Base UI 测试覆盖；这里将弹出层就地挂载以验证菜单内容、方向 props 与动作。
vi.mock('@/components/ui/menu', () => {
  const Wrap = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  const Trigger = ({
    children,
    onPointerEnter,
    ...rest
  }: {
    children?: ReactNode;
    onPointerEnter?: () => void;
    [key: string]: unknown;
  }) => createElement('button', { type: 'button', onPointerEnter, ...rest }, children);
  const Popup = ({
    children,
    side,
    align,
  }: {
    children?: ReactNode;
    side?: string;
    align?: string;
  }) =>
    createElement(
      'div',
      { 'data-mock-menu-popup': '', 'data-side': side, 'data-align': align },
      children
    );
  const Item = ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => createElement('button', { type: 'button', role: 'menuitem', disabled, onClick }, children);
  return {
    Menu: ({
      children,
      onOpenChange,
    }: {
      children?: ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => {
      useEffect(() => {
        onOpenChange?.(true);
      }, [onOpenChange]);
      return createElement('div', null, children);
    },
    MenuTrigger: Trigger,
    MenuPopup: Popup,
    MenuGroup: Wrap,
    MenuGroupLabel: Wrap,
    MenuItem: Item,
    MenuSeparator: () => createElement('hr'),
  };
});

describe('StatsLine 左下角工作区目录菜单', () => {
  let container: HTMLDivElement;
  let root: Root;

  const menuItem = (text: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((el) =>
      el.textContent?.includes(text)
    );

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('electronAPI', {
      env: { platform: 'darwin' },
      projects: {
        openInApps: harness.openInApps,
        reveal: harness.reveal,
      },
    });
    vi.stubGlobal('navigator', { clipboard: { writeText: harness.writeText } });
    harness.projects = [];
    harness.conversations = {};
    harness.apps = [
      { id: 'vscode', name: 'VS Code', kind: 'editor' },
      { id: 'apple-terminal', name: 'Terminal', kind: 'terminal' },
    ];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('本地项目左下角显示可点击目录按钮，向上左对齐弹出打开/编辑器/终端/复制路径菜单', async () => {
    harness.projects = [{ id: 'p1', name: 'EnsoCode', path: '/code/EnsoCode', kind: 'local' }];
    harness.conversations = {
      root: { ...emptyProjection, id: 'root', projectId: 'p1', title: '', createdAt: 1 },
    };

    await act(async () => root.render(createElement(StatsLine, { conversationId: 'root' })));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="workspace-directory-trigger"]'
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('EnsoCode');
    expect(trigger?.getAttribute('title')).toBe('/code/EnsoCode');

    const popup = container.querySelector('[data-mock-menu-popup]');
    expect(popup?.getAttribute('data-side')).toBe('top');
    expect(popup?.getAttribute('data-align')).toBe('start');

    await act(async () => menuItem('Open in Finder')?.click());
    expect(harness.reveal).toHaveBeenCalledWith({ projectId: 'p1', conversationId: 'root' });

    await act(async () => menuItem('VS Code')?.click());
    expect(harness.reveal).toHaveBeenCalledWith({
      projectId: 'p1',
      conversationId: 'root',
      appId: 'vscode',
    });

    await act(async () => menuItem('Copy Path')?.click());
    expect(harness.writeText).toHaveBeenCalledWith('/code/EnsoCode');
  });

  it('子会话或 Btw 会话继承根会话的 worktree 路径，worktree 缺失时禁用打开但保留复制路径', async () => {
    harness.projects = [{ id: 'p1', name: 'EnsoCode', path: '/code/EnsoCode', kind: 'local' }];
    harness.conversations = {
      root: {
        ...emptyProjection,
        id: 'root',
        projectId: 'p1',
        title: '',
        createdAt: 1,
        worktree: { path: '/code/EnsoCode-wt', branch: 'feat' },
        worktreeMissing: true,
      },
      btw: {
        ...emptyProjection,
        id: 'btw',
        projectId: 'p1',
        title: '',
        btwParentId: 'root',
        createdAt: 2,
      },
    };

    await act(async () => root.render(createElement(StatsLine, { conversationId: 'btw' })));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="workspace-directory-trigger"]'
    );
    expect(trigger?.getAttribute('title')).toBe('/code/EnsoCode-wt');
    expect(menuItem('Open in Finder')?.disabled).toBe(true);
    expect(menuItem('VS Code')?.disabled).toBe(true);
    expect(menuItem('Copy Path')?.disabled).toBe(false);

    await act(async () => menuItem('Copy Path')?.click());
    expect(harness.writeText).toHaveBeenCalledWith('/code/EnsoCode-wt');
  });

  it('SSH 远端项目仅展示复制路径，不暴露本机访达/编辑器/终端入口', async () => {
    harness.projects = [
      { id: 'p1', name: 'api', path: '/srv/api', kind: 'ssh', sshConnectionName: 'Prod' },
    ];
    harness.conversations = {
      root: { ...emptyProjection, id: 'root', projectId: 'p1', title: '', createdAt: 1 },
    };

    await act(async () => root.render(createElement(StatsLine, { conversationId: 'root' })));

    expect(menuItem('Open in Finder')).toBeUndefined();
    expect(menuItem('VS Code')).toBeUndefined();
    expect(menuItem('Copy Path')?.disabled).toBe(false);
    await act(async () => menuItem('Copy Path')?.click());
    expect(harness.writeText).toHaveBeenCalledWith('/srv/api');
  });
});
