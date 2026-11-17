import { beforeEach, expect, it, vi } from 'vitest';

/**
 * 插件侧栏页的开关语义：
 * - `close` 只关本插件的那一个页面；
 * - 右侧栏是插件 `open` 为它打开、且它仍是当前标签时，才一并收起；
 * - 用户原本就开着的右侧栏不能被插件收起。
 */
const side: {
  uiByConversation: Record<string, { open: boolean; width: number }>;
  lastWidth: number;
  ensureOpen(id?: string): void;
} = {
  uiByConversation: {},
  lastWidth: 320,
  ensureOpen(id?: string) {
    const key = id ?? 's';
    side.uiByConversation = { ...side.uiByConversation, [key]: { open: true, width: 320 } };
  },
};

const conversations: Record<string, { projectId: string }> = {
  a: { projectId: 'p' },
  b: { projectId: 'p' },
  c: { projectId: 'p' },
  d: { projectId: 'p' },
  pending: { projectId: 'p' },
};

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: { getState: () => ({ activeId: 'a', conversations }) },
}));
vi.mock('@/stores/settings', () => ({ useSettingsStore: { getState: () => ({ projects: [] }) } }));
vi.mock('@/stores/sidePanel', () => ({
  useSidePanelStore: {
    getState: () => side,
    setState: (updater: unknown) => {
      const next =
        typeof updater === 'function'
          ? (updater as (state: typeof side) => Partial<typeof side>)(side)
          : (updater as Partial<typeof side>);
      Object.assign(side, next);
    },
  },
}));
vi.mock('@/lib/terminalRegistry', () => ({ releaseTerminal() {} }));

import type { DockviewApi } from 'dockview-react';
import {
  bindSidePanelDock,
  closeSidePanelPluginView,
  openSidePanelPluginView,
} from '@/lib/sidePanelDock';

function fakeDock() {
  const panels = new Map<
    string,
    { id: string; api: { close(): void; focus(): void; updateParameters(p: unknown): void } }
  >();
  const state: { activeId?: string } = {};
  const api = {
    get panels() {
      return [...panels.values()];
    },
    get activePanel() {
      return state.activeId ? { id: state.activeId } : undefined;
    },
    getPanel: (id: string) => panels.get(id),
    addPanel: (options: { id: string; component: string; title: string; params: unknown }) => {
      const close = vi.fn(() => {
        panels.delete(options.id);
        if (state.activeId === options.id) state.activeId = undefined;
      });
      const focus = vi.fn(() => {
        state.activeId = options.id;
      });
      const panel = { id: options.id, api: { close, focus, updateParameters: vi.fn() } };
      panels.set(options.id, panel);
      state.activeId = options.id;
      return panel;
    },
  };
  return {
    api: api as unknown as DockviewApi,
    panels,
    panel: (id: string) => panels.get(id),
    activate: (id: string) => {
      state.activeId = id;
    },
  };
}

const reveal = (conversationId: string, viewId = 'runs') => ({
  conversationId,
  pluginId: 'enso.better',
  viewId,
  title: 'Runs',
});

beforeEach(() => {
  side.uiByConversation = {};
});

it('插件自己打开侧栏时，关闭该视图会一并收起侧栏', () => {
  const dock = fakeDock();
  bindSidePanelDock('a', dock.api);
  openSidePanelPluginView(reveal('a'));
  expect(dock.panel('plugin:enso.better:runs')).toBeDefined();
  expect(side.uiByConversation.a?.open).toBe(true);

  closeSidePanelPluginView({ conversationId: 'a', pluginId: 'enso.better', viewId: 'runs' });
  expect(dock.panel('plugin:enso.better:runs')).toBeUndefined();
  expect(side.uiByConversation.a?.open).toBe(false);
});

it('用户原本开着的侧栏不会被插件收起，只关插件页面', () => {
  const dock = fakeDock();
  bindSidePanelDock('b', dock.api);
  side.uiByConversation = { b: { open: true, width: 320 } };
  openSidePanelPluginView(reveal('b'));
  closeSidePanelPluginView({ conversationId: 'b', pluginId: 'enso.better', viewId: 'runs' });
  expect(dock.panel('plugin:enso.better:runs')).toBeUndefined();
  expect(side.uiByConversation.b?.open).toBe(true);
  // 同一个会话里再开一页：也不该被插件收掉
  openSidePanelPluginView(reveal('b', 'logs'));
  closeSidePanelPluginView({ conversationId: 'b', pluginId: 'enso.better', viewId: 'logs' });
  expect(dock.panel('plugin:enso.better:logs')).toBeUndefined();
  expect(side.uiByConversation.b?.open).toBe(true);
});

it('插件页面不是当前标签时不收起侧栏，但页面照关', () => {
  const dock = fakeDock();
  bindSidePanelDock('c', dock.api);
  openSidePanelPluginView(reveal('c'));
  dock.activate('changes');
  closeSidePanelPluginView({ conversationId: 'c', pluginId: 'enso.better', viewId: 'runs' });
  expect(dock.panel('plugin:enso.better:runs')).toBeUndefined();
  expect(side.uiByConversation.c?.open).toBe(true);
});

it('dock 还没挂载时关闭会取消挂起的打开，之后不再补建', async () => {
  openSidePanelPluginView(reveal('pending'));
  closeSidePanelPluginView({
    conversationId: 'pending',
    pluginId: 'enso.better',
    viewId: 'runs',
  });
  const dock = fakeDock();
  bindSidePanelDock('pending', dock.api);
  await Promise.resolve();
  expect(dock.panel('plugin:enso.better:runs')).toBeUndefined();
  expect(side.uiByConversation.pending?.open).toBe(false);
});

it('只关指定的那个视图，别人的页面不动', () => {
  const dock = fakeDock();
  bindSidePanelDock('d', dock.api);
  openSidePanelPluginView(reveal('d'));
  openSidePanelPluginView({
    conversationId: 'd',
    pluginId: 'other.plugin',
    viewId: 'x',
    title: 'X',
  });
  closeSidePanelPluginView({ conversationId: 'd', pluginId: 'enso.better', viewId: 'runs' });
  expect(dock.panel('plugin:enso.better:runs')).toBeUndefined();
  expect(dock.panel('plugin:other.plugin:x')).toBeDefined();
  expect(side.uiByConversation.d?.open).toBe(true);
});
