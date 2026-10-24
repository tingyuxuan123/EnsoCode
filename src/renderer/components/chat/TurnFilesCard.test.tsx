import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TurnFilesCard, TurnFilesContext, TurnFilesFooter } from './TurnFilesCard';
import type { TurnFileSummary } from './turnFileChanges';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));
vi.mock('@/lib/sidePanelDock', () => ({ openSidePanelFile: vi.fn() }));

const summary = (count: number): TurnFileSummary => {
  const files = Array.from({ length: count }, (_, i) => ({
    path: `src/dir${i}/file${i}.ts`,
    added: 10 - i,
    removed: i === 0 ? 2 : 0,
  }));
  return {
    added: files.reduce((s, f) => s + f.added, 0),
    removed: files.reduce((s, f) => s + f.removed, 0),
    files,
  };
};

describe('TurnFilesCard', () => {
  it('标题给出文件数与总增删；默认只列前 3 个，其余收进「还有 N 个文件」', () => {
    const html = renderToStaticMarkup(
      createElement(TurnFilesCard, { conversationId: 'c', summary: summary(7) })
    );
    expect(html).toContain('7 files changed');
    expect(html).toContain('+49');
    expect(html).toContain('-2');
    expect(html.match(/data-turn-file=/g)).toHaveLength(3);
    expect(html).toContain('4 more files');
    expect(html).toContain('src/dir0/');
    expect(html).toContain('file0.ts');
    expect(html).not.toContain('file3.ts');
  });

  it('不超过 3 个文件时没有「还有」入口', () => {
    const html = renderToStaticMarkup(
      createElement(TurnFilesCard, { conversationId: 'c', summary: summary(2) })
    );
    expect(html).not.toContain('data-turn-files-more');
    expect(html.match(/data-turn-file=/g)).toHaveLength(2);
  });

  it('Footer 只在主聊天提供数据、且该轮有改动时渲染', () => {
    expect(renderToStaticMarkup(createElement(TurnFilesFooter, { messageIndex: 5 }))).toBe('');
    const withData = (index: number) =>
      renderToStaticMarkup(
        createElement(
          TurnFilesContext.Provider,
          { value: { conversationId: 'c', summaries: new Map([[5, summary(1)]]) } },
          createElement(TurnFilesFooter, { messageIndex: index })
        )
      );
    expect(withData(5)).toContain('data-turn-files');
    expect(withData(6)).toBe('');
  });
});
