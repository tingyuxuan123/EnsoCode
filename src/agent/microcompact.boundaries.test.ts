import { expect, it } from 'vitest';
import {
  collectMicrocompactStats,
  MICROCOMPACT_PLACEHOLDER,
  microcompactExtension,
} from './microcompact';

const NOW = 10_000_000;
const message = (id: string) => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'read',
  timestamp: 10,
  content: [{ type: 'text', text: 'x'.repeat(2000) }],
});
const content = [{ type: 'text', text: MICROCOMPACT_PLACEHOLDER }];

it('统计以编辑前的有效正文计差，不重复归因其它扩展已经清掉的字符', () => {
  expect(
    collectMicrocompactStats([
      { type: 'message', id: 'old', message: message('old') },
      {
        type: 'context_edit',
        targetId: 'old',
        replacement: { content: [{ type: 'text', text: 'x'.repeat(200) }] },
      },
      { type: 'context_edit', targetId: 'old', replacement: { content } },
    ])
  ).toEqual({ results: 1, charsRemoved: 200 - MICROCOMPACT_PLACEHOLDER.length });
});

it('普通摘要压缩移走的旧结果不再显示成当前上下文的微压缩收益', () => {
  const prefix = [
    { type: 'message', id: 'old', message: message('old') },
    { type: 'context_edit', id: 'edit', targetId: 'old', replacement: { content } },
    { type: 'message', id: 'kept', message: { role: 'user', content: 'keep' } },
  ];
  expect(collectMicrocompactStats(prefix).results).toBe(1);
  expect(
    collectMicrocompactStats([
      ...prefix,
      { type: 'compaction', id: 'compact', firstKeptEntryId: 'kept', summary: 'summary' },
    ])
  ).toEqual({ results: 0, charsRemoved: 0 });
});

it('同 toolCallId 同正文但来源条目已换代，不把旧请求的清理写到新条目', async () => {
  type Handler = (event: unknown, ctx: unknown) => unknown;
  const handlers = new Map<string, Handler>();
  const extension = microcompactExtension({ now: () => NOW });
  const factory = typeof extension === 'function' ? extension : extension.factory;
  await factory({ on: (event: string, handler: Handler) => handlers.set(event, handler) } as never);
  const messages = [
    { role: 'assistant', timestamp: NOW - 4_000_000 },
    ...Array.from({ length: 6 }, (_, i) => message(`r${i}`)),
  ];
  const entries = messages.map((m, i) => ({
    sourceEntry: { type: 'message', id: `source-${i}`, message: m },
    messages: [m],
  }));
  const ctx = { sessionManager: { buildSessionProjection: () => ({ entries }) } };
  await handlers.get('context')!({ messages }, ctx);
  const changedEntries = entries.map((entry, i) =>
    i === 1 ? { ...entry, sourceEntry: { ...entry.sourceEntry, id: 'replacement-entry' } } : entry
  );
  const result = (await handlers.get('turn_end')!(
    { outcome: 'completed', entries: [], context: { contextEntries: changedEntries } },
    ctx
  )) as { entries?: unknown[] } | undefined;
  expect(result?.entries ?? []).toEqual([]);
});
