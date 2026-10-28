import type { ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { buildTimeline, type TimelineItem } from '@/stores/sessions/timeline';
import { turnFileChanges } from './turnFileChanges';

type Tool = Extract<TimelineItem, { kind: 'tool' }>;

const tool = (key: string, extra: Partial<Tool>): TimelineItem =>
  ({
    kind: 'tool',
    key,
    name: 'edit',
    summary: 'src/a.ts',
    output: 'ok',
    state: 'ok',
    edits: null,
    writeContent: null,
    todos: null,
    agentMeta: null,
    durationMs: 1,
    ...extra,
  }) as Tool;
const user = (key: string): TimelineItem =>
  ({ kind: 'user', key, text: 'u', images: [] }) as TimelineItem;
const reply = (key: string, turnEnd = true): TimelineItem =>
  ({
    kind: 'text',
    key,
    text: 'done',
    streaming: false,
    ...(turnEnd ? { turnEnd } : {}),
  }) as TimelineItem;

describe('turnFileChanges', () => {
  it('多步执行期间不闪现卡片，整轮结束后才在最终回复汇总所有改动', () => {
    const messages: ProjectedMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '修改并校验' }] },
      {
        role: 'assistant',
        stopReason: 'toolUse',
        content: [
          {
            type: 'toolCall',
            id: 'write',
            name: 'write',
            arguments: { path: 'src/a.ts', content: 'hello\n' },
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'write',
        toolName: 'write',
        content: [{ type: 'text', text: 'ok' }],
      },
      {
        role: 'assistant',
        stopReason: 'toolUse',
        content: [
          { type: 'text', text: '已修改，继续校验' },
          { type: 'toolCall', id: 'check', name: 'bash', arguments: { command: 'pnpm test' } },
        ],
      },
    ];
    expect(turnFileChanges(buildTimeline(messages, true)).size).toBe(0);
    messages.push({
      role: 'toolResult',
      toolCallId: 'check',
      toolName: 'bash',
      content: [{ type: 'text', text: 'passed' }],
    });
    expect(turnFileChanges(buildTimeline(messages, true)).size).toBe(0);
    messages.push({
      role: 'assistant',
      stopReason: 'stop',
      content: [{ type: 'text', text: '修改完成，校验通过' }],
    });
    expect(turnFileChanges(buildTimeline(messages, true)).size).toBe(0);
    expect([...turnFileChanges(buildTimeline(messages, false))]).toEqual([
      [5, { added: 1, removed: 0, files: [{ path: 'src/a.ts', added: 1, removed: 0 }] }],
    ]);
  });

  it('按本轮结尾的消息下标聚合：同一文件多次改动合并，按改动量降序', () => {
    const items = [
      user('0'),
      tool('1-0', { summary: 'src/a.ts', edits: [{ oldText: 'a', newText: 'b\nc' }] }),
      tool('1-1', { name: 'write', summary: 'docs/new.md', writeContent: 'x\ny\nz\n' }),
      tool('3-0', { summary: 'src/a.ts', edits: [{ oldText: '', newText: 'd' }] }),
      reply('5-0'),
    ];
    const summary = turnFileChanges(items).get(5);
    expect(summary).toEqual({
      added: 6,
      removed: 1,
      files: [
        { path: 'src/a.ts', added: 3, removed: 1 },
        { path: 'docs/new.md', added: 3, removed: 0 },
      ],
    });
  });

  it('apply_patch 按每个落盘文件分别计入；改动量相同时按路径排', () => {
    const items = [
      user('0'),
      tool('1-0', {
        name: 'apply_patch',
        summary: '2 files',
        fileChanges: [
          { path: '/repo/src/x.ts', oldText: 'a', newText: 'b', type: 'update' },
          { path: '/repo/src/y.ts', oldText: '', newText: 'n\nm', type: 'add' },
        ],
      }),
      reply('2-0'),
    ];
    expect(turnFileChanges(items, '/repo').get(2)?.files).toEqual([
      { path: 'src/x.ts', added: 1, removed: 1 },
      { path: 'src/y.ts', added: 2, removed: 0 },
    ]);
  });

  it('失败或未完成的工具、非改动工具、没改文件的轮次都不产生卡片', () => {
    const items = [
      user('0'),
      tool('1-0', { state: 'error', edits: [{ oldText: 'a', newText: 'b' }] }),
      tool('1-1', { state: 'running', edits: [{ oldText: 'a', newText: 'b' }] }),
      tool('1-2', { name: 'bash', summary: 'pnpm test' }),
      reply('2-0'),
      user('3'),
      reply('4-0'),
    ];
    const result = turnFileChanges(items);
    expect(result.get(2)).toBeUndefined();
    expect(result.get(4)).toBeUndefined();
  });

  it('每轮独立：上一轮的改动不算进下一轮；未结束的轮没有卡片', () => {
    const items = [
      user('0'),
      tool('1-0', { summary: 'a.ts', edits: [{ oldText: '', newText: 'x' }] }),
      reply('2-0'),
      user('3'),
      tool('4-0', { summary: 'b.ts', edits: [{ oldText: '', newText: 'y' }] }),
      reply('5-0', false),
    ];
    const result = turnFileChanges(items);
    expect(result.get(2)?.files.map((file) => file.path)).toEqual(['a.ts']);
    expect(result.get(5)).toBeUndefined();
  });

  it('折叠后组内的工具也算：读 tool-group 的 children', () => {
    const nested = tool('1-0', { summary: 'a.ts', edits: [{ oldText: '', newText: 'x' }] });
    const items = [
      user('0'),
      {
        kind: 'tool-group',
        key: 'g',
        expanded: false,
        count: 1,
        children: [nested],
      } as unknown as TimelineItem,
      reply('2-0'),
    ];
    expect(turnFileChanges(items).get(2)?.added).toBe(1);
  });
});
