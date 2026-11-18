import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en',
  }),
}));

import { WorkingStatus } from './WorkingStatus';

describe('WorkingStatus', () => {
  it('renders a compact live status with the nine-dot presence indicator', () => {
    const document = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: false,
          phase: 'thinking',
          since: Date.now(),
        })
      )
    ).document;
    const status = document.querySelector('[data-slot="working-status"]');
    const live = status?.querySelector('[role="status"]');
    const elapsed = status?.querySelector('[data-working-elapsed]');

    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    expect(live?.textContent).toContain('Thinking…');
    expect(status?.querySelectorAll('.codekiln-working-dot')).toHaveLength(9);
    expect(elapsed).not.toBeNull();
    expect(elapsed?.getAttribute('aria-hidden')).toBe('true');
    expect(status?.querySelector('.t-shimmer')).toBeNull();
  });

  it('uses phase-specific labels and omits a duration while loading', () => {
    const writing = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: false,
          phase: 'writing',
          since: Date.now(),
        })
      )
    ).document.querySelector('[data-slot="working-status"]');
    expect(writing?.textContent).toContain('Writing reply…');

    const loading = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: true,
          phase: 'working',
        })
      )
    ).document.querySelector('[data-slot="working-status"]');
    expect(loading?.textContent).toContain('Loading…');
    expect(loading?.querySelector('[data-working-elapsed]')).toBeNull();
  });
});
