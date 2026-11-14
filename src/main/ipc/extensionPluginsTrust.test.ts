import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IPC_CHANNELS } from '@shared/types/ipc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 通道级（真实注册的 ipcMain.handle）放行矩阵：协作看板与独立设计窗口要读插件调色板，
 * 只多 `list` + `asset`；管理的写通道、调用通道、配置与 draft 回复一律不扩权。
 * 同时守住外层闸门与 createExtensionPluginHandlers 内部闸门两层，防止只改一层失效。
 */
const ids = { main: 7, settings: 8, taskboard: 9, design: 10 };
const ORIGIN = 'http://localhost:5173';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  all: vi.fn(() => [] as unknown[]),
  service: vi.fn(),
  draft: vi.fn(),
}));

vi.mock('electron', async (original) => ({
  ...(await original<object>()),
  app: { on: mocks.on, isPackaged: false },
  ipcMain: { handle: mocks.handle },
  webContents: { getAllWebContents: mocks.all, fromId: () => null },
}));
vi.mock('../windows/createAppWindow', () => ({
  getWindowWebContents: (win: { webContents: { id: number } }) => win.webContents,
  sendToAllWindows: vi.fn(),
}));
vi.mock('../windows/MainWindow', () => ({
  getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 7 } }),
}));
vi.mock('../windows/SettingsWindow', () => ({
  getSettingsWindow: () => ({ isDestroyed: () => false, webContents: { id: 8 } }),
}));
vi.mock('../windows/TaskBoardWindow', () => ({
  isTaskBoardWebContents: (id: number) => id === 9,
}));
vi.mock('../windows/DesignWindow', () => ({
  designWindowSession: (id: number) => (id === 10 ? 'root-session' : null),
}));
vi.mock('../services/extensionPlugins', () => ({
  getExtensionPlugins: () => mocks.service(),
  getDraftBroker: () => mocks.draft(),
}));
vi.mock('./agent', () => ({ pluginProjectRoot: () => null, pluginSessionGeneration: () => null }));

type Handler = (event: unknown, ...args: unknown[]) => Promise<Record<string, unknown>>;

async function registered(): Promise<(channel: string) => Handler> {
  mocks.handle.mockClear();
  vi.resetModules();
  const { registerExtensionPluginHandlers } = await import('./extensionPlugins');
  registerExtensionPluginHandlers();
  const handlers = new Map<string, Handler>(
    mocks.handle.mock.calls.map(([channel, handler]) => [channel as string, handler as Handler])
  );
  return (channel) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`channel not registered: ${channel}`);
    return handler;
  };
}

const frame = (url: string) => ({ url });
/** 顶层 frame：senderFrame 与 sender.mainFrame 是同一个对象。 */
const sender = (id: number, url: string) => {
  const mainFrame = frame(url);
  return { sender: { id, isDestroyed: () => false, mainFrame }, senderFrame: mainFrame };
};
const subframeSender = (id: number, url: string) => {
  const mainFrame = frame(url);
  return { sender: { id, isDestroyed: () => false, mainFrame }, senderFrame: frame(url) };
};

let themeFile = '';

beforeEach(() => {
  vi.stubEnv('ELECTRON_RENDERER_URL', ORIGIN);
  themeFile = join(mkdtempSync(join(tmpdir(), 'enso-plugin-trust-')), 'theme.json');
  writeFileSync(themeFile, '{"light":{}}');
  mocks.service.mockReset().mockReturnValue({
    list: vi.fn(() => ({ plugins: [] })),
    assetPath: vi.fn(() => themeFile),
    onChange: vi.fn(),
    onNotice: vi.fn(),
    releaseOwner: vi.fn(),
  });
  mocks.draft.mockReset().mockReturnValue({ releaseOwner: vi.fn(), respond: vi.fn() });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('插件 IPC 的只读放行', () => {
  it('协作看板与独立设计窗口能读插件列表与主题素材', async () => {
    const handler = await registered();
    for (const [id, url] of [
      [ids.taskboard, `${ORIGIN}/taskboard.html`],
      [ids.design, `${ORIGIN}/design.html`],
    ] as const) {
      expect(await handler(IPC_CHANNELS.EXTENSION_PLUGINS_LIST)(sender(id, url))).toEqual({
        plugins: [],
      });
      const asset = await handler(IPC_CHANNELS.EXTENSION_PLUGINS_ASSET)(
        sender(id, url),
        'local.theme',
        'theme.json'
      );
      expect(asset).toMatchObject({ ok: true, mime: 'application/json' });
      expect(Buffer.from(asset.base64 as string, 'base64').toString('utf8')).toBe('{"light":{}}');
    }
  });

  it('管理、安装、调用、配置与 draft 通道对看板/设计窗口仍拒绝，且不初始化服务', async () => {
    const handler = await registered();
    const event = sender(ids.taskboard, `${ORIGIN}/taskboard.html`);
    for (const channel of [
      IPC_CHANNELS.EXTENSION_PLUGINS_UNINSTALL,
      IPC_CHANNELS.EXTENSION_PLUGINS_SET_ENABLED,
      IPC_CHANNELS.EXTENSION_PLUGINS_CALL,
      IPC_CHANNELS.EXTENSION_PLUGINS_CONFIG_SET,
      IPC_CHANNELS.EXTENSION_PLUGINS_DRAFT_RESPONSE,
      IPC_CHANNELS.EXTENSION_PLUGINS_MARKET_LIST,
      IPC_CHANNELS.EXTENSION_PLUGINS_README,
    ])
      expect(await handler(channel)(event, {})).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it('子 frame、错配入口 URL、未知 id 与其它窗口身份都拒绝', async () => {
    const handler = await registered();
    const list = handler(IPC_CHANNELS.EXTENSION_PLUGINS_LIST);
    for (const event of [
      subframeSender(ids.taskboard, `${ORIGIN}/taskboard.html`),
      sender(ids.taskboard, 'https://evil.example/'),
      sender(ids.taskboard, `${ORIGIN}/index.html`),
      sender(ids.design, `${ORIGIN}/taskboard.html`),
      sender(ids.design, 'file:///app/renderer/plugin-view.html'),
      sender(99, `${ORIGIN}/taskboard.html`),
      sender(ids.main, `${ORIGIN}/taskboard.html`),
      sender(ids.settings, `${ORIGIN}/design.html`),
    ])
      expect(await list(event)).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it('主窗口与设置窗口的读取不受影响', async () => {
    const handler = await registered();
    const list = handler(IPC_CHANNELS.EXTENSION_PLUGINS_LIST);
    expect(await list(sender(ids.main, `${ORIGIN}/index.html`))).toEqual({ plugins: [] });
    expect(await list(sender(ids.settings, `${ORIGIN}/settings.html`))).toEqual({ plugins: [] });
  });
});
