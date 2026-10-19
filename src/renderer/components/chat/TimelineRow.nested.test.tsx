import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { TimelineRow } from './TimelineRow';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({ compactReadOnlyTools: false, expandLiveEdits: false, expandLiveReasoning: false }),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));

const tool = (overrides: Partial<Extract<TimelineItem, { kind: 'tool' }>>) =>
  ({
    kind: 'tool',
    key: 't',
    name: 'bash',
    summary: 'ls',
    output: null,
    state: 'ok',
    edits: null,
    writeContent: null,
    todos: null,
    agentMeta: null,
    startedAt: null,
    durationMs: 100,
    ...overrides,
  }) as Extract<TimelineItem, { kind: 'tool' }>;

describe('组内紧凑行', () => {
  it('普通 bash 行渲染成紧凑行：无工具名标签、等宽正文', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, { item: tool({ nested: true, summary: 'ls src' }) })
    );
    expect(html).toContain('group/nested');
    expect(html).not.toContain('>bash<');
    expect(html).toContain('font-mono');
  });

  it('带 diff 的 edit 行即使被标成 nested 也走完整行，diff 入口不丢', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: tool({
          name: 'edit',
          summary: 'src/a.ts',
          nested: true,
          edits: [{ oldText: 'a', newText: 'b' }],
        }),
      })
    );
    expect(html).toContain('data-tool-style=');
    expect(html).not.toContain('group/nested');
  });

  it('失败行直接给出错误首行，不用展开', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: tool({
          nested: true,
          state: 'error',
          output: 'ENOENT: no such file\nsecond line\nthird',
        }),
      })
    );
    expect(html).toContain('ENOENT: no such file');
    expect(html).toContain('text-destructive');
  });
});
