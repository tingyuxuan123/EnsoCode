// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { MessageTimeline } from './MessageTimeline';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en' as const,
  }),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({
      autoCollapseTurns: false,
      collapseCompletedActivity: false,
      compactReadOnlyTools: false,
    }),
}));

vi.mock('./NavRail', () => ({
  NavRail: () => null,
}));

vi.mock('./WelcomeSuggestions', () => ({
  WelcomeSuggestions: () => null,
}));

vi.mock('./TimelineRow', () => ({
  isNestedRow: () => false,
  ReplyHeader: () => null,
  RetryTurnButton: () => null,
  TimelineRow: ({ item }: { item: TimelineItem }) => createElement('div', null, item.key),
}));

// Emulate Virtuoso rendering Header/Footer as React component types via createElement:
// inline render functions passed as components.Footer will unmount/remount on every render.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
    components,
    firstItemIndex,
  }: {
    data: TimelineItem[];
    itemContent: (index: number, item: TimelineItem) => ReactNode;
    components: {
      Header?: () => ReactNode;
      Footer?: () => ReactNode;
    };
    firstItemIndex: number;
  }) =>
    createElement(
      'div',
      { 'data-mock-virtuoso': '' },
      components.Header ? createElement(components.Header) : null,
      createElement(
        'div',
        { 'data-mock-list': '' },
        ...data.map((item, index) =>
          createElement('div', { key: item.key }, itemContent(firstItemIndex + index, item))
        )
      ),
      components.Footer ? createElement(components.Footer) : null
    ),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const userRow: Extract<TimelineItem, { kind: 'user' }> = {
  kind: 'user',
  key: 'u-1',
  text: 'check status',
  images: [],
};

describe('MessageTimeline footer stability', () => {
  it('keeps WorkingStatus and its icon mounted across streaming phase and item updates', async () => {
    const startedAt = Date.now() - 1000;
    const thinkingRow: Extract<TimelineItem, { kind: 'thinking' }> = {
      kind: 'thinking',
      key: 't-1',
      text: 'Thinking...',
      streaming: true,
      durationMs: null,
    };

    await act(async () =>
      root.render(
        createElement(MessageTimeline, {
          items: [userRow, thinkingRow],
          busy: true,
          running: true,
          runStartedAt: startedAt,
          lastOutputAt: startedAt,
          emptyTitle: 'CodeKiln',
        })
      )
    );

    const initialRow = container.querySelector('[data-slot="working-status"]');
    const initialIcon = initialRow?.querySelector('[role="img"]');
    expect(initialRow).not.toBeNull();
    expect(initialIcon).not.toBeNull();
    expect(initialRow?.querySelector('[role="status"]')?.textContent).toBe('Thinking…');

    const toolRow: Extract<TimelineItem, { kind: 'tool' }> = {
      kind: 'tool',
      key: 'tool-1',
      name: 'bash',
      summary: 'ls',
      output: null,
      state: 'running',
      edits: null,
      writeContent: null,
      todos: null,
      durationMs: null,
      agentMeta: null,
    };

    await act(async () =>
      root.render(
        createElement(MessageTimeline, {
          items: [userRow, { ...thinkingRow, streaming: false }, toolRow],
          busy: true,
          running: true,
          runStartedAt: startedAt,
          lastOutputAt: startedAt + 3000,
          emptyTitle: 'CodeKiln',
        })
      )
    );

    const updatedRow = container.querySelector('[data-slot="working-status"]');
    const updatedIcon = updatedRow?.querySelector('[role="img"]');
    expect(updatedRow).toBe(initialRow);
    expect(updatedIcon).toBe(initialIcon);
    expect(updatedRow?.querySelector('[role="status"]')?.textContent).toBe('Running…');
  });
});
