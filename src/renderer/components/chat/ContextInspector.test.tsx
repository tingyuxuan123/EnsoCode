import type { ContextOccupancy } from '@shared/types/agent';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContextInspector } from './ContextInspector';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(params[token])) : key,
  }),
}));

vi.mock('@/stores/sessions', () => {
  const useSessionsStore = Object.assign(
    (selector: (state: { conversations: Record<string, unknown> }) => unknown) =>
      selector({ conversations: {} }),
    { getState: () => ({ compact: vi.fn(), forkFromEntry: vi.fn() }) }
  );
  return { useSessionsStore };
});

const buckets = {
  system: 100,
  instructions: 0,
  skills: 0,
  tools: 0,
  conversation: 50,
  compaction: 0,
  projectMemory: 0,
  reminders: 0,
};

function occupancy(patch: Record<string, unknown> = {}): ContextOccupancy {
  return {
    buckets,
    used: 150,
    estimated: false,
    compactedMessageCount: 0,
    compactionModelMismatch: false,
    ...patch,
  } as unknown as ContextOccupancy;
}

describe('ContextInspector microcompaction 统计', () => {
  it('展示当前分支已清除的结果数与字符数', () => {
    const html = renderToStaticMarkup(
      createElement(ContextInspector, {
        occupancy: occupancy({ microcompact: { results: 3, charsRemoved: 1500 } }),
      })
    );
    expect(html).toContain('Microcompaction: 3 results cleared · 1500 characters removed');
    // 只陈述已清除的量，不给 token / 成本节省结论
    expect(html).not.toMatch(/sav(e|ed|ing)/i);
    expect(html).not.toMatch(/cost/i);
  });

  it('缺少统计或没有清除时不编造 0', () => {
    const absent = renderToStaticMarkup(
      createElement(ContextInspector, { occupancy: occupancy() })
    );
    expect(absent).not.toContain('Microcompaction');
    const zero = renderToStaticMarkup(
      createElement(ContextInspector, {
        occupancy: occupancy({ microcompact: { results: 0, charsRemoved: 0 } }),
      })
    );
    expect(zero).not.toContain('Microcompaction');
  });
});
