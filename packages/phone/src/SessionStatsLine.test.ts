import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SessionStatsLine } from './SessionStatsLine';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
it('shows the real token total once with the compact phone units', () => {
  const html = renderToStaticMarkup(
    createElement(SessionStatsLine, {
      usageTotals: {
        inputTokens: 10000,
        outputTokens: 2400,
        cacheHitPercent: 92,
        tokensPerSecond: 42,
      },
      context: { used: 38000, window: 100000 },
    })
  );
  expect(html).toContain('12.4k');
  expect(html).toContain('42 t/s');
  expect(html).toContain('38%');
  expect(html).not.toContain('↑');
});
it('does not invent statistics when the desktop has not provided any', () => {
  const html = renderToStaticMarkup(createElement(SessionStatsLine, {}));
  expect(html).not.toContain('0%');
  expect(html).not.toContain(' t/s');
});
