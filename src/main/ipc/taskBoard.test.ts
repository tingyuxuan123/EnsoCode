import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTaskBoardHandlers } from './taskBoard';

const CHAT = '11111111-1111-4111-8111-111111111111';
const THREAD = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: { sender: { id: number } }, raw?: unknown) => unknown>(),
  open: vi.fn(),
  focusMain: vi.fn(),
  main: { shell: { send: vi.fn() }, workbench: { send: vi.fn() } },
  chats: { get: vi.fn() },
  tasks: { list: vi.fn() },
  enabled: true,
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: { sender: { id: number } }, raw?: unknown) => unknown
    ) => mocks.handlers.set(channel, handler),
  },
}));
vi.mock('../windows/TaskBoardWindow', () => ({
  openTaskBoardWindow: mocks.open,
  isTaskBoardWebContents: (id: number) => id === 3,
}));
vi.mock('../windows/MainWindow', () => ({
  isMainWebContents: (id: number) => id === 2,
  focusMainWindow: mocks.focusMain,
}));
vi.mock('../windows/createAppWindow', () => ({
  sendToWindow: (win: typeof mocks.main, channel: string) => win.workbench.send(channel),
}));
vi.mock('./bots', () => ({
  getBotServices: () => (mocks.enabled ? { chats: mocks.chats, tasks: mocks.tasks } : null),
}));

const OPEN = 'taskboard:open';
const FOCUS = 'taskboard:focus-main';
const NAVIGATE = 'taskboard:navigate';
const AVAILABLE = 'taskboard:navigation';
const CONSUME = 'taskboard:navigation-consume';
const invoke = (channel: string, id: number, raw?: unknown) =>
  mocks.handlers.get(channel)?.({ sender: { id } }, raw);

describe('协作看板窗口 IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.enabled = true;
    mocks.focusMain.mockReturnValue(mocks.main);
    mocks.chats.get.mockImplementation((id: string) => {
      if (id === CHAT) return { id, kind: 'group' };
      if (id === THREAD) return { id, kind: 'group', parentId: CHAT };
      if (id === OTHER) return { id, kind: 'direct' };
      return undefined;
    });
    mocks.tasks.list.mockReturnValue([{ id: TASK }]);
    registerTaskBoardHandlers();
  });

  it('主工作区打开看板，看板返回时聚焦主窗口', () => {
    expect(invoke(OPEN, 2)).toEqual({ ok: true });
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(invoke(FOCUS, 3)).toEqual({ ok: true });
    expect(mocks.focusMain).toHaveBeenCalledOnce();
  });

  it.each([1, 4])('shell/未授权网页 %s 不得打开窗口、导航或消费请求', (id) => {
    for (const channel of [OPEN, FOCUS, NAVIGATE])
      expect(invoke(channel, id, { kind: 'group', chatId: CHAT })).toEqual({
        ok: false,
        error: 'forbidden',
      });
    expect(invoke(CONSUME, id)).toBeNull();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.focusMain).not.toHaveBeenCalled();
    expect(mocks.chats.get).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { kind: 'group', chatId: '../escape' },
    { kind: 'group', chatId: 42 },
    { kind: 'group', chatId: TASK },
    { kind: 'group', chatId: OTHER },
    { kind: 'task', chatId: CHAT },
    { kind: 'task', chatId: CHAT, taskId: '../escape' },
    { kind: 'task', chatId: CHAT, taskId: OTHER },
    { kind: 'conversation', chatId: CHAT, conversationId: TASK },
    { kind: 'group', chatId: CHAT, sessionFile: '/private/secret' },
  ])('非法或不存在的导航目标不唤起主窗口：%j', (raw) => {
    expect(invoke(NAVIGATE, 3, raw)).toEqual({ ok: false, error: 'invalid' });
    expect(mocks.focusMain).not.toHaveBeenCalled();
    expect(invoke(CONSUME, 2)).toBeNull();
  });

  it('任务归属在 Main 校验，话题落到根群；推送走 workbench 并保留冷启动请求', () => {
    expect(invoke(NAVIGATE, 3, { kind: 'task', chatId: THREAD, taskId: TASK })).toEqual({
      ok: true,
    });
    expect(mocks.tasks.list).toHaveBeenCalledWith(CHAT);
    expect(mocks.focusMain).toHaveBeenCalledOnce();
    expect(mocks.main.shell.send).not.toHaveBeenCalled();
    expect(mocks.main.workbench.send).toHaveBeenCalledWith(AVAILABLE);
    expect(invoke(CONSUME, 3)).toBeNull();
    expect(invoke(CONSUME, 2)).toEqual({ kind: 'task', chatId: CHAT, taskId: TASK });
    expect(invoke(CONSUME, 2)).toBeNull();
  });

  it('唤起后 listener 未就绪也不会丢失群看板请求；新请求替换过期目标', () => {
    invoke(NAVIGATE, 3, { kind: 'task', chatId: CHAT, taskId: TASK });
    invoke(NAVIGATE, 3, { kind: 'group', chatId: CHAT });
    expect(invoke(CONSUME, 2)).toEqual({ kind: 'group', chatId: CHAT });
  });

  it('功能关闭不创建服务或导航；排队期间删掉任务也不能消费旧目标', () => {
    invoke(NAVIGATE, 3, { kind: 'task', chatId: CHAT, taskId: TASK });
    mocks.tasks.list.mockReturnValue([]);
    expect(invoke(CONSUME, 2)).toBeNull();
    mocks.focusMain.mockClear();
    mocks.enabled = false;
    expect(invoke(NAVIGATE, 3, { kind: 'group', chatId: CHAT })).toEqual({
      ok: false,
      error: 'disabled',
    });
    expect(mocks.focusMain).not.toHaveBeenCalled();
  });

  it('任务读取异常不会跨 IPC 抛出，且不唤起主窗口', () => {
    mocks.tasks.list.mockImplementationOnce(() => {
      throw new Error('read failed');
    });
    expect(invoke(NAVIGATE, 3, { kind: 'task', chatId: CHAT, taskId: TASK })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(mocks.focusMain).not.toHaveBeenCalled();
    expect(invoke(CONSUME, 2)).toBeNull();
  });

  it('消费时任务读取异常丢弃无法验证的目标', () => {
    invoke(NAVIGATE, 3, { kind: 'task', chatId: CHAT, taskId: TASK });
    mocks.tasks.list.mockImplementationOnce(() => {
      throw new Error('read failed');
    });
    expect(invoke(CONSUME, 2)).toBeNull();
    expect(invoke(CONSUME, 2)).toBeNull();
  });

  it('主窗口唤起失败时清理未送达的目标', () => {
    mocks.focusMain.mockImplementationOnce(() => {
      throw new Error('focus failed');
    });
    expect(invoke(NAVIGATE, 3, { kind: 'group', chatId: CHAT })).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(invoke(CONSUME, 2)).toBeNull();
  });
});
