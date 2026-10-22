import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => void>(),
  send: vi.fn(),
  quit: vi.fn(),
  check: vi.fn(async () => undefined),
  window: { on: vi.fn(), once: vi.fn() },
}));

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      on: (event: string, listener: (...args: any[]) => void) =>
        mocks.listeners.set(event, listener),
      quitAndInstall: mocks.quit,
      checkForUpdates: mocks.check,
    },
  },
}));
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [mocks.window] },
}));
vi.mock('../../windows/createAppWindow', () => ({ sendToWindow: mocks.send }));
vi.mock('../../ipc/settings', () => ({
  flushSettings: vi.fn(),
  writeTrayReenterAfterUpdate: vi.fn(),
}));
vi.mock('./idleRestartSnapshot', () => ({ currentIdleRestartObservation: vi.fn() }));

const downloaded = () => mocks.listeners.get('update-downloaded')!({ version: '0.2.12' });

describe('AutoUpdater installation failure recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.clearAllMocks();
    mocks.quit.mockReset();
    mocks.listeners.clear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  async function setup() {
    const { autoUpdaterService: service } = await import('./AutoUpdater');
    service.init(mocks.window as never, false);
    return service;
  }

  it('下载后只忽略迟到检查状态，不能吞掉原生安装器的错误', async () => {
    const service = await setup();
    downloaded();
    mocks.listeners.get('checking-for-update')!();
    expect(mocks.send.mock.lastCall?.[2]).toMatchObject({ status: 'downloaded' });
    service.quitAndInstall();
    expect(service.isQuittingForUpdate()).toBe(true);
    mocks.listeners.get('error')!(new Error('Code signature does not satisfy requirement'));
    expect(mocks.send.mock.lastCall?.[2]).toEqual({
      status: 'error',
      error: 'Code signature does not satisfy requirement',
    });
    expect(service.isQuittingForUpdate()).toBe(false);
    await service.checkForUpdates();
    expect(mocks.check).toHaveBeenCalledOnce();
  });

  it('同步安装异常恢复退出标记并发错误状态，不留下永久重启按钮', async () => {
    const service = await setup();
    downloaded();
    mocks.quit.mockImplementationOnce(() => {
      throw new Error('Installer unavailable');
    });
    expect(() => service.quitAndInstall()).not.toThrow();
    expect(service.isQuittingForUpdate()).toBe(false);
    expect(mocks.send.mock.lastCall?.[2]).toEqual({
      status: 'error',
      error: 'Installer unavailable',
    });
    service.quitAndInstall();
    expect(mocks.quit).toHaveBeenCalledOnce();
  });

  it('下载前不启动安装；同一安装过程重复点击不会重复注册安装', async () => {
    const service = await setup();
    service.quitAndInstall();
    expect(mocks.quit).not.toHaveBeenCalled();
    downloaded();
    service.quitAndInstall();
    service.quitAndInstall();
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
});
