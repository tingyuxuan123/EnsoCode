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

describe('分组展开的子项', () => {
  it('子项不带图标，只留类型词与弱化摘要（对齐 ZCode）', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, { item: tool({ nested: true, summary: 'ls src' }) })
    );
    expect(html).toContain('data-tool-nested=""');
    expect(html).toContain('>Terminal<');
    expect(html).toContain('ls src');
    expect(html).not.toContain('lucide-square-terminal');
  });

  it('顶层行带 16px 图标，命令用普通字体', () => {
    const html = renderToStaticMarkup(createElement(TimelineRow, { item: tool({}) }));
    expect(html).toContain('lucide-square-terminal');
    expect(html).not.toContain('font-mono');
  });

  it('带 diff 的 edit 行尾部显示 +N/-N', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, {
        item: tool({
          name: 'edit',
          summary: 'src/a.ts',
          edits: [{ oldText: 'a', newText: 'b\nc' }],
        }),
      })
    );
    expect(html).toContain('>Edited<');
    expect(html).toContain('aria-label="2"');
    expect(html).toContain('aria-label="1"');
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
    expect(html).not.toContain('second line');
    expect(html).toContain('text-destructive');
  });

  it('运行中类型词换成「正在执行」并扫光', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, { item: tool({ state: 'running' }) })
    );
    expect(html).toContain('t-shimmer');
    expect(html).toContain('>Executing<');
  });
});
