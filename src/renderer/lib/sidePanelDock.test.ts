import type { DockviewApi } from 'dockview-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSidePanelBrowser,
  bindSidePanelDock,
  disposeConversationResources,
  openSidePanelBrowserUrl,
} from './sidePanelDock';
import { resolveSidePanelDockConversationId } from './sidePanelDockId';

const harness = vi.hoisted(() => ({
  conversations: {} as Record<string, { projectId: string; btwParentId?: string }>,
  ensureOpen: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: {
    getState: () => ({ activeId: 'other', conversations: harness.conversations }),
  },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ disabledBuiltinTools: [], projects: [] }) },
}));
vi.mock('@/stores/sidePanel', () => ({
  useSidePanelStore: {
    getState: () => ({ ensureOpen: harness.ensureOpen, forgetConversation: vi.fn() }),
  },
}));
vi.mock('@/lib/terminalRegistry', () => ({ releaseTerminal: vi.fn() }));

function fakeDock(hasPanels = false) {
  const addPanel = vi.fn();
  const api = {
    panels: hasPanels ? [{ id: 'existing' }] : [],
    getPanel: () => undefined,
    addPanel,
  } as unknown as DockviewApi;
  return { api, addPanel };
}

beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: { browser: { navigate: harness.navigate } } });
  for (const id of ['parent', 'btw', 'cold', 'missing']) disposeConversationResources(id);
  harness.conversations = {
    parent: { projectId: 'p' },
    btw: { projectId: 'p', btwParentId: 'parent' },
    cold: { projectId: 'p' },
  };
  vi.clearAllMocks();
  harness.navigate.mockResolvedValue({ ok: true, result: {} });
});

describe('openSidePanelBrowserUrl', () => {
  it('每次打开新 tab，归属点击来源而非当前激活会话', async () => {
    const { api, addPanel } = fakeDock();
    bindSidePanelDock('parent', api);
    await openSidePanelBrowserUrl('parent', 'https://example.com/');
    await openSidePanelBrowserUrl('parent', 'http://example.com/other');
    const first = addPanel.mock.calls[0][0];
    const second = addPanel.mock.calls[1][0];
    expect(first.id).toMatch(/^browser:/);
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      component: 'browser',
      params: { conversationId: 'parent', projectId: 'p' },
    });
    expect(harness.navigate).toHaveBeenNthCalledWith(1, first.id, 'parent', 'https://example.com/');
    expect(harness.ensureOpen).toHaveBeenCalledWith('parent');
  });

  it('btw 在父 dock 建 tab，但导航仍保留原会话 owner', async () => {
    const { api, addPanel } = fakeDock();
    bindSidePanelDock('parent', api);
    await openSidePanelBrowserUrl('btw', 'https://example.com/');
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ params: { conversationId: 'btw', projectId: 'p' } })
    );
    expect(harness.navigate).toHaveBeenCalledWith(
      addPanel.mock.calls[0][0].id,
      'btw',
      'https://example.com/'
    );
  });

  it('冷 dock 保留同一 tab id，挂载后创建', async () => {
    await openSidePanelBrowserUrl('cold', 'https://example.com/');
    const tabId = harness.navigate.mock.calls[0][0];
    const { api, addPanel } = fakeDock();
    bindSidePanelDock('cold', api);
    await Promise.resolve();
    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: tabId, params: { conversationId: 'cold', projectId: 'p' } })
    );
  });

  it('已删除会话拒绝创建和导航', async () => {
    await expect(openSidePanelBrowserUrl('missing', 'https://example.com/')).rejects.toThrow();
    expect(harness.navigate).not.toHaveBeenCalled();
    expect(harness.ensureOpen).not.toHaveBeenCalled();
  });

  it.each(['javascript:alert(1)', 'file:///tmp/a.html', '//example.com', 'mailto:a@example.com'])(
    '不扩大到其它协议：%s',
    async (url) => {
      await expect(openSidePanelBrowserUrl('parent', url)).rejects.toThrow();
      expect(harness.navigate).not.toHaveBeenCalled();
      expect(harness.ensureOpen).not.toHaveBeenCalled();
    }
  );

  it('结构化失败与 IPC 拒绝都传回调用者以显示 toast', async () => {
    harness.navigate.mockResolvedValueOnce({ ok: false, error: 'navigation-denied' });
    await expect(openSidePanelBrowserUrl('parent', 'https://example.com/')).rejects.toThrow(
      'navigation-denied'
    );
    harness.navigate.mockRejectedValueOnce(new Error('IPC unavailable'));
    await expect(openSidePanelBrowserUrl('parent', 'https://example.com/')).rejects.toThrow(
      'IPC unavailable'
    );
  });
});

describe('浏览器自动展示与用户输入焦点', () => {
  it('自动导航完成通知不重新聚焦已存在的浏览器面板', () => {
    const focus = vi.fn();
    const api = {
      panels: [],
      getPanel: () => ({ focus }),
      addPanel: vi.fn(),
    } as unknown as DockviewApi;
    bindSidePanelDock('parent', api);

    addSidePanelBrowser({ conversationId: 'parent', tabId: 'browser:existing', background: true });

    expect(focus).not.toHaveBeenCalled();
    expect(api.addPanel).not.toHaveBeenCalled();
  });

  it('自动新建的面板不激活，避免打断用户正在输入或查看的面板', () => {
    const { api, addPanel } = fakeDock(true);
    bindSidePanelDock('parent', api);

    addSidePanelBrowser({ conversationId: 'parent', tabId: 'browser:new', background: true });

    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'browser:new', component: 'browser', inactive: true })
    );
  });

  it('冷 dock 挂载后仍保留自动展示不抢焦点的意图', async () => {
    addSidePanelBrowser({ conversationId: 'cold', tabId: 'browser:cold', background: true });
    const { api, addPanel } = fakeDock(true);

    bindSidePanelDock('cold', api);
    await Promise.resolve();

    expect(addPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'browser:cold', inactive: true })
    );
  });

  it('用户明确打开已存在的浏览器面板时仍可聚焦', () => {
    const focus = vi.fn();
    const api = {
      panels: [],
      getPanel: () => ({ focus }),
      addPanel: vi.fn(),
    } as unknown as DockviewApi;
    bindSidePanelDock('parent', api);

    addSidePanelBrowser({ conversationId: 'parent', tabId: 'browser:existing' });

    expect(focus).toHaveBeenCalledOnce();
  });
});

describe('resolveSidePanelDockConversationId', () => {
  it('普通会话用自身 id', () => {
    expect(resolveSidePanelDockConversationId({ parent: {} }, 'parent')).toBe('parent');
  });

  it('btw 会话落到父会话 dock，用户才能看见浏览器', () => {
    expect(
      resolveSidePanelDockConversationId(
        {
          parent: {},
          btw: { btwParentId: 'parent' },
        },
        'btw'
      )
    ).toBe('parent');
  });

  it('未知会话保持原 id', () => {
    expect(resolveSidePanelDockConversationId({}, 'missing')).toBe('missing');
  });
});
