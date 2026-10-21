import type { ThinkingLevel } from '@shared/types/agent';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThinkingLevelSlider } from './ThinkingLevelSlider';
import { levelTrackOffset, THINKING_SLIDER_THUMB_PX } from './thinkingLevelTrack';

vi.mock('@/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const labels: Record<ThinkingLevel, string> = {
  minimal: 'Min',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
};

const render = (levels: ThinkingLevel[], level: ThinkingLevel): string =>
  renderToStaticMarkup(
    createElement(ThinkingLevelSlider, {
      levels,
      level,
      labels,
      ariaLabel: 'Thinking level',
      onChange: () => undefined,
    })
  );

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe('ThinkingLevelSlider', () => {
  it('填充端点、滑块、档位点、标签共用同一套落点', () => {
    const levels: ThinkingLevel[] = ['low', 'medium', 'high'];
    const html = render(levels, 'medium');
    const center = levelTrackOffset(1, levels.length);

    // 填充宽度、滑块 left、当前档标签 left 三处都应该是"到滑块圆心"的同一个值
    expect(html).toContain(`width:${center}`);
    expect(countOf(html, center)).toBeGreaterThanOrEqual(3);
    expect(html).toContain(`left:${levelTrackOffset(0, levels.length)}`);
    expect(html).toContain(`left:${levelTrackOffset(2, levels.length)}`);
  });

  it('原生滑块的把手尺寸与几何常量一致，否则点档位会跳到隔壁档', () => {
    const html = render(['low', 'high'], 'high');
    expect(html).toContain(`size-[${THINKING_SLIDER_THUMB_PX}px]`);
    expect(html).toContain('aria-valuetext="High"');
    expect(html).toContain('value="1"');
  });

  it('已选及以下的档位点算已填充，以上算未填充', () => {
    const levels: ThinkingLevel[] = ['low', 'medium', 'high', 'max'];
    const html = render(levels, 'medium');
    expect(countOf(html, 'bg-white/50')).toBe(2);
    expect(countOf(html, 'bg-foreground/30')).toBe(2);
    expect(countOf(html, 'data-thinking-tick=')).toBe(levels.length);
  });

  it('只有一个可用档时整块不渲染', () => {
    expect(render(['low'], 'low')).toBe('');
    expect(render([], 'low')).toBe('');
  });
});
