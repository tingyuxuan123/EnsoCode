import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compile } from 'tailwindcss';
import { describe, expect, it, vi } from 'vitest';
import { RankingTable } from './RankingTable';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const longName = `provider/${'long-model-name-'.repeat(20)}`;
const rows = [
  { key: 'long', name: longName, cost: 0.1, tokens: 2_100_000, count: 2 },
  { key: 'missing', name: '', cost: null, tokens: 0, count: 1 },
];

const render = (input = rows) =>
  parseHTML(
    `<html><body>${renderToStaticMarkup(
      createElement(RankingTable, {
        title: 'By model',
        countLabel: 'Messages',
        emptyLabel: 'No usage',
        rows: input,
      })
    )}</body></html>`
  ).document;

describe('usage ranking layout', () => {
  it('bounds long names with fixed columns while keeping each metric accessible', async () => {
    const document = render();
    const table = document.querySelector('table');
    const css = (await compile('@tailwind utilities;')).build(table?.className.split(/\s+/) ?? []);
    expect(css).toContain('table-layout: fixed');
    expect(table?.querySelectorAll('col')).toHaveLength(4);
    expect(table?.querySelector('[title]')?.getAttribute('title')).toBe(longName);
    const cells = table?.querySelectorAll('tbody tr')[0].querySelectorAll('td');
    expect([...(cells ?? [])].map((cell) => cell.textContent)).toEqual([
      longName,
      '$0.10',
      '2.1M',
      '2',
    ]);
    expect(cells?.[2].getAttribute('aria-label')).toBe('2.1M · 100%');
  });

  it('places the ranking heading outside its bordered table like the design', () => {
    const document = render();
    const heading = document.querySelector('h4');
    expect(heading?.textContent).toBe('By model');
    expect(heading?.closest('[data-slot="usage-ranking-frame"]')).toBeNull();
    expect(document.querySelector('[data-slot="usage-ranking-frame"] table')).not.toBeNull();
  });

  it('retains empty and unpriced rows without manufacturing values', () => {
    const document = render();
    expect(document.querySelectorAll('tbody tr')[1].textContent).toContain('(no project)');
    expect(document.querySelectorAll('tbody tr')[1].textContent).toContain('—');
    expect(render([]).body.textContent).toContain('No usage');
  });
});
