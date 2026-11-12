import { IPC_CHANNELS } from '@shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  win: {
    isDestroyed: () => false,
    setTitleBarOverlay: vi.fn(),
    setBackgroundColor: vi.fn(),
  },
  contents: { id: 2 },
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => mocks.win) },
  ipcMain: { handle: vi.fn() },
  dialog: {},
  Menu: {},
}));
vi.mock('../windows/createAppWindow', () => ({
  getWindowWebContents: () => mocks.contents,
  sendToWindow: vi.fn(),
  TRAFFIC_LIGHT_POSITION: { x: 16, y: 16 },
}));
vi.mock('../services/agentHost', () => ({ agentTypeRegistrySnapshot: vi.fn() }));
vi.mock('../windows/MainWindow', () => ({ focusMainWindow: vi.fn() }));
vi.mock('../windows/SettingsWindow', () => ({ openSettingsWindow: vi.fn() }));
vi.mock('./searchAnything', () => ({ parseOpenSettingsRequest: vi.fn() }));

import { ipcMain } from 'electron';
import { registerWindowHandlers } from './window';

describe('Windows 标题栏背景', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    registerWindowHandlers();
  });
  afterEach(() => vi.restoreAllMocks());

  function update(senderId: number, appearance: unknown) {
    const handler = vi
      .mocked(ipcMain.handle)
      .mock.calls.find(
        ([channel]) => channel === IPC_CHANNELS.WINDOW_SET_TITLE_BAR_APPEARANCE
      )?.[1];
    if (!handler) throw new Error('Missing title bar handler');
    return handler({ sender: { id: senderId } } as Electron.IpcMainInvokeEvent, appearance);
  }

  it.each(['#eaf1f5', '#20262c', '#f3f6f4'])(
    '主题 %s 更新后按钮底板仍透明，窗口本身仍是不透明主题底色',
    (color) => {
      expect(update(2, { color, symbolColor: '#ffffff' })).toEqual({ ok: true });
      expect(mocks.win.setTitleBarOverlay).toHaveBeenCalledExactlyOnceWith({
        color: '#00000000',
        symbolColor: '#ffffff',
      });
      expect(mocks.win.setBackgroundColor).toHaveBeenCalledExactlyOnceWith(color);
    }
  );

  it('拒绝空壳或其它 renderer 改写按钮外观', () => {
    expect(update(1, { color: '#20262c', symbolColor: '#ffffff' })).toMatchObject({ ok: false });
    expect(mocks.win.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(mocks.win.setBackgroundColor).not.toHaveBeenCalled();
  });

  it('拒绝借主题同步把整个窗口改透明', () => {
    expect(update(2, { color: '#00000000', symbolColor: '#ffffff' })).toMatchObject({
      ok: false,
    });
    expect(mocks.win.setTitleBarOverlay).not.toHaveBeenCalled();
    expect(mocks.win.setBackgroundColor).not.toHaveBeenCalled();
  });
});
