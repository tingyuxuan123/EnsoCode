import type { ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { buildTimeline, canRenderNestedRow, foldTimeline, isCoreToolRow } from './timeline';

const id = '12345678-1234-4123-8123-123456789abc';
const image = { id, path: `.xiaoman/images/${id}.png`, mimeType: 'image/png' };
const messages: ProjectedMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'draw a cat' }] },
  {
    role: 'assistant',
    content: [
      { type: 'toolCall', id: 'gen1', name: 'generate_image', arguments: { prompt: 'cat' } },
    ],
  },
  {
    role: 'toolResult',
    toolCallId: 'gen1',
    toolName: 'generate_image',
    content: [{ type: 'text', text: JSON.stringify({ ok: true, image }) }],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
];

describe('生图时间线', () => {
  it.each(['generate_image', 'edit_image'])(
    '%s 运行时保留完整产物行，不压成丢失动画的组内摘要',
    (name) => {
      const pending = structuredClone(messages.slice(0, 2));
      pending[1].content = [{ type: 'toolCall', id: 'gen1', name, arguments: { prompt: 'cat' } }];
      const tool = buildTimeline(pending, true, [], '/workspace').find(
        (row) => row.kind === 'tool'
      );
      expect(tool?.state).toBe('running');
      expect(tool?.imagePath).toBeUndefined();
      expect(isCoreToolRow(tool!)).toBe(true);
      expect(canRenderNestedRow(tool!)).toBe(false);
      for (const collapseCompletedActivity of [false, true]) {
        const rows = foldTimeline(buildTimeline(pending, true, [], '/workspace'), true, new Set(), {
          collapseCompletedActivity,
        });
        expect(rows.some((row) => row.kind === 'tool' && row.name === name)).toBe(true);
      }
    }
  );
  it('从权威历史结果重建图片路径，无需内存图片缓存', () => {
    const rows = buildTimeline(messages, false, [], '/workspace');
    expect(rows.find((row) => row.kind === 'tool')?.imagePath).toBe(`/workspace/${image.path}`);
    const windows = buildTimeline(messages, false, [], 'C:\\workspace');
    expect(windows.find((row) => row.kind === 'tool')?.imagePath).toBe(
      `C:\\workspace\\${image.path}`
    );
  });
  it('收起工作日志不隐藏用户实际要的图片', () => {
    const rows = buildTimeline(messages, false, [], '/workspace');
    const folded = foldTimeline(rows, false, new Set(), { collapseCompletedActivity: true });
    expect(
      folded.some((row) => row.kind === 'tool' && row.name === 'generate_image' && row.imagePath)
    ).toBe(true);
  });
  it('失败结果或缺 cwd 时不渲染任意路径', () => {
    expect(
      buildTimeline(messages, false).find((row) => row.kind === 'tool')?.imagePath
    ).toBeUndefined();
    const bad = structuredClone(messages);
    bad[2].isError = true;
    expect(
      buildTimeline(bad, false, [], '/workspace').find((row) => row.kind === 'tool')?.imagePath
    ).toBeUndefined();
  });
});
