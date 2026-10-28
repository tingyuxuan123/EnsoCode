import type { ExtensionToolContext } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { withPlanGate } from '../planMode';
import { createCodeSearchTool } from './codeSearch';

const ctx = { cwd: '/workspace/worktree' } as ExtensionToolContext;
const outcome = {
  status: 'success' as const,
  files: [{ path: 'src/a.ts', ranges: [{ start: 1, end: 1, content: '1: hello' }] }],
  content: 'src/a.ts\n1: hello',
  truncated: false,
  warnings: [],
};

describe('code_search 内置工具', () => {
  it('引用标记挤占预算时同步裁掉结构化尾部，不把命中误报成 no_matches', async () => {
    const range = { start: 1, end: 1, content: `1: ${'x'.repeat(32600)}` };
    const tool = createCodeSearchTool({
      run: async () => ({
        ...outcome,
        content: `src/a.ts\n${range.content}`,
        files: [{ path: 'src/a.ts', ranges: [range] }],
      }),
    });
    const result = await tool.execute('c', { query: 'x' }, undefined, undefined, {
      cwd: `/workspace/${'deep/'.repeat(40)}`,
    } as never);
    const data = result.structuredContent as unknown as typeof outcome;
    expect(Buffer.byteLength(data.content)).toBeLessThanOrEqual(32768);
    expect(data.status).toBe('partial');
    for (const file of data.files)
      for (const r of file.ranges) expect(data.content).toContain(r.content);
  });
  it('明确参数与输出类型，校验前trim不添加未知字段', async () => {
    const run = vi.fn(async () => outcome);
    const tool = createCodeSearchTool({ run });
    expect(tool.name).toBe('code_search');
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: { query: { type: 'string', maxLength: 8192 }, path: { type: 'string' } },
    });
    expect(tool.outputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['status', 'files', 'content', 'truncated', 'warnings']),
    });
    expect(tool.prepareArguments?.({ query: ' hi ', path: ' src ' })).toEqual({
      query: 'hi',
      path: 'src',
    });
    const result = await tool.execute(
      'search',
      { query: ' hi ', path: ' src ' },
      undefined,
      undefined,
      ctx
    );
    expect(run).toHaveBeenCalledWith(
      { query: 'hi', path: 'src' },
      ctx.cwd,
      expect.any(AbortSignal)
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: 'success', files: outcome.files });
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('/workspace/worktree/src/a.ts'),
    });
  });

  it('空白、超长、坏路径与额外字段在读文件前拒绝', async () => {
    const run = vi.fn(async () => outcome);
    const tool = createCodeSearchTool({ run });
    for (const params of [
      { query: ' ' },
      { query: 'x'.repeat(8193) },
      { query: 1 },
      { query: 'ok', path: '/tmp' },
      { query: 'ok', path: '../escape' },
      { query: 'ok', apiKey: 'secret' },
      null,
    ]) {
      await expect(tool.execute('search', params, undefined, undefined, ctx)).rejects.toThrow();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('cwd 内的绝对路径先归一化为相对路径，cwd 本身等于不限定子目录', async () => {
    // 真实调用：主模型常把项目内绝对路径传给 path。
    const run = vi.fn(async () => outcome);
    const tool = createCodeSearchTool({ run });
    await tool.execute(
      'a',
      { query: 'x', path: '/workspace/worktree/src/pages/' },
      undefined,
      undefined,
      ctx
    );
    expect(run).toHaveBeenLastCalledWith(
      { query: 'x', path: 'src/pages' },
      ctx.cwd,
      expect.any(AbortSignal)
    );
    for (const same of ['/workspace/worktree', '.', './']) {
      await tool.execute('b', { query: 'x', path: same }, undefined, undefined, ctx);
      expect(run).toHaveBeenLastCalledWith({ query: 'x' }, ctx.cwd, expect.any(AbortSignal));
    }
    await tool.execute('c', { query: 'x', path: './src' }, undefined, undefined, ctx);
    expect(run).toHaveBeenLastCalledWith(
      { query: 'x', path: 'src' },
      ctx.cwd,
      expect.any(AbortSignal)
    );
  });

  it('cwd 外的路径给出可操作的错误，说明只能搜当前工作区', async () => {
    // 真实失败：主模型想搜另一个仓库（/Users/.../ZCode-main），旧报错只说 path 不合法。
    const run = vi.fn(async () => outcome);
    const tool = createCodeSearchTool({ run });
    for (const outside of ['/workspace/other-repo', '/workspace/worktree-sibling/src']) {
      await expect(
        tool.execute('d', { query: 'x', path: outside }, undefined, undefined, ctx)
      ).rejects.toThrow(/outside the current workspace \/workspace\/worktree.*grep|read/s);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('error标为错误但保留结构化数据；no_matches不是错误', async () => {
    for (const status of ['no_matches', 'partial', 'error'] as const) {
      const tool = createCodeSearchTool({ run: async () => ({ ...outcome, status, files: [] }) });
      const result = await tool.execute('c', { query: 'query' }, undefined, undefined, ctx);
      expect(result.isError).toBe(status === 'error');
      expect(result.structuredContent).toMatchObject({ status });
    }
  });

  it('Plan只读门允许搜索且取消不发布迟到片段', async () => {
    const run = vi.fn(async () => outcome);
    const tool = withPlanGate(createCodeSearchTool({ run }), {
      host: { state: () => ({ active: true }) as never, submit: () => {} },
      readonlyAgentTypes: new Set(),
    });
    await tool.execute('c', { query: 'x' }, undefined, undefined, ctx);
    expect(run).toHaveBeenCalledOnce();
    const abort = new AbortController();
    abort.abort();
    await expect(tool.execute('c', { query: 'x' }, abort.signal, undefined, ctx)).rejects.toThrow(
      /cancel/i
    );
    expect(run).toHaveBeenCalledOnce();
  });
});
