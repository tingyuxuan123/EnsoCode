import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppRail } from './AppRail';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) => select({ keybindings: {} }),
}));
vi.mock('./StatusBar', () => ({ StatusBar: () => null }));
/** 按图标轨子元素顺序列出：按钮取 aria-label，分隔符记为 `---` */
function railItems(props: Parameters<typeof AppRail>[0]) {
  const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
  const nav = document.querySelector('[data-slot="app-rail"]');
  return Array.from(nav?.children ?? [])
    .map((el) => {
      if (el.getAttribute('data-slot') === 'app-rail-separator') return '---';
      return el.tagName === 'BUTTON' ? el.getAttribute('aria-label') : null;
    })
    .filter(Boolean);
}

describe('AppRail 精简导航', () => {
  it.each(['Image studio', 'Design', 'Collaboration board'])(
    '%s 的常驻选中与悬停区分，统一使用品牌选择背景',
    (label) => {
      const render = (active: boolean) =>
        parseHTML(
          renderToStaticMarkup(
            createElement(AppRail, {
              imageStudio: { active: label === 'Image studio' && active, onToggle: vi.fn() },
              designGallery: {
                label: 'Design',
                active: label === 'Design' && active,
                onToggle: vi.fn(),
              },
              collaborationBoard: {
                active: label === 'Collaboration board' && active,
                onToggle: vi.fn(),
              },
            })
          )
        ).document.querySelector(`[aria-label="${label}"]`);
      const selected = render(true);
      expect(selected?.getAttribute('aria-pressed')).toBe('true');
      expect(selected?.classList.contains('bg-selection')).toBe(true);
      expect(selected?.classList.contains('text-brand')).toBe(true);
      expect(selected?.classList.contains('hover:bg-accent')).toBe(false);
      expect(render(false)?.classList.contains('bg-selection')).toBe(false);
    }
  );

  it('图标轨只剩功能导航：画图、设计、看板，不再有 Code / Bot 模式入口', () => {
    expect(
      railItems({
        imageStudio: { active: false, onToggle: vi.fn() },
        designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
        collaborationBoard: { active: false, onToggle: vi.fn() },
      })
    ).toEqual(['Image studio', 'Design', 'Collaboration board', 'Ask CodeKiln', 'Settings']);
    const document = parseHTML(
      renderToStaticMarkup(
        createElement(AppRail, {
          imageStudio: { active: false, onToggle: vi.fn() },
          designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
        })
      )
    ).document;
    // 图标轨不自己推导工作模式：Code 入口只在宿主显式提供时出现
    expect(document.querySelector('[data-rail-view="code"]')).toBeNull();
    expect(document.querySelector('[data-rail-view="bot"]')).toBeNull();
    expect(document.querySelector('[data-slot="mode-switch"]')).toBeNull();
  });

  it('Bot 关闭时的 Code 入口排在图片工作台上方，沿用图标轨选中态钩子', () => {
    const props = {
      codeWorkspace: { active: true, onToggle: vi.fn() },
      imageStudio: { active: false, onToggle: vi.fn() },
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual([
      'Code',
      'Image studio',
      'Design',
      'Ask CodeKiln',
      'Settings',
    ]);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    const code = document.querySelector('[aria-label="Code"]');
    expect(code?.getAttribute('data-rail-view')).toBe('code');
    expect(code?.getAttribute('aria-pressed')).toBe('true');
    expect(code?.classList.contains('bg-selection')).toBe(true);
    expect(code?.classList.contains('text-brand')).toBe(true);
    expect(code?.querySelector('svg')?.getAttribute('data-rail-glyph')).toBe('code');
    expect(code?.querySelector('svg')?.getAttribute('class') ?? '').not.toContain(
      'lucide-square-terminal'
    );
  });

  it('功能入口使用定制几何微标并统一细描边，不再使用旧通用 Lucide 图标', () => {
    const document = parseHTML(
      renderToStaticMarkup(
        createElement(AppRail, {
          sidebarCollapsed: false,
          onToggleSidebar: vi.fn(),
          codeWorkspace: { active: false, onToggle: vi.fn() },
          imageStudio: { active: true, onToggle: vi.fn() },
          designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
          collaborationBoard: { active: false, onToggle: vi.fn() },
        })
      )
    ).document;

    const codeSvg = document.querySelector('[aria-label="Code"] svg');
    const imagesSvg = document.querySelector('[aria-label="Image studio"] svg');
    const designSvg = document.querySelector('[aria-label="Design"] svg');
    const askSvg = document.querySelector('[aria-label="Ask CodeKiln"] svg');
    const sidebarSvg = document.querySelector('[aria-label="Collapse sidebar"] svg');
    const boardSvg = document.querySelector('[aria-label="Collaboration board"] svg');
    const settingsSvg = document.querySelector('[aria-label="Settings"] svg');

    expect(codeSvg?.getAttribute('data-rail-glyph')).toBe('code');
    expect(imagesSvg?.getAttribute('data-rail-glyph')).toBe('images');
    expect(imagesSvg?.querySelector('[data-active-fill]')).not.toBeNull();
    expect(designSvg?.getAttribute('data-rail-glyph')).toBe('design');
    expect(designSvg?.querySelector('[data-active-fill]')).toBeNull();
    expect(askSvg?.getAttribute('data-nav-glyph')).toBe('ask-codekiln');
    expect(settingsSvg?.getAttribute('data-rail-glyph')).toBe('settings');

    for (const [svg, legacy] of [
      [codeSvg, 'lucide-square-terminal'],
      [imagesSvg, 'lucide-image'],
      [designSvg, 'lucide-ruler'],
      [askSvg, 'lucide-sparkles'],
      [settingsSvg, 'lucide-settings-2'],
    ] as const) {
      expect(svg?.getAttribute('class') ?? '').not.toContain(legacy);
    }

    for (const railSvg of [sidebarSvg, boardSvg, settingsSvg]) {
      expect(railSvg?.getAttribute('stroke-width')).toBe('1.75');
    }
  });

  it('图片工作台是独立入口，位于设计入口前并反映选中状态', () => {
    const props = {
      imageStudio: { active: true, onToggle: vi.fn() },
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual(['Image studio', 'Design', 'Ask CodeKiln', 'Settings']);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    expect(
      document.querySelector('[aria-label="Image studio"]')?.getAttribute('aria-pressed')
    ).toBe('true');
  });

  it('功能入口按 图片 -> 设计 -> Wiki -> 看板 排布并支持 Wiki 选中态与更新徽标', () => {
    const props = {
      imageStudio: { active: false, onToggle: vi.fn() },
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
      wikiWorkspace: { active: true, updated: true, onToggle: vi.fn() },
      collaborationBoard: { active: false, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual([
      'Image studio',
      'Design',
      'Wiki',
      'Collaboration board',
      'Ask CodeKiln',
      'Settings',
    ]);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    const wikiBtn = document.querySelector('[aria-label="Wiki"]');
    expect(wikiBtn?.getAttribute('data-rail-view')).toBe('wiki');
    expect(wikiBtn?.getAttribute('aria-pressed')).toBe('true');
    expect(wikiBtn?.classList.contains('bg-selection')).toBe(true);
    expect(wikiBtn?.classList.contains('text-brand')).toBe(true);
    const svg = wikiBtn?.querySelector('svg');
    expect(svg?.getAttribute('data-rail-glyph')).toBe('wiki');
    expect(svg?.querySelector('[data-active-fill]')).not.toBeNull();
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
    expect(wikiBtn?.querySelector('[data-wiki-updated]')).toBeNull();
    const updatedInactiveDoc = parseHTML(
      renderToStaticMarkup(
        createElement(AppRail, {
          wikiWorkspace: { active: false, updated: true, onToggle: vi.fn() },
        })
      )
    ).document;
    expect(
      updatedInactiveDoc.querySelector('[aria-label="Wiki"] [data-wiki-updated]')
    ).not.toBeNull();
    expect(railItems({})).not.toContain('Wiki');
  });

  it('侧栏开关之后是分隔符，全局入口按 看板 → 设置 排布', () => {
    const props = {
      sidebarCollapsed: true,
      onToggleSidebar: vi.fn(),
      onOpenSearch: vi.fn(),
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
      collaborationBoard: { active: false, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual([
      'Expand sidebar',
      'Search anything',
      '---',
      'Design',
      'Collaboration board',
      'Ask CodeKiln',
      'Settings',
    ]);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    // 图标轨顶部不再挂品牌图，第一个入口就是侧栏开关
    const first = document.querySelector('[data-slot="app-rail"]')?.firstElementChild;
    expect(first?.getAttribute('aria-label')).toBe('Expand sidebar');
    expect(document.querySelector('[data-slot="app-rail"] img')).toBeNull();
  });

  it('全局协作看板在设计入口下方，没有设计入口时仍显示', () => {
    const props = {
      collaborationBoard: { active: true, attention: 3, onToggle: vi.fn() },
      designGallery: { label: 'Design', active: false, onToggle: vi.fn() },
    };
    expect(railItems(props)).toEqual(['Design', 'Collaboration board', 'Ask CodeKiln', 'Settings']);
    expect(railItems({ collaborationBoard: props.collaborationBoard })).toEqual([
      'Collaboration board',
      'Ask CodeKiln',
      'Settings',
    ]);
    const document = parseHTML(renderToStaticMarkup(createElement(AppRail, props))).document;
    expect(
      document.querySelector('[aria-label="Collaboration board"]')?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(document.querySelector('[aria-label="Collaboration board"]')?.textContent).toBe('3');
  });

  it('协作看板使用看板图形，不与侧栏布局开关的图标重复', () => {
    const document = parseHTML(
      renderToStaticMarkup(
        createElement(AppRail, {
          sidebarCollapsed: false,
          onToggleSidebar: vi.fn(),
          collaborationBoard: { active: false, onToggle: vi.fn() },
        })
      )
    ).document;
    const boardIcon = document.querySelector('[aria-label="Collaboration board"] svg');
    const sidebarIcon = document.querySelector('[aria-label="Collapse sidebar"] svg');
    expect(boardIcon?.getAttribute('class')).toContain('lucide-square-kanban');
    expect(boardIcon?.getAttribute('class')).toContain('size-[19px]');
    expect(sidebarIcon?.getAttribute('class')).toContain('lucide-panel-left');
  });

  it('设计入口只在宿主允许时出现，并反映画廊的切换状态', () => {
    const props = { designGallery: { label: 'Design', active: false, onToggle: vi.fn() } };
    expect(railItems(props)).toEqual(['Design', 'Ask CodeKiln', 'Settings']);
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

  it('展开时侧栏开关与功能入口之间有分隔符，不显示搜索', () => {
    expect(
      railItems({
        sidebarCollapsed: false,
        onToggleSidebar: vi.fn(),
        onOpenSearch: vi.fn(),
      })
    ).toEqual(['Collapse sidebar', '---', 'Ask CodeKiln', 'Settings']);
  });

  it('收起时搜索紧跟侧栏开关、位于分隔符上方', () => {
    expect(
      railItems({
        sidebarCollapsed: true,
        onToggleSidebar: vi.fn(),
        onOpenSearch: vi.fn(),
      })
    ).toEqual(['Expand sidebar', 'Search anything', '---', 'Ask CodeKiln', 'Settings']);
  });

  it('没有侧栏操作时仅保留全局入口', () => {
    expect(railItems({})).toEqual(['Ask CodeKiln', 'Settings']);
  });
});
