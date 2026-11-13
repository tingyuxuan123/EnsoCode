// @vitest-environment happy-dom

import { createDockview, type DockviewApi } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSidePanelBrowser,
  bindSidePanelDock,
  disposeConversationResources,
} from './sidePanelDock';

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: {
    getState: () => ({ activeId: 'owner', conversations: { owner: { projectId: 'project' } } }),
  },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ disabledBuiltinTools: [], projects: [] }) },
}));
vi.mock('@/stores/sidePanel', () => ({
  useSidePanelStore: { getState: () => ({ ensureOpen: vi.fn(), forgetConversation: vi.fn() }) },
}));
vi.mock('@/lib/terminalRegistry', () => ({ releaseTerminal: vi.fn() }));

let api: DockviewApi;
let composer: HTMLTextAreaElement;

beforeEach(() => {
  document.body.innerHTML = '<textarea id="composer">正在输入需求</textarea><div id="dock"></div>';
  composer = document.getElementById('composer') as HTMLTextAreaElement;
  api = createDockview(document.getElementById('dock') as HTMLElement, {
    disableAutoResizing: true,
    createComponent: () => ({ element: document.createElement('div'), init() {} }),
  });
  api.layout(600, 400);
});

afterEach(() => {
  disposeConversationResources('owner');
  api.dispose();
  document.body.innerHTML = '';
});

describe('真实 Dockview 的浏览器自动展示', () => {
  it('空 dock 首个自动页可见且 active，聊天焦点和光标不变', () => {
    bindSidePanelDock('owner', api);
    composer.focus();
    composer.setSelectionRange(2, 2);

    addSidePanelBrowser({ conversationId: 'owner', tabId: 'browser:first', background: true });

    const panel = api.getPanel('browser:first');
    expect(panel?.api.isVisible).toBe(true);
    expect(panel?.api.isActive).toBe(true);
    expect(document.activeElement).toBe(composer);
    expect(composer.selectionStart).toBe(2);
  });

  it('已有其它活动页时新自动页留在后台，重复通知也不抢聊天焦点', () => {
    bindSidePanelDock('owner', api);
    const terminal = api.addPanel({ id: 'terminal', component: 'terminal' });
    composer.focus();

    addSidePanelBrowser({ conversationId: 'owner', tabId: 'browser:next', background: true });
    addSidePanelBrowser({ conversationId: 'owner', tabId: 'browser:next', background: true });

    expect(terminal.api.isActive).toBe(true);
    expect(api.getPanel('browser:next')?.api.isActive).toBe(false);
    expect(document.activeElement).toBe(composer);
  });

  it('冷 dock 在 fromJSON 恢复完成后才重放待开页，不覆盖恢复的活动页和焦点', async () => {
    api.addPanel({ id: 'saved', component: 'terminal' });
    const saved = api.toJSON();
    addSidePanelBrowser({ conversationId: 'owner', tabId: 'browser:cold', background: true });

    bindSidePanelDock('owner', api);
    api.fromJSON(saved);
    composer.focus();
    await Promise.resolve();

    expect(api.getPanel('browser:cold')).toBeDefined();
    expect(api.getPanel('saved')?.api.isActive).toBe(true);
    expect(document.activeElement).toBe(composer);
  });
});
