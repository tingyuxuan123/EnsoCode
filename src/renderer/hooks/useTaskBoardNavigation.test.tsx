// @vitest-environment happy-dom

import type { BotChat } from '@shared/types/bot';
import type { TaskBoardNavigation } from '@shared/types/taskBoard';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/stores/settings';
import { useTaskBoardNavigation } from './useTaskBoardNavigation';

const CHAT = 'group-one';
const OTHER = 'group-two';
const mocks = vi.hoisted(() => ({
  bots: {
    chats: [] as Pick<BotChat, 'id' | 'kind'>[],
    taskFocus: null as { nonce: number } | null,
    panelOpen: false,
    openTask: vi.fn(),
    setView: vi.fn(),
    clearTaskFocus: vi.fn(),
    setPanelTab: vi.fn(),
    togglePanel: vi.fn(),
    refreshChats: vi.fn(),
  },
  switchNode: vi.fn(),
  setMode: vi.fn(),
  closeWorkspace: vi.fn(),
  consume: vi.fn(),
  listeners: new Set<() => void>(),
}));

vi.mock('@/stores/settings', async () => {
  const { create } = await import('zustand');
  return { useSettingsStore: create(() => ({ botModeEnabled: false })) };
});
vi.mock('@/stores/bots', () => ({ useBotsStore: { getState: () => mocks.bots } }));
vi.mock('@/stores/bots/mode', () => ({
  useAppModeStore: { getState: () => ({ setMode: mocks.setMode }) },
}));
vi.mock('@/stores/remoteNodes', () => ({
  useRemoteNodesStore: { getState: () => ({ switchNode: mocks.switchNode }) },
}));

let root: Root | undefined;
function Consumer() {
  useTaskBoardNavigation(mocks.closeWorkspace);
  return null;
}
async function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <StrictMode>
        <Consumer />
      </StrictMode>
    )
  );
}
async function deliver(target: TaskBoardNavigation) {
  mocks.consume.mockResolvedValueOnce(target);
  await act(async () => {
    for (const listener of mocks.listeners) listener();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.bots.chats = [];
  mocks.bots.taskFocus = null;
  mocks.bots.panelOpen = false;
  mocks.bots.refreshChats.mockResolvedValue(undefined);
  mocks.consume.mockReset().mockResolvedValue(null);
  useSettingsStore.setState({ botModeEnabled: false });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', {
    taskBoard: {
      consumeNavigation: mocks.consume,
      onNavigate: (callback: () => void) => {
        mocks.listeners.add(callback);
        return () => mocks.listeners.delete(callback);
      },
    },
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('主工作区看板导航', () => {
  it('冷启动与 StrictMode 不丢请求：设置水合后补拉群，切本机 Bot 并打开指定任务', async () => {
    mocks.consume.mockResolvedValueOnce({ kind: 'task', chatId: CHAT, taskId: 'task' });
    mocks.bots.refreshChats.mockImplementationOnce(async () => {
      mocks.bots.chats = [{ id: CHAT, kind: 'group' }];
    });
    await mount();
    expect(mocks.listeners.size).toBe(1);
    expect(mocks.bots.openTask).not.toHaveBeenCalled();
    await act(async () => useSettingsStore.setState({ botModeEnabled: true }));
    expect(mocks.bots.refreshChats).toHaveBeenCalledOnce();
    expect(mocks.switchNode).toHaveBeenCalledWith('local');
    expect(mocks.setMode).toHaveBeenCalledWith('bot');
    expect(mocks.closeWorkspace).toHaveBeenCalledOnce();
    expect(mocks.bots.openTask).toHaveBeenCalledExactlyOnceWith(CHAT, 'task');
  });

  it('Code / 远程页保持订阅，实时群导航清旧任务焦点并打开右侧看板', async () => {
    useSettingsStore.setState({ botModeEnabled: true });
    mocks.bots.chats = [{ id: CHAT, kind: 'group' }];
    mocks.bots.taskFocus = { nonce: 9 };
    await mount();
    await deliver({ kind: 'group', chatId: CHAT });
    expect(mocks.bots.clearTaskFocus).toHaveBeenCalledWith(9);
    expect(mocks.bots.setView).toHaveBeenCalledWith({ kind: 'chat', chatId: CHAT });
    expect(mocks.bots.setPanelTab).toHaveBeenCalledWith('board');
    expect(mocks.bots.togglePanel).toHaveBeenCalledOnce();
    expect(mocks.bots.openTask).not.toHaveBeenCalled();
    act(() => root?.unmount());
    root = undefined;
    expect(mocks.listeners.size).toBe(0);
  });

  it('补拉群目录期间的新请求胜出，旧异步目标不得抢回视图', async () => {
    useSettingsStore.setState({ botModeEnabled: true });
    let release: (() => void) | undefined;
    mocks.bots.refreshChats.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await mount();
    await deliver({ kind: 'task', chatId: CHAT, taskId: 'old-task' });
    mocks.bots.chats = [{ id: OTHER, kind: 'group' }];
    await deliver({ kind: 'task', chatId: OTHER, taskId: 'new-task' });
    await act(async () => {
      mocks.bots.chats.push({ id: CHAT, kind: 'group' });
      release?.();
    });
    expect(mocks.bots.openTask).toHaveBeenCalledExactlyOnceWith(OTHER, 'new-task');
  });
});
