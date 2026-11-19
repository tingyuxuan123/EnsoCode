import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const root = postcss.parse(css);

/** 选择器里的引号两种都写，比较时统一成单引号，测试不用跟着 CSS 的书写习惯漂移。 */
const normalize = (selector: string) => selector.replaceAll('"', "'");

function declarations(selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  root.walkRules(normalize(selector), (rule) => {
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value;
    });
  });
  return result;
}

/** 卡片外沿（--workbench-card-gap）与圆角半径：两者同源，内缩与圆角不能各写一份。 */
const shell = declarations('[data-enso="canvas"]');

describe('工作区圆角卡片', () => {
  it('reserves one gap token and derives the radius from it', () => {
    expect(shell['--workbench-card-gap']).toBeDefined();
    expect(shell['--workbench-card-radius']).toContain('var(--workbench-card-gap)');
  });

  it('insets the workbench card so the shell shows through on every side', () => {
    const card = declarations('[data-workbench-card]');
    // 四周都留缝：左侧那圈缝落在分栏手柄与卡片之间，手柄仍贴侧栏边缘。
    expect(card.margin).toBe('var(--workbench-card-gap)');
    expect(card['border-radius']).toBe('var(--workbench-card-radius)');
    // 裁切仍由组件上的 overflow-hidden 负责，CSS 不再重复声明，免得两处各说一套。
    expect(card.overflow).toBeUndefined();
  });

  it('keeps the window chrome and background layer square', () => {
    // 卡片外是外壳：图标轨、侧栏、标题栏、壁纸层都不能跟着圆，否则缝里会露出圆角缺口。
    for (const selector of [
      '[data-slot="app-rail"]',
      '[data-slot="project-sidebar"]',
      '[data-slot="title-bar"]',
      '[data-slot="background-layer"]',
    ]) {
      expect(declarations(selector)['border-radius'], selector).toBeUndefined();
    }
  });
});
