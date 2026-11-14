// @vitest-environment happy-dom
import type { InstalledPluginInfo, PluginEntry } from '@shared/types';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginsSettings } from './PluginsSettings';

const fixture = vi.hoisted(() => ({
  plugins: [] as PluginEntry[],
  list: vi.fn<() => Promise<InstalledPluginInfo[]>>(),
  add: vi.fn(),
  toggle: vi.fn(),
  remove: vi.fn(),
  native: vi.fn(() => <div data-slot="duplicate-native-plugins" />),
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/plugins/NativePluginsSection', () => ({ NativePluginsSection: fixture.native }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      plugins: fixture.plugins,
      addPlugins: fixture.add,
      setPluginEnabled: fixture.toggle,
      removePlugin: fixture.remove,
    }),
}));

const installed: InstalledPluginInfo = {
  key: 'review@example',
  name: 'Review',
  description: 'Claude review tools',
  marketplace: 'example',
  components: {
    skills: ['review'],
    commands: [],
    agents: [],
    mcpServers: [],
    hooks: [],
    unsupported: [],
  },
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('electronAPI', { assets: { listInstalledPlugins: fixture.list } });
  vi.clearAllMocks();
  fixture.plugins = [];
  fixture.list.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('设置页只展示 Claude Code 插件，不再挂载原生插件管理入口', async () => {
  await act(async () => root.render(<PluginsSettings />));
  expect(container.querySelector('h3')?.textContent).toContain('Claude Code plugins');
  expect(container.textContent).toContain('No Claude Code plugins found');
  expect(container.querySelector('[data-slot="duplicate-native-plugins"]')).toBeNull();
  expect(fixture.native).not.toHaveBeenCalled();
});

it('Claude Code 扫描和首次启用仍登记整包配置', async () => {
  fixture.list.mockResolvedValue([installed]);
  await act(async () => root.render(<PluginsSettings />));
  expect(container.textContent).toContain('Review');
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
  expect(fixture.add).toHaveBeenCalledWith([
    expect.objectContaining({
      key: installed.key,
      name: installed.name,
      enabled: true,
      source: 'example',
    }),
  ]);
  expect(fixture.toggle).not.toHaveBeenCalled();
});

it('已有插件继续复用开关，重新扫描不改变已保存选择', async () => {
  fixture.plugins = [
    {
      id: 'registered',
      key: installed.key,
      name: installed.name,
      description: installed.description,
      source: 'example',
      enabled: true,
    },
  ];
  fixture.list.mockResolvedValue([installed]);
  await act(async () => root.render(<PluginsSettings />));
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')?.click());
  expect(fixture.toggle).toHaveBeenCalledWith('registered', false);
  const rescan = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Rescan'
  );
  await act(async () => rescan?.click());
  expect(fixture.list).toHaveBeenCalledTimes(2);
  expect(fixture.add).not.toHaveBeenCalled();
});
