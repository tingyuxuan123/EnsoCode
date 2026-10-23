import type { DockviewApi } from 'dockview-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSidePanelSubagent,
  addSidePanelSubagentDirectory,
  bindSidePanelDock,
  disposeConversationResources,
} from '@/lib/sidePanelDock';

const mocks = vi.hoisted(() => ({
  sessions: { conversations: {} as Record<string, unknown>, activeId: 'unrelated' },
  ensureOpen: vi.fn(),
  forgetConversation: vi.fn(),
  releaseTerminal: vi.fn(),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: { getState: () => mocks.sessions } }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: { getState: () => ({}) } }));
vi.mock('@/stores/sidePanel', () => ({ useSidePanelStore: { getState: () => mocks } }));
vi.mock('@/lib/terminalRegistry', () => ({ releaseTerminal: mocks.releaseTerminal }));

function dock() {
  const panels: {
    id: string;
    component: string;
    focus: ReturnType<typeof vi.fn>;
    api: { close: ReturnType<typeof vi.fn>; getParameters: () => unknown };
  }[] = [];
  const close = vi.fn();
  const addPanel = vi.fn((options: { id: string; component: string; params?: unknown }) => {
    panels.push({
      ...options,
      focus: vi.fn(),
      api: { close, getParameters: () => options.params },
    });
  });
  return { panels, close, addPanel, getPanel: (id: string) => panels.find((p) => p.id === id) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessions.conversations = {
    parent: {},
    owner: {},
    btw: { btwParentId: 'owner' },
    unrelated: {},
    child: {
      parentId: 'parent',
      child: {
        parentId: 'parent',
        agentInstanceId: 'agent',
        agentInstanceName: 'Scout',
        dispatchOrigin: 'agent-tool',
      },
    },
    btwChild: {
      parentId: 'btw',
      child: {
        parentId: 'btw',
        agentInstanceId: 'btw-agent',
        agentInstanceName: 'Scout',
        dispatchOrigin: 'agent-tool',
      },
    },
  };
  vi.stubGlobal('window', {
    electronAPI: { terminal: { dispose: vi.fn() }, browser: { closeSession: vi.fn() } },
  });
});
afterEach(() => {
  for (const id of ['parent', 'owner', 'unrelated']) disposeConversationResources(id);
  vi.unstubAllGlobals();
});

describe('observer dock routing', () => {
  it('opens in parent owner dock, deduplicates child tabs and never changes active selection', () => {
    const parent = dock();
    const unrelated = dock();
    bindSidePanelDock('parent', parent as unknown as DockviewApi);
    bindSidePanelDock('unrelated', unrelated as unknown as DockviewApi);
    const options = { parentConversationId: 'parent', childConversationId: 'child' };
    addSidePanelSubagent(options);
    addSidePanelSubagent(options);
    expect(parent.addPanel).toHaveBeenCalledTimes(1);
    expect(parent.panels[0].focus).toHaveBeenCalledOnce();
    expect(unrelated.addPanel).not.toHaveBeenCalled();
    expect(mocks.ensureOpen).toHaveBeenCalledWith('parent');
    expect(mocks.sessions.activeId).toBe('unrelated');
  });

  it('keeps pending requests until owner mounts, deduplicating detail and directory', async () => {
    addSidePanelSubagent({ parentConversationId: 'btw', childConversationId: 'btwChild' });
    addSidePanelSubagentDirectory('btw');
    addSidePanelSubagentDirectory('btw');
    const owner = dock();
    bindSidePanelDock('owner', owner as unknown as DockviewApi);
    await Promise.resolve();
    expect(owner.panels.map((p) => p.component)).toEqual([
      'subagent-session',
      'subagent-directory',
    ]);
    expect(mocks.ensureOpen).toHaveBeenCalledWith('owner');
  });

  it('rejects cross-parent and ambiguous targets and revalidates pending targets at mount', async () => {
    addSidePanelSubagent({ parentConversationId: 'owner', childConversationId: 'child' });
    addSidePanelSubagent({ parentConversationId: 'parent', childConversationId: 'child' });
    delete mocks.sessions.conversations.child;
    const parent = dock();
    bindSidePanelDock('parent', parent as unknown as DockviewApi);
    await Promise.resolve();
    expect(parent.addPanel).not.toHaveBeenCalled();
  });

  it('disposing an owner never disposes observer tabs as terminals', () => {
    const parent = dock();
    bindSidePanelDock('parent', parent as unknown as DockviewApi);
    addSidePanelSubagent({ parentConversationId: 'parent', childConversationId: 'child' });
    addSidePanelSubagentDirectory('parent');
    disposeConversationResources('parent');
    expect(mocks.releaseTerminal).not.toHaveBeenCalled();
    expect(window.electronAPI.terminal.dispose).not.toHaveBeenCalled();
  });

  it('removes observers of a deleted btw parent from its still-mounted owner dock', () => {
    const owner = dock();
    bindSidePanelDock('owner', owner as unknown as DockviewApi);
    addSidePanelSubagent({ parentConversationId: 'btw', childConversationId: 'btwChild' });
    addSidePanelSubagentDirectory('btw');
    disposeConversationResources('btw');
    expect(owner.close).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.terminal.dispose).not.toHaveBeenCalled();
  });
});
