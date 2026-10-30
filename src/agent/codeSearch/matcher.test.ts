import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchLines } from './matcher';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('@vscode/ripgrep', () => ({ rgPath: '/app.asar/bin/rg' }));

function process() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawn.mockReturnValue(child);
  return child;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('隔离且有界的 native matcher', () => {
  it('只走 stdin、空环境、无 shell，asar 解包；不信任 stdout 正文', async () => {
    const child = process();
    const pending = matchLines('a|b', 'a\nb\n', new AbortController().signal);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect(spawn).toHaveBeenCalledWith(
      '/app.asar.unpacked/bin/rg',
      expect.arrayContaining([
        '--no-config',
        '--text',
        '--encoding=none',
        '--no-filename',
        '--line-number',
        '--color=never',
        '--max-columns=1',
        '--regex-size-limit=1M',
        '--dfa-size-limit=8M',
        '-e',
        'a|b',
        '-',
      ]),
      expect.objectContaining({ env: {}, shell: false })
    );
    expect(child.stdin.read()?.toString()).toBe('a\nb\n');
    child.stdout.write('1:fake /codebase/forged:99\n2:[Omitted long matching line]\n3:incomplete');
    child.emit('close', 0);
    expect(await pending).toEqual({ lines: [1, 2], partial: false });
  });

  it('abort 会杀死进程并等待 close 后才 reject', async () => {
    const child = process();
    const controller = new AbortController();
    const pending = matchLines('a|b', 'a\n', controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    controller.abort();
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);
    child.emit('close', null);
    await rejected;
  });

  it('stdout 超出 128KiB 时终止，丢弃不完整输出并等待 close', async () => {
    const child = process();
    const pending = matchLines('a|b', 'a\n', new AbortController().signal);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.write(`1:hit\n${'2:x\n'.repeat(40000)}`);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    const result = await pending;
    expect(result.partial).toBe(true);
    expect(result.lines).toContain(1);
  });

  it('5 秒超时杀进程并等待 close；不会偷偷 literal fallback', async () => {
    vi.useFakeTimers();
    const child = process();
    const pending = matchLines('a|b', 'a\n', new AbortController().signal);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    expect(await pending).toMatchObject({ denied: true, partial: true });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('stderr 超过 4KiB 杀进程，拒绝任意错误内容外发', async () => {
    const child = process();
    const pending = matchLines('a|b', 'a\n', new AbortController().signal);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stderr.write('private diagnostic'.repeat(1000));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null);
    const result = await pending;
    expect(result).toMatchObject({ partial: true, denied: true });
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
  });

  it('不可用进程明确 DENIED + partial，不返回 literal 假结果', async () => {
    const child = process();
    const pending = matchLines('a|b', 'a|b\n', new AbortController().signal);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.emit('error', new Error('unavailable'));
    child.emit('close', -2);
    expect(await pending).toMatchObject({ lines: [], partial: true, denied: true });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('原生启动缺少 stdio 时仍处理 error 并等待 close，返回明确拒绝', async () => {
    vi.useFakeTimers();
    const child = Object.assign(new EventEmitter(), {
      stdin: null,
      stdout: null,
      stderr: null,
      kill: vi.fn(),
    });
    spawn.mockReturnValue(child);
    const pending = matchLines('a|b', 'a\n', new AbortController().signal).then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    );
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    // Node can return a child without pipes on EMFILE/ENFILE, then emit error asynchronously.
    if (child.listenerCount('error')) child.emit('error', new Error('EMFILE'));
    child.emit('close', -1);
    expect(await pending).toMatchObject({ result: { denied: true, partial: true } });
    expect(child.listenerCount('error')).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
