import { IPC_CHANNELS } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCompactionHandlers } from './compaction';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock('electron', () => ({
  app: { getPath: () => '/isolated-user-data' },
  ipcMain: { handle: mocks.handle },
}));
vi.mock('../services/piCompactionSettings', () => ({
  readCompactReserveTokens: mocks.read,
  writeCompactReserveTokens: mocks.write,
}));
vi.mock('../windows/MainWindow', () => ({ isMainWebContents: (id: number) => id === 2 }));
vi.mock('../windows/SettingsWindow', () => ({ isSettingsWebContents: (id: number) => id === 3 }));

type Handler = (event: { sender: { id: number } }, value?: unknown) => Promise<unknown>;
function invoke(channel: string, senderId: number, value?: unknown) {
  const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1] as Handler;
  return handler({ sender: { id: senderId } }, value);
}

describe('压缩设置 IPC 来源边界', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue({ ok: true, value: null });
    mocks.write.mockResolvedValue({ ok: true });
    registerCompactionHandlers();
  });
  it.each([1, 4])('拒绝 shell 或无授权网页 %s，且不触盘', async (id) => {
    expect(await invoke(IPC_CHANNELS.COMPACTION_RESERVE_TOKENS_GET, id)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await invoke(IPC_CHANNELS.COMPACTION_RESERVE_TOKENS_SET, id, 20000)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([2, 3])('主界面和设置窗口 %s 只访问 Main 推导的路径', async (id) => {
    expect(await invoke(IPC_CHANNELS.COMPACTION_RESERVE_TOKENS_GET, id)).toEqual({
      ok: true,
      value: null,
    });
    expect(await invoke(IPC_CHANNELS.COMPACTION_RESERVE_TOKENS_SET, id, 20000)).toEqual({
      ok: true,
    });
    expect(mocks.read).toHaveBeenCalledWith('/isolated-user-data/agent/pi-agent/settings.json');
    expect(mocks.write).toHaveBeenCalledWith(
      '/isolated-user-data/agent/pi-agent/settings.json',
      20000
    );
  });
});
