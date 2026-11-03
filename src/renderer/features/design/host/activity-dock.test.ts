import { beforeEach, expect, it, vi } from 'vitest';

const { side, sessions } = vi.hoisted(() => ({
  side: { ensureOpen: vi.fn(), setFullscreen: vi.fn(), forgetConversation: vi.fn() },
  sessions: { activeId: 's', conversations: { s: { projectId: 'p' }, hidden: { projectId: 'p' } } },
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: { getState: () => sessions } }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: { getState: () => ({ projects: [] }) } }));
vi.mock('@/stores/sidePanel', () => ({ useSidePanelStore: { getState: () => side } }));
vi.mock('@/lib/terminalRegistry', () => ({ releaseTerminal() {} }));

import type { DockviewApi } from 'dockview-react';
import {
  addSidePanelDesign,
  bindSidePanelDock,
  setSidePanelDesignVisible,
} from '@/lib/sidePanelDock';

beforeEach(() => vi.clearAllMocks());
it('defers and deduplicates a design reveal until layout restoration finishes; hiding cancels it', async () => {
  const addPanel = vi.fn();
  const dock = { addPanel, getPanel: () => undefined } as unknown as DockviewApi;
  addSidePanelDesign({ conversationId: 's', width: 'max' });
  addSidePanelDesign({ conversationId: 's', width: 'max' });
  expect(addPanel).not.toHaveBeenCalled();
  bindSidePanelDock('s', dock);
  expect(addPanel).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(addPanel).toHaveBeenCalledTimes(1);
  expect(addPanel.mock.calls[0][0]).toMatchObject({
    id: 'design',
    component: 'design',
    params: { conversationId: 's' },
  });
  expect(side.setFullscreen).toHaveBeenCalledWith(true);
  setSidePanelDesignVisible('s', false);
});

it('availability does not open a dock; hiding cancels a queued reveal', async () => {
  const addPanel = vi.fn();
  setSidePanelDesignVisible('hidden', true);
  expect(side.ensureOpen).not.toHaveBeenCalled();
  addSidePanelDesign({ conversationId: 'hidden' });
  setSidePanelDesignVisible('hidden', false);
  bindSidePanelDock('hidden', { addPanel, getPanel: () => undefined } as unknown as DockviewApi);
  await Promise.resolve();
  expect(addPanel).not.toHaveBeenCalled();
});
