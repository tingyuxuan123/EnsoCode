import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Completion } from './completion';
import { LIMITS } from './local';
import { DevinError } from './safety';
import { runCodeSearch } from './searchLoop';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'enso-search-batch-'));
  mkdirSync(join(root, 'src'));
  for (let i = 1; i <= 32; i++) writeFileSync(join(root, `src/a${i}.ts`), `VALUE_${i}\n`);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const exec = (first: number, count: number) =>
  `[TOOL_CALLS] restricted_exec${JSON.stringify(
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [
        `command${i + 1}`,
        { op: 'readfile', path: `/codebase/src/a${first + i}.ts`, start: 1, end: 1 },
      ])
    )
  )}`;
const answer =
  '[TOOL_CALLS] ANSWER{"files":[{"path":"/codebase/src/a8.ts","ranges":[{"start":1,"end":1}]}]}';

describe('搜索批次与收尾预算', () => {
  it.each([
    { op: 'rg', pattern: 'a|'.repeat(200) },
    { op: 'readfile', path: 123 },
  ])('内部参数错误可在原预算内改正而不丢弃已读证据：%j', async (invalid) => {
    let calls = 0;
    const completion: Completion = {
      async complete(_system, messages) {
        calls++;
        if (calls === 1) return exec(8, 1);
        if (calls === 2)
          return `[TOOL_CALLS] restricted_exec${JSON.stringify({ command1: invalid })}`;
        expect(messages.at(-1)?.content).toContain('No commands were executed');
        return answer;
      },
    };
    const result = await runCodeSearch(
      { query: 'code' },
      root,
      completion,
      AbortSignal.timeout(5000)
    );
    expect(result.status).toBe('success');
    expect(calls).toBe(3);
  });

  it('模型常见的八命令批次全部执行，合法答案不再无故标成 partial', async () => {
    let calls = 0;
    const completion: Completion = {
      async complete(_system, messages, tools) {
        if (calls++ === 0) {
          const schema = JSON.parse(tools)[0].function.parameters.properties;
          expect(schema.command8).toBeDefined();
          return exec(1, 8);
        }
        for (let i = 1; i <= 8; i++) expect(messages.at(-1)?.content).toContain(`VALUE_${i}`);
        return answer;
      },
    };
    const result = await runCodeSearch(
      { query: 'role homepage' },
      root,
      completion,
      AbortSignal.timeout(5000)
    );
    expect(result.status).toBe('success');
    expect(result.files[0]?.path).toBe('src/a8.ts');
    expect(result.warnings).toEqual([]);
  });

  it('八命令批次最多执行三批，达到原24条总预算后只能交答案', async () => {
    let calls = 0;
    const completion: Completion = {
      async complete(_system, messages, tools) {
        calls++;
        if (calls <= 3) return exec((calls - 1) * 8 + 1, 8);
        expect(tools).not.toContain('restricted_exec');
        expect(JSON.stringify(messages)).not.toContain('VALUE_25');
        return exec(25, 8);
      },
    };
    const result = await runCodeSearch(
      { query: 'role homepage' },
      root,
      completion,
      AbortSignal.timeout(5000)
    );
    expect(result.status).toBe('partial');
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.every((f) => Number(/a(\d+)/.exec(f.path)?.[1]) <= 24)).toBe(true);
    expect(calls).toBeLessThanOrEqual(8);
    expect(result.content).toMatch(/observed|finaliz/i);
  });

  it('普通说明文字不直接终止搜索，模型能在原预算内改成交答案', async () => {
    let calls = 0;
    const completion: Completion = {
      async complete() {
        calls++;
        return calls === 1 ? 'I found the role homepage code, let me prepare the answer.' : answer;
      },
    };
    const result = await runCodeSearch(
      { query: 'role homepage' },
      root,
      completion,
      AbortSignal.timeout(5000)
    );
    expect(result.status).toBe('success');
    expect(calls).toBe(2);
  });

  it('一次响应协议损坏可在原预算内纠正，不丢弃之前命中', async () => {
    let calls = 0;
    const completion: Completion = {
      async complete() {
        calls++;
        if (calls === 1) return exec(8, 1);
        if (calls === 2) throw new DevinError('protocol', 'Invalid Devin JSON response.');
        return answer;
      },
    };
    const result = await runCodeSearch(
      { query: 'role homepage' },
      root,
      completion,
      AbortSignal.timeout(5000)
    );
    expect(result.status).toBe('success');
    expect(result.files[0]?.ranges[0]?.content).toContain('VALUE_8');
    expect(calls).toBe(3);
  });

  it('合法答案合计超过片段预算时保留能容纳的范围，不整体失败', async () => {
    const files = Array.from({ length: 3 }, (_, i) => {
      const path = `src/large${i}.ts`;
      writeFileSync(
        join(root, path),
        Array.from({ length: 200 }, () => 'x'.repeat(120)).join('\n')
      );
      return { path: `/codebase/${path}`, ranges: [{ start: 1, end: 200 }] };
    });
    const completion: Completion = {
      async complete() {
        return `[TOOL_CALLS] ANSWER${JSON.stringify({ files })}`;
      },
    };
    const result = await runCodeSearch(
      { query: 'code' },
      root,
      completion,
      AbortSignal.timeout(5000)
    );
    expect(result.status).toBe('partial');
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(32 * 1024);
    for (const file of result.files)
      for (const range of file.ranges) expect(result.content).toContain(range.content);
  });

  it('最终重读预算不足时保留已经重新验证的范围，不整体失败', async () => {
    const saved = LIMITS.finalReadBytes;
    LIMITS.finalReadBytes = 10;
    try {
      const completion: Completion = {
        async complete() {
          return '[TOOL_CALLS] ANSWER{"files":[{"path":"/codebase/src/a1.ts","ranges":[{"start":1,"end":1}]},{"path":"/codebase/src/a2.ts","ranges":[{"start":1,"end":1}]}]}';
        },
      };
      const result = await runCodeSearch(
        { query: 'code' },
        root,
        completion,
        AbortSignal.timeout(5000)
      );
      expect(result.status).toBe('partial');
      expect(result.files.map((f) => f.path)).toEqual(['src/a1.ts']);
      expect(result.content).toContain('VALUE_1');
      expect(result.content).not.toContain('VALUE_2');
    } finally {
      LIMITS.finalReadBytes = saved;
    }
  });
});
