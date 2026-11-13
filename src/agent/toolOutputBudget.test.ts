import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_URI_SCHEME,
  parseArtifactUri,
  ToolOutputBudget,
  withToolOutputBudget,
} from './toolOutputBudget';
import { formatFetchResult } from './tools/webFetch';

function textTool(name: string, text: string): ToolDefinition {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} } as ToolDefinition['parameters'],
    async execute() {
      return { content: [{ type: 'text' as const, text }], details: { kept: true } };
    },
  };
}

describe('ToolOutputBudget', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function budget(maxInlineBytes = 32): ToolOutputBudget {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-budget-'));
    dirs.push(root);
    mkdirSync(root, { recursive: true });
    return new ToolOutputBudget({ rootDir: root, maxInlineBytes });
  }

  it('短结果原样返回', async () => {
    const store = budget(64);
    const wrapped = withToolOutputBudget(textTool('grep', 'short'), store);
    const result = await wrapped.execute(
      'c1',
      { pattern: 'x' },
      undefined,
      undefined,
      undefined as never
    );
    expect(result.content).toEqual([{ type: 'text', text: 'short' }]);
    expect(result.details).toEqual({ kept: true });
  });

  it('超长结果外置为 artifact，receipt 可经 read 回取', async () => {
    const store = budget(16);
    const body = 'abcdefghij'.repeat(8);
    const wrapped = withToolOutputBudget(textTool('grep', body), store);
    const result = await wrapped.execute(
      'call-1',
      { pattern: 'TODO', path: 'src' },
      undefined,
      undefined,
      undefined as never
    );
    const text = result.content[0];
    expect(text?.type).toBe('text');
    if (text?.type !== 'text') throw new Error('expected text');
    expect(text.text).toContain('[Tool output externalized');
    expect(text.text).toContain('grep');
    expect(text.text).toContain('TODO');
    expect(text.text).not.toContain(body);
    const uri = parseArtifactUri(text.text.match(/enso-artifact:\/\/[^\s]+/)?.[0] ?? '');
    expect(uri).toBeTruthy();
    const details = result.details as { externalized?: boolean; reference?: string };
    expect(details.externalized).toBe(true);
    expect(details.reference).toContain(ARTIFACT_URI_SCHEME);

    const recovered = store.read(details.reference ?? '');
    expect(recovered).toBe(body);
    expect(readFileSync(path.join(store.rootDir, 'call-1.txt'), 'utf8')).toBe(body);
  });

  it('read 工具不外置，但能按 uri 取回 artifact', async () => {
    const store = budget(64);
    store.write('call-9', 'abcdefghijklmnop');
    const reader = withToolOutputBudget(textTool('read', 'file-body'), store);
    const file = await reader.execute(
      'r1',
      { path: '/tmp/x.ts' },
      undefined,
      undefined,
      undefined as never
    );
    expect(file.content).toEqual([{ type: 'text', text: 'file-body' }]);
    const hit = await reader.execute(
      'r2',
      { path: `${ARTIFACT_URI_SCHEME}call-9` },
      undefined,
      undefined,
      undefined as never
    );
    expect(hit.content).toEqual([{ type: 'text', text: 'abcdefghijklmnop' }]);
  });

  it('receipt 指引 read/grep 可直接使用 artifact uri，而不是 bash', async () => {
    const store = budget(16);
    const wrapped = withToolOutputBudget(textTool('bash', 'x'.repeat(64)), store);
    const result = await wrapped.execute(
      'call-2',
      { command: 'echo' },
      undefined,
      undefined,
      undefined as never
    );
    const part = result.content[0];
    if (part?.type !== 'text') throw new Error('expected text');
    expect(part.text).toContain(`grep(path="${ARTIFACT_URI_SCHEME}call-2"`);
    expect(part.text).toContain(`read(path="${ARTIFACT_URI_SCHEME}call-2"`);
    expect(part.text).toMatch(/not.*bash/i);
  });

  it.each(['x', '字'])('web_fetch 的正常 5 万字符分页保留正文与续读提示：%s', async (char) => {
    const store = budget(16);
    const page = formatFetchResult({
      url: 'https://example.com/page',
      status: 200,
      contentType: 'text/plain',
      text: char.repeat(50_000),
      offset: 0,
      totalChars: 100_000,
      nextOffset: 50_000,
      bodyCut: false,
    });
    const result = await withToolOutputBudget(textTool('web_fetch', page), store).execute(
      'fetch-page',
      {},
      undefined,
      undefined,
      undefined as never
    );
    expect(result.content).toEqual([{ type: 'text', text: page }]);
    expect(result.details).toEqual({ kept: true });
  });

  it('web_fetch 超大异常结果仍外置，其它工具继续遵守原预算', async () => {
    const store = budget(16);
    for (const [name, body] of [
      ['web_fetch', '字'.repeat(60_000)],
      ['web_search', 'x'.repeat(64)],
    ]) {
      const result = await withToolOutputBudget(textTool(name, body), store).execute(
        name,
        {},
        undefined,
        undefined,
        undefined as never
      );
      expect(result.details).toMatchObject({ externalized: true });
      const reference = (result.details as { reference: string }).reference;
      expect(store.read(reference)).toBe(body);
    }
  });

  it('read 自带分页不外置，显式更高的会话预算不被工具默认值降低', async () => {
    const body = 'x'.repeat(200_000);
    for (const [name, maxInlineBytes] of [
      ['read', 16],
      ['web_fetch', 250_000],
    ] as const) {
      const result = await withToolOutputBudget(
        textTool(name, body),
        budget(maxInlineBytes)
      ).execute(name, {}, undefined, undefined, undefined as never);
      expect(result.content).toEqual([{ type: 'text', text: body }]);
    }
  });

  it('read artifact 遵守 offset/limit 并提示续读位置', async () => {
    const store = budget(1024);
    const uri = store.write('call-3', ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n'));
    const reader = withToolOutputBudget(textTool('read', 'file-body'), store);
    const hit = await reader.execute(
      'r3',
      { path: uri, offset: 2, limit: 2 },
      undefined,
      undefined,
      undefined as never
    );
    const part = hit.content[0];
    if (part?.type !== 'text') throw new Error('expected text');
    expect(part.text.startsWith('l2\nl3')).toBe(true);
    expect(part.text).not.toContain('l1');
    expect(part.text).not.toContain('l4');
    expect(part.text).toContain('offset=4');
  });

  it('read artifact 单次输出受字节预算约束', async () => {
    const store = budget(64);
    const uri = store.write('call-4', Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n'));
    const reader = withToolOutputBudget(textTool('read', 'file-body'), store);
    const hit = await reader.execute('r4', { path: uri }, undefined, undefined, undefined as never);
    const part = hit.content[0];
    if (part?.type !== 'text') throw new Error('expected text');
    expect(part.text).toContain('line-0');
    expect(part.text).not.toContain('line-49');
    expect(part.text).toMatch(/offset=\d+/);
  });

  it('grep 可按 uri 搜索 artifact，并返回行号', async () => {
    const store = budget(1024);
    const uri = store.write('call-5', ['alpha', 'Beta one', 'gamma', 'beta two'].join('\n'));
    const inner = textTool('grep', 'should-not-run');
    const grep = withToolOutputBudget(inner, store);
    const hit = await grep.execute(
      'g1',
      { path: uri, pattern: 'beta', ignoreCase: true },
      undefined,
      undefined,
      undefined as never
    );
    const part = hit.content[0];
    if (part?.type !== 'text') throw new Error('expected text');
    expect(part.text).toContain('2: Beta one');
    expect(part.text).toContain('4: beta two');
    expect(part.text).not.toContain('alpha');
    expect(part.text).not.toContain('should-not-run');
  });

  it('grep 未知 artifact 报错', async () => {
    const store = budget(1024);
    const grep = withToolOutputBudget(textTool('grep', 'x'), store);
    await expect(
      grep.execute(
        'g2',
        { path: `${ARTIFACT_URI_SCHEME}missing`, pattern: 'x' },
        undefined,
        undefined,
        undefined as never
      )
    ).rejects.toThrow(/unknown artifact/);
  });

  it('落盘失败时退回 head/tail 预览', async () => {
    const blocker = path.join(tmpdir(), `enso-budget-file-${process.pid}`);
    writeFileSync(blocker, 'not-a-dir');
    dirs.push(blocker);
    const store = new ToolOutputBudget({ rootDir: blocker, maxInlineBytes: 8 });
    const wrapped = withToolOutputBudget(textTool('bash', '0123456789abcdef'), store);
    const result = await wrapped.execute(
      'c1',
      { command: 'x' },
      undefined,
      undefined,
      undefined as never
    );
    const text = result.content[0];
    expect(text?.type).toBe('text');
    if (text?.type !== 'text') throw new Error('expected text');
    expect(text.text).toMatch(/truncated/i);
    expect(text.text).toContain('0123');
    expect((result.details as { fallback?: boolean }).fallback).toBe(true);
  });
});
