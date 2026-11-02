import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRail } from './AppRail';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({ keybindings: {} }),
}));
/** 按图标轨子元素顺序列出：按钮取 aria-label，分隔符记为 `---`，模式切换记为 `mode` */
function railItems(props: Parameters<typeof AppRail>[0]) {
  const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
  const nav = document.querySelector('[data-slot="app-rail"]');
  return Array.from(nav?.children ?? [])
    .map((el) => {
      if (el.getAttribute('data-slot') === 'app-rail-separator') return '---';
      if (el.getAttribute('data-testid') === 'mode') return 'mode';
      return el.tagName === 'BUTTON' ? el.getAttribute('aria-label') : null;
    })
    .filter(Boolean);
}

const modeSwitch = createElement('div', { 'data-testid': 'mode' });

describe('AppRail 精简导航', () => {
  it('展开时侧栏开关与模式切换之间有分隔符，不显示搜索', () => {
    expect(
      railItems({
        sidebarCollapsed: false,
        onToggleSidebar: vi.fn(),
        onOpenSearch: vi.fn(),
        modeSwitch,
      })
    ).toEqual(['Collapse sidebar', '---', 'mode', 'Ask Enso', 'Settings']);
  });

  it('收起时搜索紧跟侧栏开关、位于分隔符上方', () => {
    expect(
      railItems({
        sidebarCollapsed: true,
        onToggleSidebar: vi.fn(),
        onOpenSearch: vi.fn(),
        modeSwitch,
      })
    ).toEqual(['Expand sidebar', 'Search anything', '---', 'mode', 'Ask Enso', 'Settings']);
  });

  it('没有模式切换时仍保留分隔符', () => {
    expect(railItems({ sidebarCollapsed: false, onToggleSidebar: vi.fn() })).toEqual([
      'Collapse sidebar',
      '---',
      'Ask Enso',
      'Settings',
    ]);
  });

  it('没有侧栏操作时仅保留全局入口', () => {
    expect(railItems({})).toEqual(['Ask Enso', 'Settings']);
  });
});
