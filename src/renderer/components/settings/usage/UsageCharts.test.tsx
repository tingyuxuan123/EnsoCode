import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DailyTrendChart } from './DailyTrendChart';
import { HourlyHeatmap } from './HourlyHeatmap';
import { StatCard } from './StatCard';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe('usage design preserves data and controls', () => {
  it('displays Monday first without shifting the Sunday-indexed usage data', () => {
    const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    heatmap[3][10] = 2_100_000;
    const { document } = parseHTML(renderToStaticMarkup(createElement(HourlyHeatmap, { heatmap })));
    const cells = [...document.querySelectorAll('[title]')];
    expect(cells).toHaveLength(168);
    expect(cells[0].getAttribute('title')).toBe('Mon 00:00 · 0');
    expect(cells[2 * 24 + 10].getAttribute('title')).toBe('Wed 10:00 · 2.1M');
    expect(cells[6 * 24].getAttribute('title')).toBe('Sun 00:00 · 0');
  });

  it('keeps chart series controls and scales text outside the SVG', () => {
    const { document } = parseHTML(
      renderToStaticMarkup(
        createElement(DailyTrendChart, {
          daily: [{ day: '2026-10-28', input: 20, output: 10, cache: 30, cost: 0.1 }],
        })
      )
    );
    expect(document.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(3);
    expect(
      [...document.querySelectorAll('svg g rect')]
        .slice(1)
        .map((rect) => rect.getAttribute('class'))
    ).toEqual(['fill-primary', 'fill-primary/55', 'fill-control']);
    expect(document.querySelector('svg text')).toBeNull();
    expect(document.querySelector('svg')?.getAttribute('preserveAspectRatio')).toBe('none');
  });

  it('keeps the metric and its period comparison on separate lines', () => {
    const { document } = parseHTML(
      renderToStaticMarkup(createElement(StatCard, { label: 'Sessions', value: '2', delta: 'new' }))
    );
    expect([...document.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'Sessions',
      'New this period',
    ]);
    expect(document.querySelector('[title="2"]')?.textContent).toBe('2');
  });
});
