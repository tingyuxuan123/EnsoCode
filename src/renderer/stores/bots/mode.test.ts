import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  chats: [{ id: 'g', kind: 'group', activeThreadId: 't' }],
  delegations: [],
  openThread: vi.fn(),
  setView: vi.fn(),
  activeNodeId: 'local',
  switchNode: vi.fn(),
}));
vi.mock('@/stores/bots', () => ({ useBotsStore: { getState: () => state } }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ botModeEnabled: true }) },
}));
vi.mock('@/stores/remoteNodes', () => ({
  useRemoteNodesStore: {
    getState: () => ({ activeNodeId: state.activeNodeId, switchNode: state.switchNode }),
  },
}));
afterEach(() => vi.unstubAllGlobals());

it('超级助理模式独立持久化，不依赖 Bot 开关', async () => {
  vi.stubGlobal('localStorage', { getItem: () => 'assistant', setItem: vi.fn() });
  vi.resetModules();
  const { useAppModeStore } = await import('./mode');
  expect(useAppModeStore.getState().mode).toBe('assistant');
  useAppModeStore.getState().setMode('code');
  expect(useAppModeStore.getState().mode).toBe('code');
});

it('主话题通知即使当前看子话题也打开主话题，不沿用侧栏最近选择', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  const { openBotNotification } = await import('./mode');
  await openBotNotification({ kind: 'open', chatId: 'g' });
  expect(state.openThread).toHaveBeenCalledWith('g', 'g');
  expect(state.setView).toHaveBeenCalledWith({ kind: 'chat', chatId: 'g' });
});

it('Code 会话通知从远程节点 / Bot 模式切回本机 Code 视图', async () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => 'bot', setItem });
  vi.resetModules();
  const { showLocalCodeView, useAppModeStore } = await import('./mode');
  state.activeNodeId = 'remote-1';
  expect(useAppModeStore.getState().mode).toBe('bot');
  showLocalCodeView();
  expect(state.switchNode).toHaveBeenCalledWith('local');
  expect(useAppModeStore.getState().mode).toBe('code');
  state.activeNodeId = 'local';
});
