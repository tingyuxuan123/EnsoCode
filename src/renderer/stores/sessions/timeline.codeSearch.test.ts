import type { ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { TOOL_LABEL_KEYS } from '@/lib/toolLabels';
import { buildTimeline, foldTimeline, isReadOnlyTool } from './timeline';

const search = (arguments_: Record<string, unknown>, id = 'search'): ProjectedMessage => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name: 'code_search', arguments: arguments_ }],
});

describe('代码搜索时间线', () => {
  it('工具名可翻译', () => {
    expect(TOOL_LABEL_KEYS.code_search).toBe('Code search');
  });
  it('摘要优先显示查询而不是目录或上传片段', () => {
    expect(
      buildTimeline([search({ path: '/repo', query: '认证入口', snippets: ['secret'] })], true)
    ).toEqual([
      expect.objectContaining({ kind: 'tool', name: 'code_search', summary: '认证入口' }),
    ]);
  });

  it('搜索归为只读探索', () => {
    expect(isReadOnlyTool({ name: 'code_search', summary: '认证入口' })).toBe(true);
  });
  it('折组按搜索计数', () => {
    const rows = buildTimeline(
      [
        search({ query: '认证入口' }),
        { role: 'toolResult', toolCallId: 'search', content: [{ type: 'text', text: 'found' }] },
        search({ query: '退出入口' }, 'search2'),
        { role: 'toolResult', toolCallId: 'search2', content: [{ type: 'text', text: 'found' }] },
      ],
      false
    );
    expect(foldTimeline(rows, false, new Set(), { compact: true })).toEqual([
      expect.objectContaining({
        kind: 'tool-group',
        stats: { commands: 0, reads: 0, searches: 2, others: 0 },
      }),
    ]);
  });
});
