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
      if (el.getAttribute('data-testid') === 'bot-mode') return 'Bot';
      return el.tagName === 'BUTTON' ? el.getAttribute('aria-label') : null;
    })
    .filter(Boolean);
}

const modeSwitch = createElement('div', { 'data-testid': 'mode' });

describe('AppRail 精简导航', () => {
  it('Bot 移到设计下方、看板正上方，画图仍保留在 Code 下方', () => {
    expect(
      railItems({
        modeSwitch,
        botModeSwitch: createElement('div', { 'data-testid': 'bot-mode' }),
        imageStudio: { active: false, onToggle: vi.fn() },
        designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
        collaborationBoard: { active: false, onToggle: vi.fn() },
      })
    ).toEqual([
      '---',
      'mode',
      'Image studio',
      'Design',
      'Bot',
      'Collaboration board',
      'Ask Collabra',
      'Settings',
    ]);
  });
  it('未开启 Bot 时 Code 仍有常驻入口，可从图片工作台切回', () => {
    const props = {
      codeWorkspace: { active: false, onToggle: vi.fn() },
      imageStudio: { active: true, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual(['Code', 'Image studio', 'Ask Collabra', 'Settings']);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    expect(document.querySelector('[aria-label="Code"]')?.getAttribute('aria-pressed')).toBe(
      'false'
    );
  });
  it('图片工作台是独立入口，位于设计入口前并反映选中状态', () => {
    const props = {
      imageStudio: { active: true, onToggle: vi.fn() },
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual(['Image studio', 'Design', 'Ask Collabra', 'Settings']);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    expect(
      document.querySelector('[aria-label="Image studio"]')?.getAttribute('aria-pressed')
    ).toBe('true');
  });
  it('模式入口紧跟分隔符，全局入口按 看板 → 设置 排布', () => {
    const props = {
      sidebarCollapsed: true,
      onToggleSidebar: vi.fn(),
      onOpenSearch: vi.fn(),
      modeSwitch,
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
      collaborationBoard: { active: false, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual([
      'Expand sidebar',
      'Search anything',
      '---',
      'mode',
      'Design',
      'Collaboration board',
      'Ask Collabra',
      'Settings',
    ]);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    const brand = document.querySelector('[data-slot="app-rail"]')?.firstElementChild;
    expect(brand?.querySelector('img')?.getAttribute('src')).toContain('brand-mark.png');
    expect(brand?.nextElementSibling?.getAttribute('aria-label')).toBe('Expand sidebar');
  });

  it('全局协作看板在设计入口下方，没有设计入口时仍显示', () => {
    const props = {
      collaborationBoard: { active: true, attention: 3, onToggle: vi.fn() },
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
    };
    expect(railItems({ modeSwitch, ...props })).toEqual([
      '---',
      'mode',
      'Design',
      'Collaboration board',
      'Ask Collabra',
      'Settings',
    ]);
    expect(railItems({ collaborationBoard: props.collaborationBoard })).toEqual([
      'Collaboration board',
      'Ask Collabra',
      'Settings',
    ]);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    expect(
      document.querySelector('[aria-label="Collaboration board"]')?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(document.querySelector('[aria-label="Collaboration board"]')?.textContent).toBe('3');
  });

  it('设计入口只在宿主允许时出现，并反映画廊的切换状态', () => {
    const onToggle = vi.fn();
    const props = { designGallery: { label: 'Design', active: false, onToggle } };
    expect(railItems(props)).toEqual(['Design', 'Ask Collabra', 'Settings']);
    const markup = (active: boolean) =>
      parseHTML(
        renderToStaticMarkup(
          createElement(AppRail, {
            designGallery: { ...props.designGallery, active },
          })
        )
      ).document.querySelector('[aria-label="Design"]');
    expect(markup(false)?.getAttribute('aria-pressed')).toBe('false');
    expect(markup(true)?.getAttribute('aria-pressed')).toBe('true');
    expect(railItems({})).not.toContain('Design');
  });

  it('展开时侧栏开关与模式切换之间有分隔符，不显示搜索', () => {
    expect(
      railItems({
        sidebarCollapsed: false,
        onToggleSidebar: vi.fn(),
        onOpenSearch: vi.fn(),
        modeSwitch,
      })
    ).toEqual(['Collapse sidebar', '---', 'mode', 'Ask Collabra', 'Settings']);
  });

  it('收起时搜索紧跟侧栏开关、位于分隔符上方', () => {
    expect(
      railItems({
        sidebarCollapsed: true,
        onToggleSidebar: vi.fn(),
        onOpenSearch: vi.fn(),
        modeSwitch,
      })
    ).toEqual(['Expand sidebar', 'Search anything', '---', 'mode', 'Ask Collabra', 'Settings']);
  });

  it('没有模式切换时仍保留分隔符', () => {
    expect(railItems({ sidebarCollapsed: false, onToggleSidebar: vi.fn() })).toEqual([
      'Collapse sidebar',
      '---',
      'Ask Collabra',
      'Settings',
    ]);
  });

  it('没有侧栏操作时仅保留全局入口', () => {
    expect(railItems({})).toEqual(['Ask Collabra', 'Settings']);
  });
});
