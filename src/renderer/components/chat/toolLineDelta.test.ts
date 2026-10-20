import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@/stores/sessions/timeline';
import { lineDelta, toolLineDelta } from './toolLineDelta';

const tool = (extra: Partial<Extract<TimelineItem, { kind: 'tool' }>>) =>
  ({
    kind: 'tool',
    key: 'k',
    name: 'edit',
    summary: 'a.ts',
    output: null,
    state: 'ok',
    edits: null,
    writeContent: null,
    todos: null,
    agentMeta: null,
    durationMs: null,
    ...extra,
  }) as Extract<TimelineItem, { kind: 'tool' }>;

describe('lineDelta', () => {
  it('按行统计增删', () => {
    expect(lineDelta('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 });
  });

  it('空文本与末尾换行不计空行', () => {
    expect(lineDelta('', 'x\n')).toEqual({ added: 1, removed: 0 });
    expect(lineDelta('x\n', '')).toEqual({ added: 0, removed: 1 });
  });

  it('重复行按次数计', () => {
    expect(lineDelta('a\na', 'a')).toEqual({ added: 0, removed: 1 });
  });
});

describe('toolLineDelta', () => {
  it('edit 多块累加', () => {
    const item = tool({
      edits: [
        { oldText: 'a', newText: 'b' },
        { oldText: '', newText: 'c\nd' },
      ],
    });
    expect(toolLineDelta(item)).toEqual({ added: 3, removed: 1 });
  });

  it('write 按内容行数算新增', () => {
    expect(toolLineDelta(tool({ name: 'write', writeContent: 'x\ny\n' }))).toEqual({
      added: 2,
      removed: 0,
    });
  });

  it('非改动类工具没有计数', () => {
    expect(toolLineDelta(tool({ name: 'bash' }))).toBeNull();
  });
});
