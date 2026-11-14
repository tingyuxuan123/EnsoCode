import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextMeter } from './ContextMeter';

describe('上下文细进度条', () => {
  it.each([
    [0, false, '0%', 'bg-muted-foreground/60'],
    [16, false, '16%', 'bg-muted-foreground/60'],
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
