import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextMeter } from './ContextMeter';

describe('上下文细进度条', () => {
  it.each([
    [0, false, '0%', 'bg-muted-foreground/60'],
    [16, false, '16%', 'bg-muted-foreground/60'],
    [49, false, '49%', 'bg-muted-foreground/60'],
    // 半程起提亮一档：仍是常态语义（不改色相），但能与刚开聊区分开
    [50, false, '50%', 'bg-muted-foreground'],
    [69, false, '69%', 'bg-muted-foreground'],
    [70, false, '70%', 'bg-warning'],
    [95, true, '95%', 'bg-destructive'],
    [120, true, '100%', 'bg-destructive'],
    [-5, false, '0%', 'bg-muted-foreground/60'],
  ])('占用 %s%% 的长度和警戒语义正确', (percent, critical, width, tone) => {
    const document = parseHTML(
      renderToStaticMarkup(createElement(ContextMeter, { percent, critical }))
    ).document;
    const meter = document.querySelector('[data-slot="context-meter"]');
    expect(meter).not.toBeNull();
    expect(meter?.firstElementChild?.getAttribute('style')).toBe(`width:${width}`);
    expect(meter?.firstElementChild?.classList.contains(tone)).toBe(true);
  });
});

describe('上下文圆环', () => {
  const ring = (percent: number, critical = false) =>
    parseHTML(
      renderToStaticMarkup(createElement(ContextMeter, { percent, critical, variant: 'ring' }))
    ).document.querySelector('[data-slot="context-meter"]');

  it.each([
    [0, false, 'text-muted-foreground/60'],
    [16, false, 'text-muted-foreground/60'],
    [49, false, 'text-muted-foreground/60'],
    // 12px 的环上，弧长在 40–60% 之间几乎分不出，半程靠提亮一档补一个可读信号
    [50, false, 'text-muted-foreground'],
    [69, false, 'text-muted-foreground'],
    [70, false, 'text-warning'],
    [95, true, 'text-destructive'],
  ])('占用 %s%% 用弧长表达且带警戒色', (percent, critical, tone) => {
    const meter = ring(percent, critical);
    expect(meter?.getAttribute('data-variant')).toBe('ring');
    expect(meter?.classList.contains(tone)).toBe(true);
    // 两段圆：底色轨道 + 按占比画的弧，弧长按圆周换算
    const circles = [...(meter?.querySelectorAll('circle') ?? [])];
    expect(circles).toHaveLength(2);
    const radius = Number(circles[1]?.getAttribute('r'));
    const circumference = 2 * Math.PI * radius;
    const [arc, rest] = (circles[1]?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
    expect(arc).toBeCloseTo((percent / 100) * circumference);
    expect(rest).toBeCloseTo(circumference);
  });

  it('critical 优先于占比：90% 以下但被判 critical 时仍用危险色', () => {
    const meter = ring(50, true);
    expect(meter?.classList.contains('text-destructive')).toBe(true);
    expect(meter?.classList.contains('text-muted-foreground')).toBe(false);
  });

  it('超出范围时弧长夹在 0 到整圈之间', () => {
    const full = ring(140)?.querySelectorAll('circle')[1];
    const empty = ring(-20)?.querySelectorAll('circle')[1];
    expect(Number(full?.getAttribute('stroke-dasharray')?.split(' ')[0])).toBeCloseTo(
      2 * Math.PI * Number(full?.getAttribute('r'))
    );
    expect(Number(empty?.getAttribute('stroke-dasharray')?.split(' ')[0])).toBe(0);
  });
});
