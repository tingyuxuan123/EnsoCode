import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { bashPath, posixShell } from '../../../test/helpers/shell';
import type { SshExecOptions, SshExecRawResult, SshExecResult, SshExecutor } from '../ssh/executor';
import { createRemoteApplyPatchIo, executeApplyPatch, PatchMutationUncertainError } from './index';

const patch = (...body: string[]) => ({
  input: ['*** Begin Patch', ...body, '*** End Patch'].join('\n'),
});

async function expectFailed(
  promise: ReturnType<typeof executeApplyPatch>,
  pattern?: RegExp | string
) {
  const result = await promise;
  expect(result.details.status).toBe('failed');
  if (pattern) expect(result.details.error ?? '').toMatch(pattern);
  return result;
}

interface RecordedCall {
  command: string[] | string;
  options?: SshExecOptions;
}

function fakeExecutor(
  options: { inspectKind?: 'missing' | 'file' | 'symlink'; raw?: Buffer } = {}
) {
  const calls: RecordedCall[] = [];
  const kind = options.inspectKind ?? 'missing';
  const executor = {
    host: 'fake',
    exec: vi.fn(async (command: string[] | string, execOptions?: SshExecOptions) => {
      calls.push({ command, options: execOptions });
      const script = Array.isArray(command) ? command[2] : '';
      if (script.includes("printf 'symlink\\n")) {
        return { stdout: `${kind}\n/workspace/target\n`, stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    }),
    execRaw: vi.fn(async (command: string[] | string, execOptions?: SshExecOptions) => {
      calls.push({ command, options: execOptions });
      return { stdout: options.raw ?? Buffer.from('remote\n'), stderr: '', code: 0 };
    }),
    execStream: vi.fn(),
  } as unknown as SshExecutor;
  return { calls, executor };
}

function runLocal(command: string[] | string, options?: SshExecOptions): Promise<SshExecRawResult> {
  if (!Array.isArray(command)) throw new Error('local test executor requires argv');
  return new Promise((resolve, reject) => {
    const child = spawn(command[0] === 'sh' ? posixShell() : command[0], command.slice(1), {
      signal: options?.signal,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? 1,
      })
    );
    child.stdin.end(options?.stdin);
  });
}

function localShellExecutor(): SshExecutor {
  return {
    host: 'local-shell',
    async exec(command, options): Promise<SshExecResult> {
      const result = await runLocal(command, options);
      return { ...result, stdout: result.stdout.toString('utf8') };
    },
    execRaw: runLocal,
    async execStream() {
      throw new Error('not used');
    },
  };
}

describe('远端 apply_patch IO', () => {
  it('本机 sh 实际执行绝对路径脚本，并在相对/绝对同目标时保持零写', async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'enso-remote-patch-')));
    const remoteRoot = bashPath(root);
    const target = path.posix.join(remoteRoot, 'nested', 'file.txt');
    const localTarget = path.join(root, 'nested', 'file.txt');
    const io = createRemoteApplyPatchIo(remoteRoot, localShellExecutor());
    try {
      await io.write(target, Buffer.from('created\n'), { exclusive: true });
      expect(await readFile(localTarget, 'utf8')).toBe('created\n');
      expect(await io.inspect(target)).toMatchObject({
        kind: 'file',
        raw: Buffer.from('created\n'),
      });
      await io.write(target, Buffer.from('updated\n'), { exclusive: false });
      expect(await readFile(localTarget, 'utf8')).toBe('updated\n');
      await io.remove(target);

      await expectFailed(
        executeApplyPatch(
          remoteRoot,
          patch(
            '*** Add File: same.txt',
            '+relative',
            `*** Add File: ${path.posix.join(remoteRoot, 'same.txt')}`,
            '+absolute'
          ),
          { io }
        ),
        /same target/i
      );
      await expect(readFile(path.join(root, 'same.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('路径始终作为独立 argv 传递，文件内容只走 stdin', async () => {
    const { calls, executor } = fakeExecutor();
    const io = createRemoteApplyPatchIo('/workspace with space', executor);
    const target = "nested/name'; echo PWN";
    const raw = Buffer.from('safe content');
    await io.write(target, raw, { exclusive: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toEqual(
      expect.arrayContaining(['sh', '-c', '/workspace with space', '1', target])
    );
    expect((calls[0].command as string[]).at(-1)).toBe(target);
    expect(calls[0].options?.stdin).toBe(raw);
    expect((calls[0].command as string[]).slice(0, -1).join(' ')).not.toContain(target);
  });

  it.each(['../escape.txt', 'nested/../../escape.txt'])(
    '在调用 SSH 前拒绝相对逃逸路径 %s',
    async (target) => {
      const { calls, executor } = fakeExecutor();
      const io = createRemoteApplyPatchIo('/workspace', executor);
      await expect(io.inspect(target)).rejects.toThrow();
      await expect(io.write(target, Buffer.from('x'), { exclusive: true })).rejects.toThrow();
      await expect(io.remove(target)).rejects.toThrow();
      expect(calls).toHaveLength(0);
    }
  );

  it('POSIX 绝对路径拆为根目录与相对段后通过独立 argv 传递', async () => {
    const { calls, executor } = fakeExecutor();
    const io = createRemoteApplyPatchIo('/workspace', executor);
    await io.write('/external/nested/file.txt', Buffer.from('safe'), { exclusive: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toEqual(
      expect.arrayContaining(['sh', '-c', '/', '1', 'external/nested/file.txt'])
    );
    const script = (calls[0].command as string[])[2];
    expect(script).toContain('if [ "$root" = / ]; then target=/$rel;');
    expect(script).toContain('if [ "$current" = / ]; then template=/.enso-patch.XXXXXX;');
  });

  it('Windows 主机形态的 cwd 只转换工作区根，SSH 目标仍按 POSIX 判定', async () => {
    const { calls, executor } = fakeExecutor();
    const io = createRemoteApplyPatchIo('D:/root/workspace', executor);
    await io.write('relative.txt', Buffer.from('safe'), { exclusive: true });
    await io.write('/external.txt', Buffer.from('safe'), { exclusive: true });
    expect(calls.map((call) => (call.command as string[]).slice(4))).toEqual([
      ['/root/workspace', '1', 'relative.txt'],
      ['/', '1', 'external.txt'],
    ]);
  });

  it('实际 inspect 脚本参数让相对与绝对同目标在 mutation 前被 canonical 拒绝', async () => {
    const calls: RecordedCall[] = [];
    const executor = {
      host: 'fake',
      exec: vi.fn(async (command: string[] | string, options?: SshExecOptions) => {
        calls.push({ command, options });
        if (!Array.isArray(command) || !command[2].includes("printf 'symlink\\n")) {
          throw new Error('mutation must not run');
        }
        const root = command[4];
        const relative = command.at(-1)!;
        const target = root === '/' ? `/${relative}` : `${root}/${relative}`;
        return { stdout: `missing\n${target}\n`, stderr: '', code: 0 };
      }),
      execRaw: vi.fn(),
      execStream: vi.fn(),
    } as unknown as SshExecutor;
    const io = createRemoteApplyPatchIo('/workspace', executor);

    await expectFailed(
      executeApplyPatch(
        '/workspace',
        patch(
          '*** Add File: same.txt',
          '+relative',
          '*** Add File: /workspace/same.txt',
          '+absolute'
        ),
        { io }
      ),
      /same target/i
    );
    expect(calls.map((call) => (call.command as string[]).slice(4))).toEqual([
      ['/workspace', 'same.txt'],
      ['/', 'workspace/same.txt'],
    ]);
  });

  it.each([
    'C:/outside.txt',
    'C:outside.txt',
    String.raw`C:\outside.txt`,
    String.raw`\root-relative.txt`,
    String.raw`\\server\share\file.txt`,
    '//server/share/file.txt',
  ])('SSH 在调用前拒绝 Windows 盘符或 UNC：%s', async (target) => {
    const { calls, executor } = fakeExecutor();
    const io = createRemoteApplyPatchIo('/workspace', executor);
    await expect(io.inspect(target)).rejects.toThrow();
    await expect(io.write(target, Buffer.from('x'), { exclusive: true })).rejects.toThrow();
    await expect(io.remove(target)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('inspect 明确返回符号链接类型且不继续读取文件', async () => {
    const { calls, executor } = fakeExecutor({ inspectKind: 'symlink' });
    const entry = await createRemoteApplyPatchIo('/workspace', executor).inspect('link/file.txt');
    expect(entry).toEqual({ kind: 'symlink', canonicalPath: '/workspace/target' });
    expect(calls).toHaveLength(1);
    expect(executor.execRaw).not.toHaveBeenCalled();
  });

  it('覆盖写使用 mktemp 所有权临时文件，不清理可预测的外部路径', async () => {
    const { calls, executor } = fakeExecutor();
    await createRemoteApplyPatchIo('/workspace', executor).write(
      'file.txt',
      Buffer.from('updated'),
      { exclusive: false }
    );
    const script = (calls[0].command as string[])[2];
    expect(script).toContain('mktemp');
    expect(script).toContain('trap cleanup');
    expect(script).not.toContain('tmp=$current/.enso-patch-$$');
  });

  it('SSH transport 中断转换为 mutation uncertain，禁止当作确认未写', async () => {
    const { executor } = fakeExecutor();
    vi.mocked(executor.exec).mockRejectedValueOnce(new Error('ssh command aborted'));
    const io = createRemoteApplyPatchIo('/workspace', executor);
    await expect(
      io.write('file.txt', Buffer.from('content'), { exclusive: true })
    ).rejects.toBeInstanceOf(PatchMutationUncertainError);
  });

  it('inspect 将独立短 timeout 透传给 metadata 与文件读取', async () => {
    const { calls, executor } = fakeExecutor({ inspectKind: 'file' });
    await createRemoteApplyPatchIo('/workspace', executor).inspect(
      'file.txt',
      1024,
      undefined,
      5_000
    );
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.options?.timeoutMs === 5_000)).toBe(true);
  });

  it('文件读取有 maxBytes+1 上界并透传 AbortSignal', async () => {
    const { calls, executor } = fakeExecutor({
      inspectKind: 'file',
      raw: Buffer.from('12345'),
    });
    const controller = new AbortController();
    const io = createRemoteApplyPatchIo('/workspace', executor);
    await expect(io.inspect('file.txt', 4, controller.signal)).rejects.toThrow(/read limit/);
    expect(calls).toHaveLength(2);
    expect(calls[1].command as string[]).toContain('5');
    expect(calls.every((call) => call.options?.signal === controller.signal)).toBe(true);
  });
});
