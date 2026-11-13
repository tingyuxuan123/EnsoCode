import { expect, it } from 'vitest';
import { collectContextOccupancy } from './contextOccupancy';
import { MICROCOMPACT_PLACEHOLDER } from './microcompact';

it('上下文面板从持久编辑还原清理量，正文 token 桶不混入字符计数', () => {
  const base = {
    systemPrompt: '',
    agentsFiles: [],
    skills: [],
    tools: [],
    contextMessages: [],
    currentModelFamily: 'fixture',
  };
  const empty = collectContextOccupancy({ ...base, branch: [] });
  expect(empty.microcompact).toBeUndefined();
  const occupancy = collectContextOccupancy({
    ...base,
    branch: [
      {
        type: 'message',
        id: 'read-1',
        message: {
          role: 'toolResult',
          toolCallId: 'read-call',
          toolName: 'read',
          content: [{ type: 'text', text: 'x'.repeat(2000) }],
        },
      },
      {
        type: 'context_edit',
        id: 'edit-1',
        targetId: 'read-1',
        replacement: { content: [{ type: 'text', text: MICROCOMPACT_PLACEHOLDER }] },
      },
    ],
  });
  expect(occupancy.microcompact).toEqual({
    results: 1,
    charsRemoved: 2000 - MICROCOMPACT_PLACEHOLDER.length,
  });
  expect(occupancy.buckets).toEqual(empty.buckets);
  expect(occupancy.used).toBe(empty.used);
});
