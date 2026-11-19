import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const sideDockCss = readFileSync(
  new URL('../components/sidepanel/sidepanel-dock.css', import.meta.url),
  'utf8'
);
const coworkerTabsSource = readFileSync(
  new URL('../components/chat/CoworkerTabs.tsx', import.meta.url),
  'utf8'
);
const root = postcss.parse(css);
const sideDockRoot = postcss.parse(sideDockCss);

/** 选择器里的引号两种都写，比较时统一成单引号，测试不用跟着 CSS 的书写习惯漂移。 */
const normalize = (selector: string) => selector.replaceAll('"', "'");

function declarations(selector: string, tree: postcss.Root = root): Record<string, string> {
  const result: Record<string, string> = {};
  const target = normalize(selector);
  tree.walkRules((rule) => {
    const selectors = rule.selectors.map(normalize);
    if (!selectors.includes(target)) return;
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value;
    });
  });
  return result;
}

/** 卡片外沿（--workbench-card-gap）与圆角半径：两者同源，内缩与圆角不能各写一份。 */
const shell = declarations('[data-enso="canvas"]');

describe('工作区圆角卡片', () => {
  it('reserves shared gap, radius, border and header-height tokens', () => {
    expect(shell['--workbench-card-gap']).toBeDefined();
    expect(shell['--workbench-card-radius']).toContain('var(--workbench-card-gap)');
    expect(shell['--workbench-card-border']).toBeDefined();
    expect(shell['--workbench-header-height']).toBeDefined();
  });

  it('insets the workbench card and gives every floating pane/sidebar the same rounded geometry', () => {
    const card = declarations('[data-workbench-card]');
    expect(card.margin).toBe('0 var(--workbench-card-gap) var(--workbench-card-gap)');
    expect(card['border-radius']).toBe('var(--workbench-card-radius)');
    // 裁切仍由组件上的 overflow-hidden 负责，CSS 不再重复声明，免得两处各说一套。
    expect(card.overflow).toBeUndefined();

    const pane = declarations('[data-workbench-pane]');
    expect(pane['border-radius']).toBe('var(--workbench-card-radius)');
    expect(pane.border).toContain('var(--workbench-card-border)');

    const sidebar = declarations('[data-workbench-sidebar]');
    expect(sidebar['margin-top']).toBe('0');
    expect(sidebar['margin-bottom']).toBe('var(--workbench-card-gap)');
    expect(sidebar['border-radius']).toBe('var(--workbench-card-radius)');
    expect(sidebar.border).toContain('var(--workbench-card-border)');
  });

  it('aligns chat and side-panel header bars to the same height and card surface', () => {
    const dockHeader = declarations('.enso-side-dock .dv-tabs-and-actions-container', sideDockRoot);
    expect(dockHeader.height).toContain('var(--workbench-header-height');
    expect(dockHeader.background).toBe('var(--color-background)');
    expect(coworkerTabsSource).toContain('h-[var(--workbench-header-height)]');
  });

  it('keeps only the outer window chrome and background layer square', () => {
    for (const selector of [
      '[data-slot="app-rail"]',
      '[data-slot="title-bar"]',
      '[data-slot="background-layer"]',
    ]) {
      expect(declarations(selector)['border-radius'], selector).toBeUndefined();
    }
  });
});
