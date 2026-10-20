import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { TimelineRow } from './TimelineRow';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? '')),
  }),
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({ compactReadOnlyTools: true, expandLiveEdits: true, expandLiveReasoning: true }),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));

type Worklog = NonNullable<Extract<TimelineItem, { kind: 'tool-group' }>['worklog']>;

const worklog = (
  log: Partial<Worklog> = {},
  overrides: Partial<Extract<TimelineItem, { kind: 'tool-group' }>> = {}
): Extract<TimelineItem, { kind: 'tool-group' }> => ({
  kind: 'tool-group',
  key: 'worklog-3',
  expanded: false,
  count: 4,
  stats: { commands: 1, reads: 2, searches: 1, others: 0 },
  exploring: false,
  worklog: {
    status: 'completed',
    forced: false,
    thinking: 2,
    failed: 0,
    durationMs: 12300,
    ...log,
  },
  children: [],
  ...overrides,
});

const render = (item: TimelineItem) => renderToStaticMarkup(createElement(TimelineRow, { item }));

describe('回合工作日志头', () => {
  it('已完成：可点击的「已工作」文字头，收起时附思考与工具计数', () => {
    const html = render(worklog());
    expect(html).toContain('Worked for 12.3s');
    expect(html).toContain('2 thinking steps · 4 tool calls');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('lucide-chevron-right');
  });

  it('展开后不再重复计数', () => {
    const html = render(worklog({}, { expanded: true }));
    expect(html).not.toContain('4 tool calls');
    expect(html).toContain('aria-expanded="true"');
  });

  it('时长未知时不编造 0 秒', () => {
    const html = render(worklog({ durationMs: undefined }));
    expect(html).toContain('>Worked<');
  });

  it('运行中：实时「工作中」，强制展开不可点击', () => {
    const html = render(
      worklog({ status: 'running', forced: true, startedAt: Date.now() - 3000 }, { expanded: true })
    );
    expect(html).toContain('Working for');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('lucide-chevron-right');
  });

  it('中断与失败带终态和用时', () => {
    expect(render(worklog({ status: 'aborted', forced: true, durationMs: 2000 }))).toContain(
      'Stopped after 2s'
    );
    const failed = render(worklog({ status: 'failed', forced: true, durationMs: undefined }));
    expect(failed).toContain('Failed run');
    expect(failed).toContain('text-destructive');
  });

  it('过程里有失败调用时，收起态也显示失败数', () => {
    expect(render(worklog({ failed: 1 }))).toContain('1 calls failed');
  });
});
