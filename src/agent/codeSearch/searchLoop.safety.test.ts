import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Completion } from './completion';
import { LIMITS } from './local';
import { DevinError } from './safety';
import { runCodeSearch } from './searchLoop';

let temporary: string;
let root: string;

beforeEach(() => {
  temporary = mkdtempSync(join(tmpdir(), 'enso-search-safety-'));
  root = join(temporary, 'workspace');
  mkdirSync(root);
});

afterEach(() => rmSync(temporary, { recursive: true, force: true }));

const exec = (commands: unknown[]) =>
  `[TOOL_CALLS] restricted_exec${JSON.stringify(
    Object.fromEntries(commands.map((command, index) => [`command${index + 1}`, command]))
  )}`;
const read = (name: string, end = 1) => ({
  op: 'readfile',
  path: `/codebase/${name}`,
  start: 1,
  end,
});
const answer = (paths: string[]) =>
  `[TOOL_CALLS] ANSWER${JSON.stringify({
    files: paths.map((path) => ({ path, ranges: [{ start: 1, end: 1 }] })),
  })}`;
const search = (completion: Completion) =>
  runCodeSearch({ query: 'find implementation' }, root, completion, AbortSignal.timeout(5000));
const malformed = 'This is not a canonical answer or tool call.';

describe('code_search evidence safety and budget edges', () => {
  it.each(['login', 'network', 'ratelimit', 'cancelled', 'bounds'] as const)(
    'does not replace a %s completion failure with previously observed evidence',
    async (code) => {
      writeFileSync(join(root, 'a.ts'), 'VERIFIED_BEFORE_FAILURE\n');
      let calls = 0;
      let delivered = '';
      const result = await search({
        async complete(_system, messages) {
          if (calls++ === 0) return exec([read('a.ts')]);
          delivered = messages.at(-1)?.content ?? '';
          throw new DevinError(code, `Completion failed: ${code}`);
        },
      });
      expect(delivered).toContain('VERIFIED_BEFORE_FAILURE');
      expect(calls).toBe(2);
      expect(result).toMatchObject({ status: 'error', code, files: [] });
      expect(result.content).not.toContain('VERIFIED_BEFORE_FAILURE');
    }
  );

  it('never invents fallback evidence from a whole line that exceeded totalBytes', async () => {
    const unseen = `UNDELIVERED_${'x'.repeat(4096)}`;
    writeFileSync(join(root, 'huge.ts'), unseen);
    const previous = LIMITS.totalBytes;
    let calls = 0;
    const delivered: string[] = [];
    try {
      // Root layout fits, but no part of the single source line can be retained.
      LIMITS.totalBytes = 256;
      const result = await search({
        async complete(_system, messages) {
          delivered.push(messages.at(-1)?.content ?? '');
          return calls++ === 0 ? exec([read('huge.ts')]) : malformed;
        },
      });
      expect(calls).toBe(8);
      expect(delivered[0]).toContain('/codebase/huge.ts');
      expect(delivered.join('\n')).not.toContain('UNDELIVERED_');
      expect(result.status).toBe('error');
      expect(result.files).toEqual([]);
      expect(result.content).not.toContain('UNDELIVERED_');
    } finally {
      LIMITS.totalBytes = previous;
    }
  });

  it.each(['traversal', 'symlink race'] as const)(
    'hard-fails an ANSWER containing a valid file followed by %s',
    async (unsafe) => {
      writeFileSync(join(root, 'a.ts'), 'SAFE_FIRST_FILE\n');
      writeFileSync(join(root, 'b.ts'), 'ORIGINAL_SECOND_FILE\n');
      writeFileSync(join(temporary, 'outside.ts'), 'OUTSIDE_WORKSPACE\n');
      let calls = 0;
      let delivered = '';
      const result = await search({
        async complete(_system, messages) {
          if (calls++ === 0) return exec([read('a.ts'), read('b.ts')]);
          delivered = messages.at(-1)?.content ?? '';
          if (unsafe === 'symlink race') {
            rmSync(join(root, 'b.ts'));
            symlinkSync(join(temporary, 'outside.ts'), join(root, 'b.ts'));
          }
          return answer([
            '/codebase/a.ts',
            unsafe === 'traversal' ? '/codebase/../outside.ts' : '/codebase/b.ts',
          ]);
        },
      });
      expect(delivered).toContain('SAFE_FIRST_FILE');
      expect(delivered).toContain('ORIGINAL_SECOND_FILE');
      expect(calls).toBe(2);
      expect(result).toMatchObject({ status: 'error', code: 'path', files: [] });
      expect(result.content).not.toContain('OUTSIDE_WORKSPACE');
    }
  );

  it.each(['rejected batch', 'ninth command'] as const)(
    'cannot use a readfile in a %s as fallback evidence',
    async (batch) => {
      writeFileSync(join(root, 'unseen.ts'), 'NOT_RETAINED_EVIDENCE\n');
      const commands =
        batch === 'rejected batch'
          ? [read('unseen.ts'), { op: 'not-an-operation' }]
          : [...Array.from({ length: 8 }, () => ({ op: 'ls' })), read('unseen.ts')];
      let calls = 0;
      const delivered: string[] = [];
      const result = await search({
        async complete(_system, messages) {
          delivered.push(messages.at(-1)?.content ?? '');
          return calls++ === 0 ? exec(commands) : malformed;
        },
      });
      expect(calls).toBe(8);
      expect(delivered[1]).toContain(
        batch === 'rejected batch' ? 'No commands were executed' : 'command9'
      );
      expect(delivered.join('\n')).not.toContain('NOT_RETAINED_EVIDENCE');
      expect(result.status).toBe('error');
      expect(result.files).toEqual([]);
      expect(result.content).not.toContain('NOT_RETAINED_EVIDENCE');
    }
  );

  it('re-reads fallback evidence and clips complete lines with structured ranges inside 32 KiB', async () => {
    const lines = (prefix: string) =>
      Array.from({ length: 200 }, (_, index) => `${prefix}_${index + 1}`.padEnd(90, 'x'));
    const sources: Record<string, string[]> = { 'a.ts': lines('OLD'), 'b.ts': lines('SECOND') };
    for (const [name, text] of Object.entries(sources)) {
      writeFileSync(join(root, name), text.join('\n'));
    }
    let calls = 0;
    let delivered = '';
    const result = await search({
      async complete(_system, messages) {
        if (calls++ === 0) return exec([read('a.ts', 200), read('b.ts', 200)]);
        if (calls === 2) {
          delivered = messages.at(-1)?.content ?? '';
          sources['a.ts'] = lines('FRESH');
          writeFileSync(join(root, 'a.ts'), sources['a.ts'].join('\n'));
        }
        return malformed;
      },
    });
    expect(delivered).toContain('OLD_1');
    expect(delivered).toContain('SECOND_200');
    expect(calls).toBe(8);
    expect(result.status).toBe('partial');
    expect(result.truncated).toBe(true);
    expect(result.content).toMatch(/^\[PARTIAL\]/);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(32 * 1024);
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.content).toContain('FRESH_1');
    expect(result.content).not.toContain('OLD_1');
    for (const file of result.files) {
      expect(file.ranges.length).toBeGreaterThan(0);
      for (const range of file.ranges) {
        const expected = sources[file.path]!.slice(range.start - 1, range.end)
          .map((line, index) => `${range.start + index}: ${line}`)
          .join('\n');
        expect(range.content).not.toBe('');
        expect(range.content).toBe(expected);
        expect(range.content.split('\n')).toHaveLength(range.end - range.start + 1);
        expect(result.content).toContain(range.content);
      }
    }
  });

  it('admits only three of a final eight-command batch after 7+7+7 without penalizing ANSWER', async () => {
    for (let index = 1; index <= 29; index++) {
      writeFileSync(join(root, `a${index}.ts`), `READ_${index}_END\n`);
    }
    let calls = 0;
    let finalTools = '';
    const outputs: string[] = [];
    const result = await search({
      async complete(_system, messages, tools) {
        const turn = calls++;
        if (turn) outputs.push(messages.at(-1)?.content ?? '');
        if (turn < 4) {
          const first = turn * 7 + 1;
          return exec(
            Array.from({ length: turn === 3 ? 8 : 7 }, (_, index) => read(`a${first + index}.ts`))
          );
        }
        finalTools = tools;
        return answer(['/codebase/a24.ts']);
      },
    });
    expect(calls).toBe(5);
    expect(finalTools).not.toContain('restricted_exec');
    for (let index = 1; index <= 24; index++) {
      expect(outputs.join('\n')).toContain(`READ_${index}_END`);
    }
    for (let index = 25; index <= 29; index++) {
      expect(outputs.join('\n')).not.toContain(`READ_${index}_END`);
    }
    expect(outputs.at(-1)).toContain('command4');
    expect(outputs.at(-1)).toContain('not executed');
    expect(result.status).toBe('success');
    expect(result.files).toEqual([
      { path: 'a24.ts', ranges: [{ start: 1, end: 1, content: '1: READ_24_END' }] },
    ]);
    expect(result.truncated).toBe(false);
  });
});
