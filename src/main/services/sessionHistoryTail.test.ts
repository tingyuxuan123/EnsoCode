import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as projection from '../../agent/projection';
import {
  projectParentHistoryAll,
  projectParentHistoryPage,
  projectParentHistoryTail,
  resolveParentHistoryFile,
} from './sessionHistoryTail';

const sessionDir = '/tmp/agent/sessions';

describe('resolveParentHistoryFile', () => {
  it('accepts a file inside the sessions directory', () => {
    expect(
      resolveParentHistoryFile(sessionDir, path.join(sessionDir, '2026-01-01T00-00-00-000Z.jsonl'))
    ).toBe(path.resolve(sessionDir, '2026-01-01T00-00-00-000Z.jsonl'));
  });

  it('rejects traversal and missing files', () => {
    expect(
      resolveParentHistoryFile(sessionDir, path.join(sessionDir, '../escape.jsonl'))
    ).toBeNull();
    expect(resolveParentHistoryFile(sessionDir, undefined)).toBeNull();
    expect(resolveParentHistoryFile(sessionDir, '')).toBeNull();
  });
});

const makeBranch = (count: number, text = (i: number) => `m${i}`) =>
  Array.from({ length: count }, (_, i) => ({
    type: 'message',
    message: { role: 'user', content: [{ type: 'text', text: text(i) }], timestamp: i },
  }));

describe('projectParentHistoryPage', () => {
  it('只投影 beforeIndex 之前的短历史', () => {
    const page = projectParentHistoryPage(makeBranch(3) as never, 1);
    expect(page).toEqual({
      baseIndex: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'm0' }], timestamp: 0 }],
    });
  });
  it('80 条历史在 beforeIndex=20 时只返回前 20 条', () => {
    const page = projectParentHistoryPage(makeBranch(80) as never, 20);
    expect(page.baseIndex).toBe(0);
    expect(page.messages).toHaveLength(20);
    expect(page.messages.at(-1)).toHaveProperty('timestamp', 19);
  });
  it('按 60 条预算先截页再投影，不扫整卷', () => {
    expect(projectParentHistoryPage).toBeTypeOf('function');
    const spy = vi.spyOn(projection, 'projectMessage');
    const page = projectParentHistoryPage(makeBranch(80) as never, 70);
    expect(page.baseIndex).toBe(10);
    expect(page.messages).toHaveLength(60);
    expect(spy).toHaveBeenCalledTimes(60);
    spy.mockRestore();
  });
  it('同时遵守 600KB 字节预算', () => {
    const page = projectParentHistoryPage(makeBranch(3, () => 'x'.repeat(300_000)) as never, 3);
    expect(page.baseIndex).toBe(2);
    expect(page.messages).toHaveLength(1);
  });
  it('beforeIndex 不大于 0 或历史为空时返回空页', () => {
    for (const beforeIndex of [-1, 0])
      expect(projectParentHistoryPage(makeBranch(2) as never, beforeIndex)).toEqual({
        messages: [],
        baseIndex: 0,
      });
    expect(projectParentHistoryPage([] as never, 10)).toEqual({ messages: [], baseIndex: 0 });
  });
});

describe('projectParentHistoryTail', () => {
  it('tail and page carry distinct persisted IDs even for identical user text', () => {
    const branch = makeBranch(3, () => 'continue').map((entry, i) => ({
      ...entry,
      id: `entry-${i}`,
    }));
    expect(
      projectParentHistoryTail(branch as never).messages.map((message) => message.entryId)
    ).toEqual(['entry-0', 'entry-1', 'entry-2']);
    expect(
      projectParentHistoryPage(branch as never, 2).messages.map((message) => message.entryId)
    ).toEqual(['entry-0', 'entry-1']);
    expect(branch[0].message).not.toHaveProperty('entryId');
  });
  it('projects and windows from the end', () => {
    const branch = [
      {
        type: 'message',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 },
      },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
      },
      { type: 'custom', customType: 'other', data: {} },
    ];
    const tail = projectParentHistoryTail(branch as never);
    expect(tail.baseIndex).toBe(0);
    expect(tail.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], timestamp: 2 },
    ]);
  });

  it('drops unprojected fields', () => {
    const tail = projectParentHistoryTail([
      {
        type: 'message',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
          providerData: { secret: true },
        },
      },
    ] as never);
    expect(tail.messages[0]).not.toHaveProperty('providerData');
  });

  it('先截尾窗再投影，不扫整卷', () => {
    const spy = vi.spyOn(projection, 'projectMessage');
    const branch = Array.from({ length: 80 }, (_, i) => ({
      type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: `m${i}` }], timestamp: i },
    }));
    const tail = projectParentHistoryTail(branch as never);
    expect(tail.baseIndex).toBe(20);
    expect(tail.messages).toHaveLength(60);
    expect(spy).toHaveBeenCalledTimes(60);
    spy.mockRestore();
  });
});

describe('review closeout suppression in history', () => {
  const assistant = (text: string, timestamp: number) => ({
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'text', text }], timestamp },
  });
  const user = (text: string, timestamp: number) => ({
    type: 'message',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp },
  });
  const branch = [
    user('问题', 1),
    assistant('真实总结', 2),
    { type: 'custom_message', customType: 'codekiln.project-memory-review', display: false },
    assistant('我已更新 wiki/x.md', 3),
    user('下一问', 4),
    assistant('下一答', 5),
  ];

  it('drops the bookkeeping answer while keeping the real summary and later turns', () => {
    const tail = projectParentHistoryTail(branch as never);
    expect(tail.messages.map((m) => m.content[0])).toEqual([
      { type: 'text', text: '问题' },
      { type: 'text', text: '真实总结' },
      { type: 'text', text: '下一问' },
      { type: 'text', text: '下一答' },
    ]);
    expect(tail.baseIndex).toBe(0);
  });

  it('keeps a real legacy tool result as history without decorating the answer', () => {
    const branch = [
      {
        type: 'message',
        message: { role: 'user', content: '记一下：测试环境可自建单', timestamp: 1 },
      },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: '' }], timestamp: 2 },
      },
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'memory_upsert',
          toolCallId: 't',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'created',
                written: true,
                spaceId: 'proj:p',
                relPath: 'wiki/workflows/a.md',
                title: '测试环境自建单',
              }),
            },
          ],
          timestamp: 3,
        },
      },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: '已记下' }], timestamp: 4 },
      },
    ];
    const tail = projectParentHistoryTail(branch as never);
    expect(tail.messages[2]).toMatchObject({
      role: 'toolResult',
      toolName: 'memory_upsert',
      toolCallId: 't',
      content: branch[2]?.message.content,
    });
    expect(tail.messages.at(-1)).not.toHaveProperty('memoryUpdates');
  });

  it('keeps absolute page indices aligned after filtering', () => {
    const page = projectParentHistoryPage(branch as never, 3);
    // 下标必须在过滤后的对话上对齐：第 3 条之前是「问题 / 真实总结 / 下一问」
    expect(page.baseIndex + page.messages.length).toBe(3);
    expect(page.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});

describe('legacy review on reload', () => {
  it('hides internal review tools and replies even at the end of the old history', () => {
    const receipt = (relPath: string, status: string) => ({
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'memory_upsert',
        toolCallId: 't',
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status, written: true, relPath, spaceId: 'proj:p' }),
          },
        ],
        timestamp: 3,
      },
    });
    const branch = [
      { type: 'message', message: { role: 'user', content: '问', timestamp: 1 } },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: '真答案' }], timestamp: 2 },
      },
      { type: 'custom_message', customType: 'codekiln.project-memory-review', display: false },
      receipt('wiki/decisions/a.md', 'updated'),
      receipt('wiki/decisions/pending.md', 'pending_review'),
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: '已写入' }], timestamp: 4 },
      },
    ];
    const messages = projectParentHistoryAll(branch as never);
    expect(messages.map((m) => m.content[0])).toEqual([
      { type: 'text', text: '问' },
      { type: 'text', text: '真答案' },
    ]);
    expect(messages.at(-1)).not.toHaveProperty('memoryUpdates');
  });
});
