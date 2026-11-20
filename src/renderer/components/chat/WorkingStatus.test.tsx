// @vitest-environment happy-dom
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en' as const,
  }),
}));

import { WorkingStatus } from './WorkingStatus';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkingStatus', () => {
  it('renders a borderless inline status row with the blooming spark, musing text, screen-reader live region, and quiet timer', () => {
    const document = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: false,
          phase: 'thinking',
          since: Date.now(),
          random: () => 0,
        })
      )
    ).document;
    const status = document.querySelector('[data-slot="working-status"]');
    const live = status?.querySelector('[role="status"]');
    const label = status?.querySelector('.codekiln-working-label');
    const elapsed = status?.querySelector('[data-working-elapsed]');

    expect(status?.className).not.toContain('rounded-full');
    expect(status?.className).not.toContain('bg-card');
    expect(status?.getAttribute('data-phase')).toBe('thinking');
    expect(status?.querySelector('.codekiln-working-icon')?.getAttribute('data-phase')).toBe(
      'thinking'
    );
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-atomic')).toBe('true');
    expect(live?.textContent).toBe('Thinking…');
    expect(label?.getAttribute('data-musing-phrase')).toBe('Connecting the threads');
    expect(label?.textContent).toBe('Connecting the threads...');
    expect(elapsed).not.toBeNull();
    expect(elapsed?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws contextual musing phrases when a recent step cue is provided', () => {
    const document = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: false,
          phase: 'working',
          cue: { topic: 'commandFailed', name: 'pnpm test' },
          since: Date.now(),
          random: () => 0,
        })
      )
    ).document;
    const label = document.querySelector('.codekiln-working-label');
    expect(label?.getAttribute('data-musing-phrase')).toContain('pnpm test');
  });

  it('shows fixed labels for loading, compacting, and approval review, omitting duration while loading', () => {
    const loading = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: true,
          phase: 'working',
        })
      )
    ).document.querySelector('[data-slot="working-status"]');
    expect(loading?.getAttribute('data-phase')).toBe('loading');
    expect(loading?.querySelector('[role="status"]')?.textContent).toBe('Loading…');
    expect(
      loading?.querySelector('.codekiln-working-label')?.getAttribute('data-musing-phrase')
    ).toBe('Loading');
    expect(loading?.querySelector('[data-working-elapsed]')).toBeNull();

    const compacting = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: false,
          phase: 'working',
          compacting: true,
          since: Date.now(),
        })
      )
    ).document.querySelector('[data-slot="working-status"]');
    expect(
      compacting?.querySelector('.codekiln-working-label')?.getAttribute('data-musing-phrase')
    ).toBe('Compacting');

    const waiting = parseHTML(
      renderToStaticMarkup(
        createElement(WorkingStatus, {
          loading: false,
          phase: 'tool',
          waitingForApproval: true,
          since: Date.now(),
        })
      )
    ).document.querySelector('[data-slot="working-status"]');
    expect(
      waiting?.querySelector('.codekiln-working-label')?.getAttribute('data-musing-phrase')
    ).toBe('Waiting for you to handle it');
  });

  it('updates phase announcements and cue phrases without remounting the spark icon or live region', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const since = Date.now();

    try {
      await act(async () =>
        root.render(
          createElement(WorkingStatus, {
            loading: true,
            phase: 'working',
            since,
            random: () => 0,
          })
        )
      );

      const icon = container.querySelector('.codekiln-working-icon');
      const live = container.querySelector('[role="status"]');
      expect(live?.textContent).toBe('Loading…');
      expect(
        container.querySelector('.codekiln-working-label')?.getAttribute('data-musing-phrase')
      ).toBe('Loading');

      await act(async () =>
        root.render(
          createElement(WorkingStatus, {
            loading: false,
            phase: 'tool',
            cue: { topic: 'commandRunning', name: 'pnpm test' },
            since,
            random: () => 0,
          })
        )
      );

      expect(container.querySelector('.codekiln-working-icon')).toBe(icon);
      expect(container.querySelector('[role="status"]')).toBe(live);
      expect(live?.textContent).toBe('Running…');
      expect(
        container.querySelector('.codekiln-working-label')?.getAttribute('data-musing-phrase')
      ).toContain('pnpm test');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('cycles to a different rolling phrase once the current typing + dots cycle completes', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let now = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const frames: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () =>
        root.render(
          createElement(WorkingStatus, {
            loading: false,
            phase: 'working',
            since: Date.now(),
            random: () => 0,
          })
        )
      );

      const firstPhrase = container
        .querySelector('.codekiln-working-label')
        ?.getAttribute('data-musing-phrase');
      expect(firstPhrase).toBe('Connecting the threads');

      // Advance past one full typing + caret rest + 2 dot rounds + clear cycle (~5.5s).
      now += 6500;
      await act(async () => {
        const nextFrame = frames.pop();
        nextFrame?.(now);
      });

      const secondPhrase = container
        .querySelector('.codekiln-working-label')
        ?.getAttribute('data-musing-phrase');
      expect(secondPhrase).toBeTruthy();
      expect(secondPhrase).not.toBe(firstPhrase);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      nowSpy.mockRestore();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
    }
  });

  it('renders static readable text without scheduling animation frames under reduced motion', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () =>
        root.render(
          createElement(WorkingStatus, {
            loading: false,
            phase: 'working',
            since: Date.now(),
            random: () => 0,
          })
        )
      );

      expect(rafSpy).not.toHaveBeenCalled();
      const firstChar = container.querySelector('.codekiln-working-label > span') as HTMLElement;
      expect(firstChar?.style.opacity).toBe('1');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      matchMediaSpy.mockRestore();
      rafSpy.mockRestore();
    }
  });

  it('never interrupts the active phrase or rAF loop across thinking/tool phase and cue changes, picking the newest cue only on natural cycle end', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let now = 1000;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const frames: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const since = Date.now();

    try {
      await act(async () =>
        root.render(
          createElement(WorkingStatus, {
            loading: false,
            phase: 'tool',
            cue: { topic: 'commandRunning', name: 'cat' },
            since,
            random: () => 0,
          })
        )
      );

      const initialPhrase = container
        .querySelector('.codekiln-working-label')
        ?.getAttribute('data-musing-phrase');
      expect(initialPhrase).toContain('cat');
      const initialCancelCount = cafSpy.mock.calls.length;

      // Rapidly alternate thinking -> tool finished -> thinking -> another tool -> writing:
      // neither the active phrase nor the rAF loop may be aborted mid-flight.
      for (const next of [
        { phase: 'working' as const, cue: { topic: 'command' as const, name: 'cat' } },
        { phase: 'thinking' as const, cue: { topic: 'command' as const, name: 'cat' } },
        { phase: 'tool' as const, cue: { topic: 'commandRunning' as const, name: 'ls' } },
        { phase: 'thinking' as const, cue: { topic: 'read' as const, name: 'App.tsx' } },
        { phase: 'writing' as const, cue: null },
        { phase: 'thinking' as const, cue: { topic: 'edit' as const, name: 'WorkingStatus.tsx' } },
      ]) {
        await act(async () =>
          root.render(
            createElement(WorkingStatus, {
              loading: false,
              phase: next.phase,
              cue: next.cue,
              since,
              random: () => 0,
            })
          )
        );
        expect(
          container.querySelector('.codekiln-working-label')?.getAttribute('data-musing-phrase')
        ).toBe(initialPhrase);
        expect(cafSpy.mock.calls.length).toBe(initialCancelCount);
      }

      // Once the active phrase naturally finishes its cycle, the next phrase picks up the latest cue.
      now += 6500;
      await act(async () => {
        const nextFrame = frames.pop();
        nextFrame?.(now);
      });

      const nextPhrase = container
        .querySelector('.codekiln-working-label')
        ?.getAttribute('data-musing-phrase');
      expect(nextPhrase).toContain('WorkingStatus.tsx');
    } finally {
      await act(async () => root.unmount());
      container.remove();
      nowSpy.mockRestore();
      rafSpy.mockRestore();
      cafSpy.mockRestore();
    }
  });
});
