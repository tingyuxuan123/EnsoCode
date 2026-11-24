import type { DockviewApi } from 'dockview-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  conversations: {} as Record<string, { projectId: string; btwParentId?: string }>,
  ensureOpen: vi.fn(),
}));

vi.mock('@/stores/sessions', () => ({
  useSessionsStore: {
    getState: () => ({ activeId: 'parent', conversations: harness.conversations }),
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

import {
  bindSidePanelDock,
  disposeConversationResources,
  openSidePanelFile,
  openSidePanelFileCitation,
  registerFilesOpener,
} from './sidePanelDock';

function fakeDock() {
  const panels: {
    id: string;
    component: string;
    title?: string;
    params: unknown;
    focus: ReturnType<typeof vi.fn>;
    api: {
      updateParameters: ReturnType<typeof vi.fn>;
      title?: string;
      setTitle: ReturnType<typeof vi.fn>;
    };
  }[] = [];
  const api = {
    panels,
    getPanel: (id: string) => panels.find((panel) => panel.id === id),
    addPanel: (opts: { id: string; component: string; title?: string; params: unknown }) => {
      panels.push({
        ...opts,
        focus: vi.fn(),
        api: { updateParameters: vi.fn(), title: opts.title, setTitle: vi.fn() },
      });
    },
  };
  return { api: api as unknown as DockviewApi, panels };
}

beforeEach(() => {
  vi.stubGlobal('window', {});
  for (const id of ['parent', 'btw', 'late']) disposeConversationResources(id);
  harness.conversations = {
    parent: { projectId: 'p1' },
    btw: { projectId: 'p1', btwParentId: 'parent' },
    late: { projectId: 'p2' },
  };
  harness.ensureOpen.mockClear();
});

describe('openSidePanelFile', () => {
  it('Files 视图已挂载：直接打开文件并聚焦 Files 面板', () => {
    const { api, panels } = fakeDock();
    bindSidePanelDock('parent', api);
    api.addPanel({ id: 'files', component: 'files' });
    const open = vi.fn();
    registerFilesOpener('parent', open);

    openSidePanelFile('parent', 'src/a.ts');

    expect(open).toHaveBeenCalledWith('src/a.ts');
    expect(panels[0].focus).toHaveBeenCalled();
    expect(harness.ensureOpen).toHaveBeenCalledWith('parent');
  });

  it('Files 面板未开：新建面板，视图挂载后补开文件且只补一次', () => {
    const { api, panels } = fakeDock();
    bindSidePanelDock('parent', api);

    openSidePanelFile('parent', 'src/a.ts');

    expect(panels.map((panel) => [panel.id, panel.params])).toEqual([
      ['files', { conversationId: 'parent', projectId: 'p1' }],
    ]);
    const open = vi.fn();
    const unregister = registerFilesOpener('parent', open);
    expect(open).toHaveBeenCalledWith('src/a.ts');
    unregister();
    const again = vi.fn();
    registerFilesOpener('parent', again);
    expect(again).not.toHaveBeenCalled();
  });

  it('btw 会话里的文件在父会话 dock 打开', () => {
    const { api } = fakeDock();
    bindSidePanelDock('parent', api);
    const open = vi.fn();
    registerFilesOpener('parent', open);

    openSidePanelFile('btw', 'src/b.ts');

    expect(open).toHaveBeenCalledWith('src/b.ts');
    expect(harness.ensureOpen).toHaveBeenCalledWith('parent');
  });

  it('带行号：已挂载时直接带行号打开，未挂载时补开也带行号', () => {
    const { api } = fakeDock();
    bindSidePanelDock('parent', api);
    openSidePanelFile('parent', 'src/a.ts', 107);
    const open = vi.fn();
    registerFilesOpener('parent', open);
    expect(open).toHaveBeenLastCalledWith('src/a.ts', 107);

    openSidePanelFile('parent', 'src/b.ts', 3);
    expect(open).toHaveBeenLastCalledWith('src/b.ts', 3);
  });

  it('dock 尚未挂载：挂载后补建 Files 面板', async () => {
    openSidePanelFile('late', 'README.md');
    const { api, panels } = fakeDock();
    bindSidePanelDock('late', api);
    await Promise.resolve();

    expect(panels.map((panel) => [panel.id, panel.params])).toEqual([
      ['files', { conversationId: 'late', projectId: 'p2' }],
    ]);
  });

  it('Markdown 预览意图在冷挂载与 btw 父路由中保留；行号仍保持源码', () => {
    openSidePanelFile('btw', 'README.md', undefined, 'markdown');
    const open = vi.fn();
    registerFilesOpener('parent', open);
    expect(open).toHaveBeenLastCalledWith('README.md', undefined, 'markdown');
    openSidePanelFile('btw', 'README.md', 9);
    expect(open).toHaveBeenLastCalledWith('README.md', 9);
  });
});

describe('openSidePanelFileCitation', () => {
  const id = 'a'.repeat(64);
  const file = { path: 'C:/Downloads/hook.ts', content: 'first\nsecond', line: 2 };

  it('opens the source conversation’s dock, including after a cold mount', async () => {
    const active = fakeDock();
    bindSidePanelDock('parent', active.api);
    openSidePanelFileCitation('late', id, file);
    expect(active.panels).toHaveLength(0);
    expect(harness.ensureOpen).toHaveBeenCalledWith('late');

    const owner = fakeDock();
    bindSidePanelDock('late', owner.api);
    await Promise.resolve();
    expect(owner.panels).toMatchObject([
      { id: `file-citation:${id}`, component: 'file-citation', title: 'hook.ts', params: file },
    ]);
  });

  it('focuses the existing tab and updates the target line and approved contents', () => {
    const { api, panels } = fakeDock();
    bindSidePanelDock('parent', api);
    openSidePanelFileCitation('parent', id, file);
    const latest = { ...file, line: 1, content: 'new text' };
    openSidePanelFileCitation('parent', id, latest);
    expect(panels).toHaveLength(1);
    expect(panels[0].api.updateParameters).toHaveBeenCalledWith(expect.objectContaining(latest));
    expect(panels[0].focus).toHaveBeenCalledOnce();
  });

  it('rejects missing conversations and drops pending previews for disposed owners', async () => {
    openSidePanelFileCitation('missing', id, file);
    expect(harness.ensureOpen).not.toHaveBeenCalled();
    openSidePanelFileCitation('late', id, file);
    disposeConversationResources('late');
    const { api, panels } = fakeDock();
    bindSidePanelDock('late', api);
    await Promise.resolve();
    expect(panels).toHaveLength(0);
  });
});
