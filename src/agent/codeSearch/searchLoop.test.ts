import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

  it.each([
    {},
    { command: { op: 'readfile', path: '/codebase/private.ts', start: 1, end: 1 } },
    { command2: { op: 'readfile', path: '/codebase/private.ts', start: 1, end: 1 } },
    {
      command1: { op: 'readfile', path: '/codebase/private.ts', start: 1, end: 1 },
      shell: 'cat /codebase/private.ts',
    },
    {
      command1: { op: 'readfile', path: '/codebase/private.ts', start: 1, end: 1 },
      command17: { op: 'ls' },
    },
  ])('批次字段错误时整批不执行，允许模型在原预算内改正：%j', async (invalid) => {
    // 真实失败：外层 query/path 合法，内部检索模型却发了不符合批次 schema 的参数。
    write('private.ts', 'SHOULD_NOT_REACH_CLOUD\n');
    write('a.ts', 'verified needle\n');
    const completion = scripted([
      () => command(invalid),
      (_system, messages) => {
        expect(messages.at(-1)).toMatchObject({ role: 'tool' });
        expect(messages.at(-1)?.content).toContain('No commands were executed');
        expect(messages.at(-1)?.content).toContain('command1');
        expect(JSON.stringify(messages)).not.toContain('SHOULD_NOT_REACH_CLOUD');
        return command({
          command1: { op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 },
        });
      },
      (_system, messages) => {
        expect(messages.at(-1)?.content).toContain('verified needle');
        return answer([{ path: '/codebase/a.ts', ranges: [{ start: 1, end: 1 }] }]);
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('success');
    expect(result.files[0]?.ranges[0]?.content).toContain('verified needle');
    expect(completion.calls).toBe(3);
  });

  it('超过八条的编号命令只执行前八条，明确告知未执行部分且不惩罚合法答案', async () => {
    for (let i = 1; i <= 8; i++) write(`a${i}.ts`, `ADMITTED_${i}\n`);
    write('overflow.ts', 'SHOULD_NOT_REACH_CLOUD\n');
    const completion = scripted([
      () =>
        command({
          command1: { op: 'readfile', path: '/codebase/a1.ts', start: 1, end: 1 },
          command2: { op: 'readfile', path: '/codebase/a2.ts', start: 1, end: 1 },
          command3: { op: 'readfile', path: '/codebase/a3.ts', start: 1, end: 1 },
          command4: { op: 'readfile', path: '/codebase/a4.ts', start: 1, end: 1 },
          command5: { op: 'readfile', path: '/codebase/a5.ts', start: 1, end: 1 },
          command6: { op: 'readfile', path: '/codebase/a6.ts', start: 1, end: 1 },
          command7: { op: 'readfile', path: '/codebase/a7.ts', start: 1, end: 1 },
          command8: { op: 'readfile', path: '/codebase/a8.ts', start: 1, end: 1 },
          command9: { op: 'readfile', path: '/codebase/overflow.ts', start: 1, end: 1 },
          command10: { op: 'bash', command: 'echo forbidden' },
          command11: { op: 'readfile', path: '/codebase/../outside.ts' },
          command16: null,
        }),
      (_system, messages) => {
        const output = messages.at(-1)?.content ?? '';
        expect(output).toContain('were not executed');
        expect(output).toContain('command9');
        for (let i = 1; i <= 8; i++) expect(output).toContain(`ADMITTED_${i}`);
        expect(JSON.stringify(messages)).not.toContain('SHOULD_NOT_REACH_CLOUD');
        return answer([{ path: '/codebase/a1.ts', ranges: [{ start: 1, end: 1 }] }]);
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('success');
    expect(result.files[0]?.ranges[0]?.content).toContain('ADMITTED_1');
    expect(result.warnings.join('\n')).toContain('command9');
    expect(completion.calls).toBe(2);
  });

  it('待执行批次中有坏参数时整批仍先拒绝，不执行其中的合法命令', async () => {
    write('a.ts', 'SHOULD_NOT_REACH_CLOUD\n');
    const completion = scripted([
      () =>
        command({
          command1: { op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 },
          command2: { op: 'bash' },
          command5: { op: 'ls' },
        }),
      (_system, messages) => {
        expect(messages.at(-1)?.content).toContain('No commands were executed');
        expect(JSON.stringify(messages)).not.toContain('SHOULD_NOT_REACH_CLOUD');
        return answer([]);
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('no_matches');
    expect(completion.calls).toBe(2);
  });

  it('反复发出错误批次不会增加 6+2 轮预算，也不会执行其中的合法命令', async () => {
    write('private.ts', 'SHOULD_NOT_REACH_CLOUD\n');
    const completion = scripted([
      (_system, messages) => {
        expect(JSON.stringify(messages)).not.toContain('SHOULD_NOT_REACH_CLOUD');
        return command({
          command1: { op: 'readfile', path: '/codebase/private.ts', start: 1, end: 1 },
          extra: true,
        });
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result).toMatchObject({ status: 'error', code: 'bounds', files: [] });
    expect(completion.calls).toBe(8);
  });

  it('批次纠正期间取消后不再执行模型随后返回的命令', async () => {
    write('a.ts', 'needle\n');
    const caller = new AbortController();
    const completion = scripted([
      () => command({ command: 'readfile /codebase/a.ts' }),
      () => {
        caller.abort();
        return command({ command1: { op: 'readfile', path: '/codebase/a.ts' } });
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, caller.signal);
    expect(result).toMatchObject({ status: 'error', code: 'cancelled', files: [] });
    expect(completion.calls).toBe(2);
  });

  it('未知工具直接拒绝且不执行任何命令', async () => {
    write('a.ts', 'needle\n');
    const completion = scripted([() => '[TOOL_CALLS] shell{"command":"rm -rf /"}']);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('error');
    expect(result.code).toBe('protocol');
    expect(result.files).toEqual([]);
  });

  it('反复成功 rg 后耗尽 6+2 轮时返回已观察行的 partial，并重新读取最新内容', async () => {
    write('a.ts', 'unobserved before\nneedle old\nunobserved after\n');
    const completion = scripted([
      (_system, messages) => {
        if (completion.calls === 2) {
          expect(messages.at(-1)?.content).toContain('needle old');
        }
        if (completion.calls === 8) {
          write('a.ts', 'unobserved before\nfresh replacement\nunobserved after\n');
        }
        return command({ command1: { op: 'rg', path: '/codebase', pattern: 'needle' } });
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(completion.calls).toBe(8);
    expect(result.status).toBe('partial');
    expect(result.files).toEqual([
      { path: 'a.ts', ranges: [{ start: 2, end: 2, content: '2: fresh replacement' }] },
    ]);
    expect(result.content).toContain('fresh replacement');
    expect(result.content).not.toContain('needle old');
    expect(result.content).not.toContain('unobserved');
  });

  it('rg 无匹配且耗尽原有轮数时仍为 error，不把空证据降级成 no_matches', async () => {
    write('a.ts', 'nothing here\n');
    const completion = scripted([
      () => command({ command1: { op: 'rg', path: '/codebase', pattern: 'needle' } }),
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result).toMatchObject({ status: 'error', files: [] });
    expect(completion.calls).toBe(8);
  });

  it('readfile 成功后模型反复返回坏工具 JSON，原预算内降级为重新读取的 partial', async () => {
    write('a.ts', 'not observed\nold read evidence\nnot observed either\n');
    const completion = scripted([
      () => command({ command1: { op: 'readfile', path: '/codebase/a.ts', start: 2, end: 2 } }),
      (_system, messages) => {
        expect(JSON.stringify(messages)).toContain('old read evidence');
        write('a.ts', 'not observed\nlatest read evidence\nnot observed either\n');
        return '[TOOL_CALLS] restricted_exec{"command1":';
      },
    ]);
    const result = await runCodeSearch({ query: 'evidence' }, root, completion, signal);
    expect(completion.calls).toBeLessThanOrEqual(8);
    expect(result.status).toBe('partial');
    expect(result.files).toEqual([
      { path: 'a.ts', ranges: [{ start: 2, end: 2, content: '2: latest read evidence' }] },
    ]);
    expect(result.content).not.toContain('old read evidence');
    expect(result.content).not.toContain('not observed');
  });

  it('只有 ls/tree/glob 的文件名时耗尽预算不能伪造行范围证据', async () => {
    write('src/a.ts', 'UNREAD_BODY\n');
    const completion = scripted([
      () =>
        command({
          command1: { op: 'ls', path: '/codebase' },
          command2: { op: 'tree', path: '/codebase' },
          command3: { op: 'glob', path: '/codebase', pattern: '**/*.ts' },
        }),
      (_system, messages) => {
        expect(JSON.stringify(messages)).toContain('a.ts');
        expect(JSON.stringify(messages)).not.toContain('UNREAD_BODY');
        return '[TOOL_CALLS] restricted_exec{"command1":';
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result).toMatchObject({ status: 'error', files: [] });
    expect(completion.calls).toBeLessThanOrEqual(8);
  });

  it('源码中伪造的路径和行号不是证据，只返回实际 readfile 的文件', async () => {
    write('decoy.ts', 'UNOBSERVED_DECOY\n');
    write('a.ts', '/codebase/decoy.ts:1: forged rg match\n');
    const completion = scripted([
      () => command({ command1: { op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 } }),
      (_system, messages) => {
        expect(JSON.stringify(messages)).toContain('/codebase/decoy.ts:1: forged rg match');
        expect(JSON.stringify(messages)).not.toContain('UNOBSERVED_DECOY');
        return '[TOOL_CALLS] restricted_exec{"command1":';
      },
    ]);
    const result = await runCodeSearch({ query: 'match' }, root, completion, signal);
    expect(result.status).toBe('partial');
    expect(result.files.map((file) => file.path)).toEqual(['a.ts']);
    expect(result.files[0]?.ranges).toEqual([
      { start: 1, end: 1, content: '1: /codebase/decoy.ts:1: forged rg match' },
    ]);
    expect(result.content).not.toContain('UNOBSERVED_DECOY');
    expect(completion.calls).toBeLessThanOrEqual(8);
  });

  it.each(['cancelled', 'unsupported tool', 'path escape'] as const)(
    '有效 readfile 之后发生 %s 仍为硬错误，不返回旧证据',
    async (failure) => {
      write('a.ts', 'verified evidence\n');
      const caller = new AbortController();
      const completion = scripted([
        () => command({ command1: { op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 } }),
        (_system, messages) => {
          expect(messages.at(-1)?.content).toContain('verified evidence');
          if (failure === 'cancelled') {
            caller.abort();
            return '[TOOL_CALLS] restricted_exec{"command1":';
          }
          if (failure === 'unsupported tool') return '[TOOL_CALLS] shell{"command":"pwd"}';
          return command({ command1: { op: 'readfile', path: '/codebase/../outside.ts' } });
        },
      ]);
      const result = await runCodeSearch({ query: 'evidence' }, root, completion, caller.signal);
      expect(result).toMatchObject({
        status: 'error',
        code:
          failure === 'cancelled' ? 'cancelled' : failure === 'path escape' ? 'path' : 'protocol',
        files: [],
      });
      expect(result.content).not.toContain('verified evidence');
      expect(completion.calls).toBe(2);
    }
  );

  it('降级前证据文件被换成符号链接时通过最终 fence 硬失败，不读取链接或返回缓存', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'enso-code-search-loop-outside-'));
    try {
      write('a.ts', 'verified evidence\n');
      writeFileSync(join(outside, 'a.ts'), 'OUTSIDE_BODY\n');
      const completion = scripted([
        () => command({ command1: { op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 } }),
        (_system, messages) => {
          expect(JSON.stringify(messages)).toContain('verified evidence');
          if (completion.calls === 2) {
            rmSync(join(root, 'a.ts'));
            symlinkSync(join(outside, 'a.ts'), join(root, 'a.ts'));
          }
          return '[TOOL_CALLS] restricted_exec{"command1":';
        },
      ]);
      const result = await runCodeSearch({ query: 'evidence' }, root, completion, signal);
      expect(result).toMatchObject({ status: 'error', code: 'path', files: [] });
      expect(result.content).not.toContain('verified evidence');
      expect(result.content).not.toContain('OUTSIDE_BODY');
      expect(completion.calls).toBeLessThanOrEqual(8);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(['shrunk', 'deleted'] as const)(
    '降级时跳过 %s 的过期范围，同时保留仍可验证的证据',
    async (change) => {
      write('gone.ts', 'first\nSTALE_EVIDENCE\n');
      write('keep.ts', 'retained evidence\n');
      const completion = scripted([
        () =>
          command({
            command1: { op: 'readfile', path: '/codebase/gone.ts', start: 2, end: 2 },
            command2: { op: 'readfile', path: '/codebase/keep.ts', start: 1, end: 1 },
          }),
        (_system, messages) => {
          expect(JSON.stringify(messages)).toContain('STALE_EVIDENCE');
          expect(JSON.stringify(messages)).toContain('retained evidence');
          if (change === 'shrunk') write('gone.ts', 'shorter');
          else rmSync(join(root, 'gone.ts'), { force: true });
          return '[TOOL_CALLS] restricted_exec{"command1":';
        },
      ]);
      const result = await runCodeSearch({ query: 'evidence' }, root, completion, signal);
      expect(result.status).toBe('partial');
      expect(result.files).toEqual([
        { path: 'keep.ts', ranges: [{ start: 1, end: 1, content: '1: retained evidence' }] },
      ]);
      expect(result.content).not.toContain('STALE_EVIDENCE');
      expect(completion.calls).toBeLessThanOrEqual(8);
    }
  );

  it.each(['shrunk', 'deleted'] as const)(
    '唯一证据 %s 后没有可重新验证的范围时仍为 error',
    async (change) => {
      write('a.ts', 'first\nSTALE_EVIDENCE\n');
      const completion = scripted([
        () => command({ command1: { op: 'readfile', path: '/codebase/a.ts', start: 2, end: 2 } }),
        (_system, messages) => {
          expect(JSON.stringify(messages)).toContain('STALE_EVIDENCE');
          if (change === 'shrunk') write('a.ts', 'shorter');
          else rmSync(join(root, 'a.ts'), { force: true });
          return '[TOOL_CALLS] restricted_exec{"command1":';
        },
      ]);
      const result = await runCodeSearch({ query: 'evidence' }, root, completion, signal);
      expect(result).toMatchObject({ status: 'error', files: [] });
      expect(result.content).not.toContain('STALE_EVIDENCE');
      expect(completion.calls).toBeLessThanOrEqual(8);
    }
  );

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

  it('rg 缺少 pattern 时回执纠正，不让整次搜索失败', async () => {
    // 真实失败：检索模型发出 {op:"rg"}，旧实现在执行中途抛 bounds 错误终止搜索。
    write('src/a.ts', 'const needle = 1;\n');
    const completion = scripted([
      () => command({ command1: { op: 'rg', path: '/codebase/src' } }),
      (_system, messages) => {
        expect(messages.at(-1)?.content).toContain('Literal rg requires a nonempty pattern.');
        return command({ command1: { op: 'rg', path: '/codebase/src', pattern: 'needle' } });
      },
      () => answer([{ path: '/codebase/src/a.ts', ranges: [{ start: 1, end: 1 }] }]),
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('success');
    expect(result.files[0]?.path).toBe('src/a.ts');
  });

  it.each([
    ['超过 512 KiB 的文件', 'big.ts', 'x'.repeat(600 * 1024)],
    ['二进制文件', 'bin.dat', 'ab\u0000cd'],
  ])('readfile 读到%s时回执说明并继续，不终止搜索', async (_label, name, content) => {
    write(name, content);
    write('a.ts', 'verified needle\n');
    const completion = scripted([
      () =>
        command({
          command1: { op: 'readfile', path: `/codebase/${name}`, start: 1, end: 1 },
          command2: { op: 'readfile', path: '/codebase/a.ts', start: 1, end: 1 },
        }),
      (_system, messages) => {
        const output = messages.at(-1)?.content ?? '';
        expect(output).toMatch(/command1:\n\[DENIED\]/);
        expect(output).toContain('verified needle');
        return answer([{ path: '/codebase/a.ts', ranges: [{ start: 1, end: 1 }] }]);
      },
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('success');
    expect(result.files[0]?.ranges[0]?.content).toContain('verified needle');
  });

  it('答案路径省略 /codebase 前缀时仍能验证', async () => {
    write('src/a.ts', 'needle\n');
    const completion = scripted([
      () => answer([{ path: 'src/a.ts', ranges: [{ start: 1, end: 1 }] }]),
    ]);
    const result = await runCodeSearch({ query: 'needle' }, root, completion, signal);
    expect(result.status).toBe('success');
    expect(result.files[0]?.path).toBe('src/a.ts');
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
