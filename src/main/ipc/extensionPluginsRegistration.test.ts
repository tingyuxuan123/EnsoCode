import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { registerExtensionPluginHandlers } from './extensionPlugins';

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  handle: vi.fn(),
  all: vi.fn(),
}));
vi.mock('electron', async (original) => ({
  ...(await original<object>()),
  app: { on: mocks.on, isPackaged: true },
  ipcMain: { handle: mocks.handle },
  webContents: { getAllWebContents: mocks.all },
}));
vi.mock('../windows/createAppWindow', () => ({
  getWindowWebContents: vi.fn(),
  sendToAllWindows: vi.fn(),
}));
vi.mock('../windows/MainWindow', () => ({ getMainWindow: () => null }));
vi.mock('../windows/SettingsWindow', () => ({ getSettingsWindow: () => null }));

it('注册 IPC 时立刻挂载已有和新 webContents 的销毁监听，不等待首次调用', () => {
  const existing = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false });
  const later = Object.assign(new EventEmitter(), { id: 8, isDestroyed: () => false });
  mocks.all.mockReturnValue([existing]);
  registerExtensionPluginHandlers();
  expect(mocks.all).toHaveBeenCalledOnce();
  expect(existing.listenerCount('destroyed')).toBe(1);
  const created = mocks.on.mock.calls.find(([name]) => name === 'web-contents-created')?.[1];
  expect(created).toBeTypeOf('function');
  created({}, later);
  expect(later.listenerCount('destroyed')).toBe(1);
});
