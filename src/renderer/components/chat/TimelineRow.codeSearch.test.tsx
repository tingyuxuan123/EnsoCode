import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { TimelineRow } from './TimelineRow';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (state: object) => unknown) =>
    select({ compactReadOnlyTools: false, expandLiveEdits: false }),
}));
vi.mock('@/stores/sessions', () => ({ useSessionsStore: () => null }));
vi.mock('./Markdown', () => ({ Markdown: () => null }));
vi.mock('./EditDiff', () => ({ EditDiff: () => null }));
vi.mock('./ReadFileView', () => ({ ReadFileView: () => null }));

describe('代码搜索行', () => {
  it.each(['ok', 'running'] as const)('状态 %s 用搜索图标及对应搜索类型词', (state) => {
    const item: Extract<TimelineItem, { kind: 'tool' }> = {
      kind: 'tool',
      key: 'search',
      name: 'code_search',
      summary: '认证入口',
      output: null,
      state,
      edits: null,
      writeContent: null,
      todos: null,
      agentMeta: null,
      durationMs: null,
    };
    const html = renderToStaticMarkup(<TimelineRow item={item} />);
    expect(html).toContain('lucide-search');
    expect(html).toContain(state === 'ok' ? '>Search<' : '>Searching<');
    expect(html).toContain('认证入口');
  });
});
