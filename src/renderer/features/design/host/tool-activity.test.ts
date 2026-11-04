import type { ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { createDesignToolActivity } from './tool-activity';

const user = (text: string): ProjectedMessage => ({
  role: 'user',
  content: [{ type: 'text', text }],
});
const call = (id: string, name: string, args?: Record<string, unknown>): ProjectedMessage => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id, name, ...(args ? { arguments: args } : {}) }],
});
const result = (id: string, name: string, isError = false): ProjectedMessage => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: name,
  isError,
  content: [{ type: 'text', text: 'ok' }],
});

describe('createDesignToolActivity', () => {
  it('流式参数露出路径即发 tool-call-args，结果落地发 tool-call-end', () => {
    const tracker = createDesignToolActivity();
    expect(tracker.sync('s1', [user('go')], true)).toEqual([]);
    expect(tracker.sync('s1', [user('go'), call('c1', 'write', {})], true)).toEqual([]);
    const args = tracker.sync(
      's1',
      [user('go'), call('c1', 'write', { path: 'a.vetd/frames/home.tsx' })],
      true
    );
    expect(args).toEqual([
      {
        type: 'tool-call-args',
        toolCallId: 'c1',
        toolName: 'write',
        args: { path: 'a.vetd/frames/home.tsx' },
      },
    ]);
    // 正文继续增长、路径不变：不重复发
    expect(
      tracker.sync(
        's1',
        [user('go'), call('c1', 'write', { path: 'a.vetd/frames/home.tsx', content: 'x' })],
        true
      )
    ).toEqual([]);
    const end = tracker.sync(
      's1',
      [
        user('go'),
        call('c1', 'write', { path: 'a.vetd/frames/home.tsx' }),
        result('c1', 'write', true),
      ],
      true
    );
    expect(end).toEqual([
      { type: 'tool-call-end', toolCallId: 'c1', toolName: 'write', isError: true },
    ]);
  });

  it('apply_patch 按文件拆成独立调用：新增=write，更新/移动=edit，删除忽略', () => {
    const tracker = createDesignToolActivity();
    tracker.sync('s1', [user('go')], true);
    const input = [
      '*** Begin Patch',
      '*** Add File: d.vetd/frames/new.tsx',
      '+x',
      '*** Update File: d.vetd/frames/home.tsx',
      '*** Delete File: d.vetd/frames/old.tsx',
      '*** End Patch',
    ].join('\n');
    const messages = [user('go'), call('p1', 'apply_patch', { input })];
    expect(tracker.sync('s1', messages, true)).toEqual([
      {
        type: 'tool-call-args',
        toolCallId: 'p1#0',
        toolName: 'write',
        args: { path: 'd.vetd/frames/new.tsx' },
      },
      {
        type: 'tool-call-args',
        toolCallId: 'p1#1',
        toolName: 'edit',
        args: { path: 'd.vetd/frames/home.tsx' },
      },
    ]);
    expect(tracker.sync('s1', [...messages, result('p1', 'apply_patch')], true)).toEqual([
      { type: 'tool-call-end', toolCallId: 'p1#0', toolName: 'write', isError: false },
      { type: 'tool-call-end', toolCallId: 'p1#1', toolName: 'edit', isError: false },
    ]);
  });

  it('读文件发 read；与路径无关的工具不转发', () => {
    const tracker = createDesignToolActivity();
    tracker.sync('s1', [], true);
    // 流式中的半截头部行不算数，避免 components/Sh 之类误点亮全部帧
    expect(
      tracker.sync(
        's1',
        [call('p1', 'apply_patch', { input: '*** Begin Patch\n*** Update File: d.vetd/comp' })],
        true
      )
    ).toEqual([]);
  });

  it('只转发读写类工具', () => {
    const tracker = createDesignToolActivity();
    tracker.sync('s1', [], true);
    expect(
      tracker.sync(
        's1',
        [
          call('r1', 'read', { path: '/w/d.vetd/frames/a.tsx' }),
          call('g1', 'grep', { path: '/w/d.vetd' }),
        ],
        true
      )
    ).toEqual([
      {
        type: 'tool-call-args',
        toolCallId: 'r1',
        toolName: 'read',
        args: { path: '/w/d.vetd/frames/a.tsx' },
      },
    ]);
  });

  it('同批到达的参数与结果仍先亮后收', () => {
    const tracker = createDesignToolActivity();
    tracker.sync('s1', [user('go')], true);
    expect(
      tracker.sync(
        's1',
        [user('go'), call('c1', 'edit', { path: 'd.vetd/frames/a.tsx' }), result('c1', 'edit')],
        true
      )
    ).toEqual([
      {
        type: 'tool-call-args',
        toolCallId: 'c1',
        toolName: 'edit',
        args: { path: 'd.vetd/frames/a.tsx' },
      },
      { type: 'tool-call-end', toolCallId: 'c1', toolName: 'edit', isError: false },
    ]);
  });

  it('切换会话或首次同步时，历史调用一律静默，不点亮旧帧', () => {
    const tracker = createDesignToolActivity();
    const history = [
      user('go'),
      call('c1', 'edit', { path: 'd.vetd/frames/a.tsx' }),
      result('c1', 'edit'),
    ];
    expect(tracker.sync('s1', history, false)).toEqual([]);
    expect(tracker.sync('s2', history, true)).toEqual([]);
    // 未运行时未完成的调用也不点亮（中止残留）
    expect(
      tracker.sync('s3', [user('go'), call('c9', 'edit', { path: 'd.vetd/frames/a.tsx' })], false)
    ).toEqual([]);
  });
});
