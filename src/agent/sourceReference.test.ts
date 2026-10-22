import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  extractSourceReferences,
  renderSourceReferenceMarker,
  withSourceReference,
} from './sourceReference';

describe('extractSourceReferences', () => {
  it('从 path 类参数抽出文件引用', () => {
    expect(extractSourceReferences('read', { path: 'src/a.ts' }, 'c1')).toEqual([
      { type: 'file', path: 'src/a.ts', toolName: 'read', toolCallId: 'c1' },
    ]);
    expect(extractSourceReferences('grep', { pattern: 'x', path: 'src' }, 'c2')).toEqual([
      { type: 'file', path: 'src', toolName: 'grep', toolCallId: 'c2' },
    ]);
  });

  it('从 url 抽出 web 引用', () => {
    expect(
      extractSourceReferences('browser_navigate', { url: 'https://example.com/a' }, 'c3')
    ).toEqual([
      { type: 'web', url: 'https://example.com/a', toolName: 'browser_navigate', toolCallId: 'c3' },
    ]);
  });

  it('bash 不抽引用；脏参数丢弃', () => {
    expect(extractSourceReferences('bash', { command: 'ls src/a.ts' }, 'c4')).toEqual([]);
    expect(extractSourceReferences('read', { path: '' }, 'c5')).toEqual([]);
    expect(extractSourceReferences('read', { path: 1 }, 'c6')).toEqual([]);
  });

  it('代码搜索引用来自校验后的结果，不把检索范围冒充命中文件', () => {
    expect(extractSourceReferences('code_search', { query: 'entry', path: 'src' }, 's1')).toEqual(
      []
    );
  });

  it('marker 是紧凑单行', () => {
    expect(
      renderSourceReferenceMarker({ type: 'file', path: 'a.ts', toolName: 'read', toolCallId: '1' })
    ).toBe('<source_reference type="file" path="a.ts" />');
  });
});

describe('withSourceReference', () => {
  it('把引用写入 details 并在正文末尾追加 marker', async () => {
    const inner: ToolDefinition = {
      name: 'read',
      label: 'read',
      description: 'read',
      parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
      async execute() {
        return { content: [{ type: 'text' as const, text: 'file body' }], details: { ok: true } };
      },
    };
    const wrapped = withSourceReference(inner);
    const result = await wrapped.execute(
      'c1',
      { path: 'src/a.ts' },
      undefined,
      undefined,
      undefined as never
    );
    const text = result.content[0];
    expect(text?.type).toBe('text');
    if (text?.type !== 'text') throw new Error('expected text');
    expect(text.text).toContain('file body');
    expect(text.text).toContain('<source_reference type="file" path="src/a.ts" />');
    expect(result.details).toEqual({
      ok: true,
      sourceReferences: [{ type: 'file', path: 'src/a.ts', toolName: 'read', toolCallId: 'c1' }],
    });
  });

  it('没有引用时不改结果', async () => {
    const inner: ToolDefinition = {
      name: 'bash',
      label: 'bash',
      description: 'bash',
      parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
      async execute() {
        return { content: [{ type: 'text' as const, text: 'ok' }], details: undefined };
      },
    };
    const wrapped = withSourceReference(inner);
    const result = await wrapped.execute(
      'c1',
      { command: 'ls' },
      undefined,
      undefined,
      undefined as never
    );
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(result.details).toBeUndefined();
  });
});
