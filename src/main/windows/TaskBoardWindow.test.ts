import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./createAppWindow', () => ({ createAppWindow: mocks.create }));

function windowStub(id: number) {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    on: vi.fn(),
    webContents: { id, isDestroyed: vi.fn(() => false), on: vi.fn() },
  };
}

describe('协作看板独立窗口', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.create.mockReset();
  });

  it('只建一个持久化的独立窗口，重开时恢复、显示并聚焦，不重建主工作区', async () => {
    const win = windowStub(30);
    mocks.create.mockReturnValue(win);
    const { openTaskBoardWindow } = await import('./TaskBoardWindow');
    expect(openTaskBoardWindow()).toBe(win);
    expect(mocks.create).toHaveBeenCalledWith({
      entry: 'taskboard',
      width: 1320,
      height: 850,
      minWidth: 900,
      minHeight: 600,
      stateFile: 'taskboard-window-state.json',
    });
    win.isMinimized.mockReturnValue(true);
    expect(openTaskBoardWindow()).toBe(win);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.show).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it('身份只认活着的看板 renderer，关窗后清理单例', async () => {
    const win = windowStub(30);
    mocks.create.mockReturnValue(win);
    const { openTaskBoardWindow, isTaskBoardWebContents } = await import('./TaskBoardWindow');
    expect(isTaskBoardWebContents(30)).toBe(false);
    openTaskBoardWindow();
    expect(isTaskBoardWebContents(30)).toBe(true);
    expect(isTaskBoardWebContents(99)).toBe(false);
    win.webContents.isDestroyed.mockReturnValue(true);
    expect(isTaskBoardWebContents(30)).toBe(false);
    win.webContents.isDestroyed.mockReturnValue(false);
    win.isDestroyed.mockReturnValue(true);
    expect(isTaskBoardWebContents(30)).toBe(false);
    win.isDestroyed.mockReturnValue(false);
    const closed = win.on.mock.calls.find(([event]) => event === 'closed')?.[1];
    expect(closed).toBeTypeOf('function');
    closed?.();
    expect(isTaskBoardWebContents(30)).toBe(false);
    const replacement = windowStub(31);
    mocks.create.mockReturnValue(replacement);
    expect(openTaskBoardWindow()).toBe(replacement);
  });

  it.each(['will-navigate', 'will-redirect'])(
    '不让外部页面继承看板 IPC 权限：%s',
    async (event) => {
      const win = windowStub(30);
      mocks.create.mockReturnValue(win);
      const { openTaskBoardWindow } = await import('./TaskBoardWindow');
      openTaskBoardWindow();
      const block = win.webContents.on.mock.calls.find(([name]) => name === event)?.[1];
      const preventDefault = vi.fn();
      block?.({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    }
  );
});
