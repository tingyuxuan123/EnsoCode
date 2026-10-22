import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Completion } from './completion';
import type { Message } from './protocol';
import { runCodeSearch } from './searchLoop';

let root: string;
const signal = new AbortController().signal;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'enso-code-search-loop-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, content: string) => {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

const scripted = (
  steps: ((system: string, messages: Message[], tools: string) => string)[]
): Completion & { calls: number } => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async complete(system, messages, tools) {
      const step = steps[Math.min(calls, steps.length - 1)]!;
      calls += 1;
      return step(system, messages, tools);
    },
  };
};

const command = (args: Record<string, unknown>) =>
  `[TOOL_CALLS] restricted_exec${JSON.stringify(args)}`;
const answer = (files: unknown) => `[TOOL_CALLS] ANSWER${JSON.stringify({ files })}`;

describe('runCodeSearch 循环', () => {
  it('先执行受限命令，再验证 ANSWER 范围', async () => {
    write('src/a.ts', 'line1\nconst needle = 1;\nline3\n');
    const completion = scripted([
      () => command({ command1: { op: 'rg', path: '/codebase', pattern: 'needle' } }),
      () => answer([{ path: '/codebase/src/a.ts', ranges: [{ start: 1, end: 2 }] }]),
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('success');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe('src/a.ts');
    expect(result.files[0]!.ranges[0]!.content).toContain('const needle = 1;');
    expect(result.content).toContain('src/a.ts');
    expect(result.truncated).toBe(false);
  });

  it('坏答案会被纠正，不会直接中断搜索', async () => {
    write('a.ts', 'needle\n');
    const completion = scripted([
      () => command({ command1: { op: 'rg', path: '/codebase', pattern: 'needle' } }),
      () => answer([{ path: '/codebase/a.ts', ranges: [{ start: 5, end: 1 }] }]),
      () => answer([{ path: '/codebase/a.ts', ranges: [{ start: 1, end: 1 }] }]),
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('success');
    expect(result.files[0]!.path).toBe('a.ts');
  });

  it('未知工具直接拒绝且不执行任何命令', async () => {
    write('a.ts', 'needle\n');
    const completion = scripted([() => '[TOOL_CALLS] shell{"command":"rm -rf /"}']);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('error');
    expect(result.code).toBe('protocol');
    expect(result.files).toEqual([]);
  });

  it('6+2 轮预算耗尽后显式失败', async () => {
    write('a.ts', 'needle\n');
    const completion = scripted([
      () => command({ command1: { op: 'rg', path: '/codebase', pattern: 'needle' } }),
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('error');
    expect(result.code).toBe('bounds');
    expect(completion.calls).toBe(8);
  });

  it('命令路径穿越被拒绝', async () => {
    write('a.ts', 'needle\n');
    const completion = scripted([
      () => command({ command1: { op: 'readfile', path: '/codebase/../secret' } }),
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('error');
    expect(result.code).toBe('path');
  });

  it('ANSWER 后文件变化时返回最新内容而不是缓存', async () => {
    write('a.ts', 'old\n');
    const completion = scripted([
      () => command({ command1: { op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 } }),
      () => {
        write('a.ts', 'new\n');
        return answer([{ path: '/codebase/a.ts', ranges: [{ start: 1, end: 1 }] }]);
      },
    ]);
    const result = await runCodeSearch({ query: 'old' }, root, completion, signal);
    expect(result.files[0]!.ranges[0]!.content).toContain('new');
    expect(result.files[0]!.ranges[0]!.content).not.toContain('old');
  });

  it('没有匹配时返回 no_matches', async () => {
    write('a.ts', 'nothing\n');
    const completion = scripted([() => answer([])]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('no_matches');
    expect(result.files).toEqual([]);
  });

  it('最终文本超过 32KiB 时截断并说明', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `${'x'.repeat(90)}${i}`).join('\n');
    write('big.ts', lines);
    const completion = scripted([
      () => answer([{ path: '/codebase/big.ts', ranges: [{ start: 1, end: 400 }] }]),
    ]);
    const result = await runCodeSearch({ query: 'x' }, root, completion, signal);
    expect(result.truncated).toBe(true);
    expect(result.status).toBe('partial');
    expect(result.warnings.join('\n')).toMatch(/truncat/i);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(32 * 1024);
    expect(result.content).toMatch(/TRUNCATED/);
  });

  it('截断时结构化 files 不超过 content 预算且内容包含于 content', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `${'x'.repeat(90)}${i}`).join('\n');
    write('big.ts', lines);
    const completion = scripted([
      () => answer([{ path: '/codebase/big.ts', ranges: [{ start: 1, end: 400 }] }]),
    ]);
    const result = await runCodeSearch({ query: 'x' }, root, completion, signal);
    expect(result.truncated).toBe(true);
    const contents = result.files.flatMap((f) => f.ranges.map((r) => r.content));
    expect(Buffer.byteLength(contents.join('\n'))).toBeLessThanOrEqual(32 * 1024);
    for (const content of contents) expect(result.content).toContain(content);
  });

  it('多字节文本按字节截断且不产生替换字符', async () => {
    const lines = Array.from({ length: 400 }, (_, i) => `${'你'.repeat(30)}${i}`).join('\n');
    write('unicode.ts', lines);
    const completion = scripted([
      () => answer([{ path: '/codebase/unicode.ts', ranges: [{ start: 1, end: 400 }] }]),
    ]);
    const result = await runCodeSearch({ query: '你' }, root, completion, signal);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(32 * 1024);
    expect(result.content).not.toContain('\uFFFD');
    for (const content of result.files.flatMap((f) => f.ranges.map((r) => r.content))) {
      expect(result.content).toContain(content);
      expect(content).not.toContain('\uFFFD');
    }
  });

  it('凭据错误透传为脱敏 error 结果', async () => {
    const completion: Completion = {
      async complete() {
        throw Object.assign(new Error('Devin session rejected; use /devin-login.'), {
          code: 'login',
        });
      },
    };
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result).toMatchObject({ status: 'error', code: 'login', files: [] });
  });
});
