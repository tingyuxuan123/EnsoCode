import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  listeners: new Map<string, (...args: any[]) => unknown>(),
  host: {
    setOverlayActive: vi.fn(),
    setViewport: vi.fn(() => 'state'),
    setDevToolsViewport: vi.fn(() => 'state'),
    resetOverlayReports: vi.fn(),
    state: vi.fn(() => 'empty'),
    onState: vi.fn(),
    onReveal: vi.fn(),
    onTabClosed: vi.fn(),
    onDesignMode: vi.fn(),
    onDownloadsChanged: vi.fn(),
    setDevice: vi.fn(async () => ({ tabId: 'tab', device: { enabled: false } })),
    setControl: vi.fn(async () => ({ tabId: 'tab', control: 'manual' })),
    history: vi.fn(async () => ({ items: [], total: 0 })),
    downloads: vi.fn(async () => ({ items: [], total: 0 })),
    stop: vi.fn(),
    userNavigate: vi.fn(async () => {}),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    closeTab: vi.fn(async () => {}),
    closeSession: vi.fn(async () => {}),
    clearData: vi.fn(async () => {}),
    restorePersistedTabs: vi.fn(),
    listSearchableTabs: vi.fn(() => []),
    setLocked: vi.fn(async () => {}),
    setDevTools: vi.fn(),
    setDesignMode: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
    on: (channel: string, handler: (...args: any[]) => unknown) => {
      mocks.listeners.set(channel, handler);
    },
  },
}));
vi.mock('../services/browserHost', () => ({ browserHost: mocks.host }));
vi.mock('../windows/createAppWindow', () => ({ sendToAllWindows: () => {} }));
vi.mock('../windows/MainWindow', () => ({ isMainWebContents: (id: number) => id === 1 }));
vi.mock('../windows/SettingsWindow', () => ({ isSettingsWebContents: (id: number) => id === 3 }));

import { IPC_CHANNELS } from '@shared/types';
import { registerBrowserHandlers } from './browser';

const sender = (id: number) => {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    id,
    on(name: string, fn: (...args: any[]) => void) {
      listeners[name] = [...(listeners[name] ?? []), fn];
    },
    emit(name: string, ...args: any[]) {
      for (const fn of listeners[name] ?? []) fn(...args);
    },
  };
};

beforeEach(() => {
  mocks.handlers.clear();
  mocks.listeners.clear();
  for (const fn of Object.values(mocks.host)) fn.mockClear();
  registerBrowserHandlers();
});

it('浮层 / 矩形上报只认主窗口 renderer', () => {
  const overlay = mocks.listeners.get(IPC_CHANNELS.BROWSER_SET_OVERLAY_ACTIVE)!;
  const setViewport = mocks.handlers.get(IPC_CHANNELS.BROWSER_SET_VIEWPORT)!;
  const setDevtoolsViewport = mocks.handlers.get(IPC_CHANNELS.BROWSER_SET_DEVTOOLS_VIEWPORT)!;

  overlay({ sender: sender(2) }, true);
  expect(mocks.host.setOverlayActive).not.toHaveBeenCalled();
  setViewport({ sender: sender(2) }, 'tab', 'conv', null, true);
  expect(mocks.host.setViewport).not.toHaveBeenCalled();
  setDevtoolsViewport({ sender: sender(2) }, 'tab', 'conv', null, true);
  expect(mocks.host.setDevToolsViewport).not.toHaveBeenCalled();

  overlay({ sender: sender(1) }, true);
  expect(mocks.host.setOverlayActive).toHaveBeenCalledWith(true);
  setViewport({ sender: sender(1) }, 'tab', 'conv', null, true);
  expect(mocks.host.setViewport).toHaveBeenCalledWith('tab', 'conv', null, true);
});

it('上报方崩溃 / 销毁 / 整页重载后清掉浮层闩锁', () => {
  const overlay = mocks.listeners.get(IPC_CHANNELS.BROWSER_SET_OVERLAY_ACTIVE)!;

  const crashed = sender(1);
  overlay({ sender: crashed }, true);
  crashed.emit('render-process-gone', {}, { reason: 'crashed' });
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(1);
  crashed.emit('destroyed');
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(2);

  const reloaded = sender(1);
  overlay({ sender: reloaded }, true);
  reloaded.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  reloaded.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(2);
  reloaded.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  expect(mocks.host.resetOverlayReports).toHaveBeenCalledTimes(3);
});

it('设备、接管、历史、下载入口拒绝非主窗口和坏参数', async () => {
  for (const channel of [
    IPC_CHANNELS.BROWSER_SET_DEVICE,
    IPC_CHANNELS.BROWSER_SET_CONTROL,
    IPC_CHANNELS.BROWSER_HISTORY,
    IPC_CHANNELS.BROWSER_DOWNLOADS,
    IPC_CHANNELS.BROWSER_STOP,
  ]) {
    const handler = mocks.handlers.get(channel);
    expect(handler).toBeTypeOf('function');
    expect(await handler!({ sender: sender(2) }, 'tab', 'conv', {})).toEqual({
      ok: false,
      error: 'Invalid request',
    });
    expect(await handler!({ sender: sender(1) }, '', null, {})).toEqual({
      ok: false,
      error: 'Invalid request',
    });
  }
  expect(mocks.host.setDevice).not.toHaveBeenCalled();
  expect(mocks.host.setControl).not.toHaveBeenCalled();
  expect(mocks.host.history).not.toHaveBeenCalled();
  expect(mocks.host.downloads).not.toHaveBeenCalled();
  expect(mocks.host.stop).not.toHaveBeenCalled();
});

it('旧浏览器动作也不能由设置窗口或未知 renderer 调用', async () => {
  const event = { sender: sender(2) };
  const calls: [string, unknown[]][] = [
    [IPC_CHANNELS.BROWSER_NAVIGATE, ['tab', 'conv', 'https://example.com']],
    [IPC_CHANNELS.BROWSER_GO_BACK, ['tab']],
    [IPC_CHANNELS.BROWSER_GO_FORWARD, ['tab']],
    [IPC_CHANNELS.BROWSER_RELOAD, ['tab']],
    [IPC_CHANNELS.BROWSER_CLOSE_TAB, ['tab']],
    [IPC_CHANNELS.BROWSER_CLOSE_SESSION, ['conv']],
    [IPC_CHANNELS.BROWSER_CLEAR_DATA, ['cookies']],
    [IPC_CHANNELS.BROWSER_RESTORE_TABS, []],
    [IPC_CHANNELS.BROWSER_LIST_SEARCHABLE_TABS, []],
    [IPC_CHANNELS.BROWSER_SET_LOCKED, ['conv', false]],
    [IPC_CHANNELS.BROWSER_SET_DEVTOOLS, ['tab', true]],
    [IPC_CHANNELS.BROWSER_SET_DESIGN_MODE, ['tab', true]],
  ];
  for (const [channel, args] of calls) {
    await mocks.handlers.get(channel)!(event, ...args);
  }
  for (const method of [
    mocks.host.userNavigate,
    mocks.host.goBack,
    mocks.host.goForward,
    mocks.host.reload,
    mocks.host.closeTab,
    mocks.host.closeSession,
    mocks.host.clearData,
    mocks.host.restorePersistedTabs,
    mocks.host.listSearchableTabs,
    mocks.host.setLocked,
    mocks.host.setDevTools,
    mocks.host.setDesignMode,
  ]) {
    expect(method).not.toHaveBeenCalled();
  }
});

it('设置窗仍可清理数据但不可控制网页或读取浏览记录', async () => {
  const event = { sender: sender(3) };
  await mocks.handlers.get(IPC_CHANNELS.BROWSER_CLEAR_DATA)!(event, 'cache');
  expect(mocks.host.clearData).toHaveBeenCalledWith('cache');
  await mocks.handlers.get(IPC_CHANNELS.BROWSER_NAVIGATE)!(
    event,
    'tab',
    'conv',
    'https://example.com'
  );
  expect(mocks.host.userNavigate).not.toHaveBeenCalled();
  await mocks.handlers.get(IPC_CHANNELS.BROWSER_HISTORY)!(event, 'conv', {});
  expect(mocks.host.history).not.toHaveBeenCalled();
});

it('新接口返回结构化结果并保留权威归属参数', async () => {
  const event = { sender: sender(1) };
  const device = { enabled: false };
  await expect(
    mocks.handlers.get(IPC_CHANNELS.BROWSER_SET_DEVICE)!(event, 'tab', 'conv', device)
  ).resolves.toEqual({ ok: true, result: { tabId: 'tab', device } });
  expect(mocks.host.setDevice).toHaveBeenCalledWith('tab', 'conv', device);
  await expect(
    mocks.handlers.get(IPC_CHANNELS.BROWSER_SET_CONTROL)!(event, 'tab', 'conv', 'manual')
  ).resolves.toEqual({ ok: true, result: { tabId: 'tab', control: 'manual' } });
  expect(mocks.host.setControl).toHaveBeenCalledWith('tab', 'conv', 'manual');
  expect(
    await mocks.handlers.get(IPC_CHANNELS.BROWSER_SET_CONTROL)!(event, 'tab', 'conv', 'steal')
  ).toEqual({ ok: false, error: 'Invalid request' });
  for (const [channel, method] of [
    [IPC_CHANNELS.BROWSER_HISTORY, mocks.host.history],
    [IPC_CHANNELS.BROWSER_DOWNLOADS, mocks.host.downloads],
  ] as const) {
    const query = { query: 'example', limit: 30 };
    await expect(mocks.handlers.get(channel)!(event, 'conv', query)).resolves.toEqual({
      ok: true,
      result: { items: [], total: 0 },
    });
    expect(method).toHaveBeenCalledWith('conv', query);
    method.mockRejectedValueOnce(new Error('Denied'));
    await expect(mocks.handlers.get(channel)!(event, 'conv', query)).resolves.toEqual({
      ok: false,
      error: 'Denied',
    });
  }
});
