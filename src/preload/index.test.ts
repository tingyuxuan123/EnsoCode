import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../shared/types/ipc';
import type { ElectronAPI } from './index';
import './index';

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
  webUtils: { getPathForFile: vi.fn() },
}));

const electronAPI = mocks.exposeInMainWorld.mock.calls[0]?.[1] as ElectronAPI;
const { taskBoard } = electronAPI;

it('exposes the device host port, never a raw process or file API', async () => {
  const api = electronAPI.devices;
  expect(typeof api.request).toBe('function');
  expect(typeof api.onEvent).toBe('function');
  expect(typeof api.onConnection).toBe('function');
  expect('perform' in api).toBe(false);
});

it('round-trips device access decisions on dedicated channels without translating their scope', async () => {
  const api = electronAPI.devices;
  const entries = [
    {
      kind: 'device_access',
      id: 'entry',
      sessionId: 's',
      deviceId: 'android:emulator-5554',
      deviceName: 'Android emulator',
      expiresAt: 120_000,
      decision: 'session',
    },
  ];
  mocks.invoke.mockClear().mockResolvedValueOnce(entries);
  expect(await api.listAccess('s')).toBe(entries);
  await api.answerAccess('s', 'entry', 'session');
  await api.answerAccess('s', 'entry', 'always');
  await api.revokeAccess('s', 'android:emulator-5554');
  await api.allowedAccess();
  await api.forgetAccess('android:emulator-5554');
  expect(mocks.invoke.mock.calls).toEqual([
    [IPC_CHANNELS.DEVICE_ACCESS_LIST, 's'],
    [IPC_CHANNELS.DEVICE_ACCESS_ANSWER, 's', 'entry', 'session'],
    [IPC_CHANNELS.DEVICE_ACCESS_ANSWER, 's', 'entry', 'always'],
    [IPC_CHANNELS.DEVICE_ACCESS_REVOKE, 's', 'android:emulator-5554'],
    [IPC_CHANNELS.DEVICE_ACCESS_ALLOWED],
    [IPC_CHANNELS.DEVICE_ACCESS_FORGET, 'android:emulator-5554'],
  ]);
  const callback = vi.fn();
  const off = api.onAccessChanged(callback);
  const listener = mocks.on.mock.lastCall?.[1];
  listener({}, entries[0]);
  expect(callback.mock.calls).toEqual([[entries[0]]]);
  off();
  expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.DEVICE_ACCESS_CHANGED, listener);
});

const event = {
  dispatchId: '66666666-6666-4666-8666-666666666666',
  child: {
    sessionId: 'conversation-1::cw-33333333',
    generation: '22222222-2222-4222-8222-222222222222',
    parent: {
      sessionId: 'conversation-1',
      generation: '11111111-1111-4111-8111-111111111111',
    },
    instanceId: '33333333-3333-4333-8333-333333333333',
    instanceName: 'Enso 3333',
    typeKey: 'agent:enso',
    profileId: 'enso-locked-v1',
  },
  mainSeq: 1,
  phase: 'running',
} as const;

describe('preload agentDispatch.onEvent', () => {
  beforeEach(() => {
    mocks.on.mockClear();
    mocks.removeListener.mockClear();
  });

  it('独立订阅 Main dispatch event，回调前拒绝非 strict payload', () => {
    const callback = vi.fn();
    const unsubscribe = electronAPI.agentDispatch.onEvent(callback);
    const registration = mocks.on.mock.calls.find(
      ([channel]) => channel === IPC_CHANNELS.AGENT_DISPATCH_EVENT
    );
    expect(registration).toBeDefined();
    const listener = registration?.[1] as (ipcEvent: unknown, payload: unknown) => void;

    listener({}, event);
    expect(callback).toHaveBeenCalledWith(event);

    listener({}, { ...event, mainSeq: 2, workerSeq: 99 });
    listener({}, { ...event, child: { ...event.child, generation: 'stale' } });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.AGENT_DISPATCH_EVENT, listener);
  });
});

describe('preload taskBoard', () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
    mocks.on.mockClear();
    mocks.removeListener.mockClear();
  });

  it('仅暴露 typed 窗口 API，导航只传群 / 任务标识', () => {
    void taskBoard.open();
    void taskBoard.focusMain();
    const target = { kind: 'task', chatId: 'group-id', taskId: 'task-id' } as const;
    void taskBoard.navigate(target);
    void taskBoard.consumeNavigation();
    expect(mocks.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.TASK_BOARD_OPEN],
      [IPC_CHANNELS.TASK_BOARD_FOCUS_MAIN],
      [IPC_CHANNELS.TASK_BOARD_NAVIGATE, target],
      [IPC_CHANNELS.TASK_BOARD_NAVIGATION_CONSUME],
    ]);
  });

  it('导航通知可取消订阅，不把 Electron event 暴露给 renderer', () => {
    const callback = vi.fn();
    const off = taskBoard.onNavigate(callback);
    const listener = mocks.on.mock.calls[0]?.[1] as (event: unknown) => void;
    listener({ sender: 'internal' });
    expect(callback).toHaveBeenCalledExactlyOnceWith();
    off();
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.TASK_BOARD_NAVIGATION, listener);
  });
});

it('扩展页导航只消费 Main 校验后的待处理深链，通知可清理且不泄露 IPC event', () => {
  mocks.invoke.mockClear();
  mocks.on.mockClear();
  mocks.removeListener.mockClear();
  void electronAPI.window.consumeExtensionsDeepLink();
  expect(mocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.EXTENSIONS_DEEP_LINK_CONSUME);
  const callback = vi.fn();
  const off = electronAPI.window.onExtensionsDeepLink(callback);
  const listener = mocks.on.mock.calls[0]?.[1] as (event: unknown) => void;
  listener({ sender: 'private' });
  expect(callback).toHaveBeenCalledExactlyOnceWith();
  off();
  expect(mocks.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.EXTENSIONS_DEEP_LINK, listener);
});
