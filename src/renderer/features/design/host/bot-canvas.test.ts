import { beforeEach, expect, it, vi } from 'vitest';
import { isViewedBotDesignChat, revealBotDesign, useBotDesignCanvas } from './bot-canvas';

const state = vi.hoisted(() => ({
  botMode: true,
  designEnabled: true,
  panelOpen: false,
  view: { kind: 'chat', chatId: 'group' },
  chats: [
    { id: 'group', activeThreadId: 'topic' },
    { id: 'topic', parentId: 'group' },
  ],
  setPanelTab: vi.fn(),
  togglePanel: vi.fn(),
}));
vi.mock('@/stores/bots', () => ({ useBotsStore: { getState: () => state } }));
vi.mock('@/stores/bots/mode', () => ({ isBotModeActive: () => state.botMode }));
vi.mock('@/stores/settings', () => ({ useSettingsStore: { getState: () => state } }));

beforeEach(() => {
  vi.clearAllMocks();
  useBotDesignCanvas.setState({ target: null });
  state.botMode = true;
  state.designEnabled = true;
});

it('reveals the active topic, not the root group or a sibling sharing its directory', () => {
  const target = { chatId: 'topic', sessionId: 's', cwd: '/group', path: '/group/draft.vetd' };
  revealBotDesign({ ...target, chatId: 'group' });
  expect(useBotDesignCanvas.getState().target).toBeNull();
  expect(state.togglePanel).not.toHaveBeenCalled();
  revealBotDesign(target);
  expect(useBotDesignCanvas.getState().target).toEqual(target);
  expect(state.togglePanel).toHaveBeenCalledOnce();
  expect(state.setPanelTab).toHaveBeenCalledWith('design');
});

it('does not accept opens when switching away from Bot or disabling design', () => {
  expect(isViewedBotDesignChat('topic')).toBe(true);
  state.botMode = false;
  expect(isViewedBotDesignChat('topic')).toBe(false);
  state.botMode = true;
  state.designEnabled = false;
  expect(isViewedBotDesignChat('topic')).toBe(false);
});
