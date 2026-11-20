// @vitest-environment happy-dom
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en',
  }),
}));

import { WorkingStatus } from './WorkingStatus';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkingStatus', () => {
  it('renders a capsule status with the Enso orbital icon, shimmering label, and hidden timer', () => {
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
    const label = live?.querySelector('.codekiln-working-label');
    const elapsed = status?.querySelector('[data-working-elapsed]');

    expect(status?.className).toContain('rounded-full');
    expect(status?.getAttribute('data-phase')).toBe('thinking');
    expect(status?.querySelector('.codekiln-working-icon')?.getAttribute('data-phase')).toBe(
      'thinking'
    );
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    expect(label?.textContent).toBe('Thinking…');
    expect(label?.getAttribute('data-text')).toBe('Thinking…');
    expect(label?.classList.contains('t-shimmer')).toBe(true);
    expect(label?.classList.contains('codekiln-working-label-swap')).toBe(false);
    expect(elapsed).not.toBeNull();
    expect(elapsed?.getAttribute('aria-hidden')).toBe('true');
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
    expect(writing?.getAttribute('data-phase')).toBe('writing');
    expect(writing?.textContent).toContain('Writing reply…');

    const loading = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: true,
          phase: 'working',
        })
      )
    ).document.querySelector('[data-slot="working-status"]');
    expect(loading?.getAttribute('data-phase')).toBe('loading');
    expect(loading?.textContent).toContain('Loading…');
    expect(loading?.querySelector('[data-working-elapsed]')).toBeNull();
  });

  it('triggers the text-swap transition on phase change without remounting the icon or live container', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const since = Date.now();

    try {
      await act(async () =>
        root.render(
          createElement(WorkingStatus, {
            loading: false,
            phase: 'thinking',
            since,
          })
        )
      );

      const icon = container.querySelector('.codekiln-working-icon');
      const live = container.querySelector('[role="status"]');
      const initialLabel = container.querySelector('.codekiln-working-label');
      expect(initialLabel?.classList.contains('codekiln-working-label-swap')).toBe(false);

      await act(async () =>
        root.render(
          createElement(WorkingStatus, {
            loading: false,
            phase: 'tool',
            since,
          })
        )
      );

      expect(container.querySelector('.codekiln-working-icon')).toBe(icon);
      expect(container.querySelector('[role="status"]')).toBe(live);
      const nextLabel = container.querySelector('.codekiln-working-label');
      expect(nextLabel?.textContent).toBe('Running…');
      expect(nextLabel?.getAttribute('data-text')).toBe('Running…');
      expect(nextLabel?.classList.contains('codekiln-working-label-swap')).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
