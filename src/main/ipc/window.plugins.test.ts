import { IPC_CHANNELS } from '@shared/types';
import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  main: { shell: true },
  settings: { settings: true },
  focus: vi.fn(),
  openSettings: vi.fn(),
  send: vi.fn(),
  handlers: new Map<string, (event: { sender: { id: number } }) => unknown>(),
}));
vi.mock('electron', () => ({
  BrowserWindow: {},
  dialog: {},
  Menu: {},
  ipcMain: {
    handle: (channel: string, handler: (event: { sender: { id: number } }) => unknown) =>
      fixture.handlers.set(channel, handler),
  },
}));
vi.mock('../windows/createAppWindow', () => ({
  sendToWindow: fixture.send,
  TRAFFIC_LIGHT_POSITION: {},
}));
vi.mock('../windows/MainWindow', () => ({
  focusMainWindow: fixture.focus,
  isMainWebContents: (id: number) => id === 20,
}));
vi.mock('../windows/SettingsWindow', () => ({ openSettingsWindow: fixture.openSettings }));
vi.mock('../services/agentHost', () => ({ agentTypeRegistrySnapshot: vi.fn() }));

import { openSettingsDeepLink, registerWindowHandlers } from './window';

const consume = (id = 20) =>
  fixture.handlers.get('extensions:deep-link-consume')?.({ sender: { id } });
beforeEach(() => {
  vi.clearAllMocks();
  fixture.handlers.clear();
  fixture.focus.mockReturnValue(fixture.main);
  fixture.openSettings.mockReturnValue(fixture.settings);
  registerWindowHandlers();
  consume();
});

it('原生插件管理旧链接改投主窗口，不再创建重复设置页', () => {
  const link = { category: 'plugins', rowId: 'plugins.enso' };
  openSettingsDeepLink(link);
  expect(fixture.focus).toHaveBeenCalledOnce();
  expect(fixture.openSettings).not.toHaveBeenCalled();
  expect(fixture.send).toHaveBeenCalledWith(fixture.main, 'extensions:deep-link');
  expect(consume()).toEqual(link);
  expect(consume()).toBeNull();
});

it('Claude Code 插件与普通设置深链继续打开设置窗口', () => {
  const link = { category: 'plugins', rowId: 'plugins.root' };
  openSettingsDeepLink(link);
  expect(fixture.openSettings).toHaveBeenCalledOnce();
  expect(fixture.focus).not.toHaveBeenCalled();
  expect(fixture.send).toHaveBeenCalledWith(
    fixture.settings,
    IPC_CHANNELS.SETTINGS_DEEP_LINK,
    link
  );
});

it('原生插件定位和安装预览参数保持完整，只有主 UI 能消费导航', () => {
  const link = {
    category: 'plugins',
    rowId: 'plugins.enso',
    pluginId: 'enso.example.notes',
    pluginInstallUrl: 'https://example.test/plugin.zip',
  };
  openSettingsDeepLink(link);
  expect(consume(99)).toBeNull();
  expect(consume()).toEqual(link);
});

it.each([
  'http://example.test/plugin.zip',
  'https://user:pass@example.test/plugin.zip',
  'file:///tmp/plugin.zip',
])('坏安装地址 %s 不进入扩展预览', (pluginInstallUrl) => {
  openSettingsDeepLink({ category: 'plugins', rowId: 'plugins.enso', pluginInstallUrl });
  expect(fixture.focus).not.toHaveBeenCalled();
  expect(consume()).toBeNull();
});
