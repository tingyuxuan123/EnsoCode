// @vitest-environment happy-dom
import type { ExtensionPluginMarketEntry } from '@shared/extensionPlugins/types';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginMarket } from './PluginMarket';

const fixture = vi.hoisted(() => ({
  icon: 'https://cdn.example.test/community-search.png' as string | undefined,
  locale: 'en' as 'en' | 'zh',
  changed: null as null | (() => void),
  marketList: vi.fn(),
  manager: {
    plugins: [],
    available: true,
    canManage: true,
    busy: null,
    loading: false,
    error: '',
    registryError: '',
    stage: vi.fn(),
    checkUpdates: vi.fn(),
  },
}));

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: fixture.locale }),
}));

function entry(over: Partial<ExtensionPluginMarketEntry> = {}): ExtensionPluginMarketEntry {
  return {
    id: 'community.search',
    name: 'Community search',
    description: 'Search across installed docs',
    tier: 'community',
    tags: [],
    icon: fixture.icon,
    latest: '1.0.0',
    permissions: [],
    updateAvailable: false,
    ...over,
  };
}

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixture.icon = 'https://cdn.example.test/community-search.png';
  fixture.locale = 'en';
  fixture.changed = null;
  fixture.marketList.mockReset();
  fixture.marketList.mockImplementation(async () => ({
    ok: true,
    stale: false,
    chinaMirror: false,
    plugins: [entry()],
  }));
  (
    window as unknown as {
      electronAPI: { extensionPlugins: Record<string, unknown> };
    }
  ).electronAPI = {
    extensionPlugins: {
      marketList: fixture.marketList,
      marketSetChinaMirror: vi.fn(async () => ({ ok: true })),
      onChanged: (callback: () => void) => {
        fixture.changed = callback;
        return () => {
          fixture.changed = null;
        };
      },
      readme: vi.fn(async () => ({ ok: true, text: '' })),
    },
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<PluginMarket manager={fixture.manager as never} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const icon = () => container.querySelector<HTMLImageElement>('[data-slot="market-icon"]');
const fallback = () => container.querySelector('[data-slot="market-icon-fallback"]');
const sectionButtons = () =>
  [
    ...container.querySelectorAll<HTMLButtonElement>('[data-slot="market-section"]'),
  ] as HTMLButtonElement[];
const sectionLabels = () => sectionButtons().map((button) => button.textContent);
const cards = () => [...container.querySelectorAll('article h4')].map((node) => node.textContent);

async function rerender() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<PluginMarket manager={fixture.manager as never} />));
}

it('远程图标正常时显示远程图标，并作为装饰不进入无障碍树', async () => {
  expect(icon()?.getAttribute('src')).toBe(fixture.icon);
  expect(icon()?.getAttribute('alt')).toBe('');
  expect(fallback()).toBeNull();
});

it('远程图标加载失败时换成中性占位，不留浏览器破图', async () => {
  await act(async () => icon()?.dispatchEvent(new Event('error')));
  expect(icon()).toBeNull();
  expect(fallback()).not.toBeNull();
  expect(container.textContent).toContain('Community search');
});

it('市场条目没有图标时直接使用中性占位', async () => {
  fixture.icon = undefined;
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<PluginMarket manager={fixture.manager as never} />));
  expect(icon()).toBeNull();
  expect(fallback()).not.toBeNull();
});

it('图标地址更新后重新尝试加载，失败占位不会残留', async () => {
  await act(async () => icon()?.dispatchEvent(new Event('error')));
  expect(fallback()).not.toBeNull();
  fixture.icon = 'https://cdn.example.test/community-search-2.png';
  await act(async () => fixture.changed?.());
  expect(icon()?.getAttribute('src')).toBe(fixture.icon);
  expect(fallback()).toBeNull();
});

it('中文界面下分段显示中文名称，不显示内核小写 id', async () => {
  fixture.locale = 'zh';
  fixture.marketList.mockImplementation(async () => ({
    ok: true,
    stale: false,
    chinaMirror: false,
    plugins: [entry({ category: 'themes' })],
  }));
  await rerender();
  expect(sectionLabels()).toEqual(['全部 (1)', '已安装 (0)', '更新 (0)', '主题外观 (1)']);
  expect(container.textContent).not.toContain('themes');
});

it('英文界面下分段显示英文名称', async () => {
  fixture.marketList.mockImplementation(async () => ({
    ok: true,
    stale: false,
    chinaMirror: false,
    plugins: [entry({ category: 'productivity' })],
  }));
  await rerender();
  expect(sectionLabels()).toEqual(['All (1)', 'Installed (0)', 'Updates (0)', 'Productivity (1)']);
});

it('点击分段仍按分类过滤面板里的条目', async () => {
  fixture.locale = 'zh';
  fixture.marketList.mockImplementation(async () => ({
    ok: true,
    stale: false,
    chinaMirror: false,
    plugins: [
      entry({ id: 'community.themes', name: 'Theme kit', category: 'themes' }),
      entry({ id: 'community.work', name: 'Work kit', category: 'productivity' }),
    ],
  }));
  await rerender();
  expect(cards()).toEqual(['Theme kit 1.0.0', 'Work kit 1.0.0']);
  const themes = sectionButtons().find((button) => button.textContent?.startsWith('主题外观'));
  await act(async () => themes?.click());
  expect(cards()).toEqual(['Theme kit 1.0.0']);
  expect(sectionLabels()).toContain('主题外观 (1)');
});
