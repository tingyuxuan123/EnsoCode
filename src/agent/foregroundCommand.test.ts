import { type BashOperations, createLocalBashOperations } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachForegroundFailureDetails,
  bindForegroundCommand,
  type DetachableProcess,
  ForegroundCommand,
  ForegroundDetachedError,
  withDetachableExec,
} from './foregroundCommand';

const until = (pred: () => boolean, ms = 5000) =>
  new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (pred()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - t0 > ms) {
        clearInterval(timer);
        reject(new Error('timeout'));
      }
    }, 20);
  });

afterEach(() => vi.useRealTimers());

describe('前台让位与绝对截止独立', () => {
  function controlled(deadlineMs?: number, rejectAdopt = false) {
    vi.useFakeTimers();
    const aborted = vi.fn();
    let complete!: (value: { exitCode: number }) => void;
    let receivedDeadline: number | undefined;
    const start = Date.now();
    const command = new ForegroundCommand(
      { yieldMs: 100, deadlineAt: deadlineMs === undefined ? undefined : start + deadlineMs },
      {
        adopt: (_proc, _reason, deadlineAt?: number) => {
          if (rejectAdopt) throw new Error('quota full');
          receivedDeadline = deadlineAt;
          return 'task-test';
        },
        attachFinalize: () => {},
      }
    );
    const controller = new AbortController();
    bindForegroundCommand(controller.signal, command);
    const pending = withDetachableExec({
      exec: async (_c, _d, opts) => {
        opts.signal?.addEventListener('abort', aborted);
        return new Promise<{ exitCode: number }>((resolve, reject) => {
          complete = resolve;
          opts.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      },
    }).exec('test', '/', {
      onData: () => {},
      signal: controller.signal,
      timeout: deadlineMs === undefined ? undefined : deadlineMs / 1000,
    });
    const outcome = pending.catch((error: unknown) => error);
    return {
      command,
      controller,
      complete,
      outcome,
      aborted,
      start,
      deadline: () => receivedDeadline,
    };
  }

  it.each(['user', 'steer', 'timeout'] as const)('移交 %s 保留原绝对 deadline', async (reason) => {
    const state = controlled(300);
    await vi.advanceTimersByTimeAsync(reason === 'timeout' ? 100 : 40);
    if (reason !== 'timeout') state.command.detach(reason);
    expect(await state.outcome).toBeInstanceOf(ForegroundDetachedError);
    expect(state.deadline()).toBe(state.start + 300);
    expect(state.aborted).not.toHaveBeenCalled();
  });

  it('deadline 早于 yield：不移交，命中后不可 detach，abort 不覆盖 deadline', async () => {
    const state = controlled(50);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    state.controller.abort();
    expect(String(await state.outcome)).toContain('timeout:0.05');
    expect(state.command.detach('user')).toBeNull();
    expect(state.deadline()).toBeUndefined();
  });

  it('受控失败hook只接收安全RTK白名单，不接收任意error details', async () => {
    const state = controlled(50);
    attachForegroundFailureDetails(state.controller.signal, {
      secret: 'ignored',
      rtk: {
        status: 'compressed',
        originalCommand: 'git status',
        inputTokens: 10,
        outputTokens: 5,
        privateDbPath: '/secret',
      },
    });
    expect(state.command.failureDetails).toEqual({
      rtk: {
        status: 'compressed',
        originalCommand: 'git status',
        inputTokens: 10,
        outputTokens: 5,
      },
    });
    state.complete({ exitCode: 0 });
    await state.outcome;
  });

  it('自动移交失败但有 deadline：继续前台至原截止而非提早杀', async () => {
    const state = controlled(300, true);
    await vi.advanceTimersByTimeAsync(100);
    expect(state.aborted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(String(await state.outcome)).toContain('timeout:0.3');
  });

  it('自动移交失败且无 deadline：受控停止，以 yield_failed 收口', async () => {
    const state = controlled(undefined, true);
    await vi.advanceTimersByTimeAsync(100);
    expect(String(await state.outcome)).toContain('yield_failed');
    expect(state.aborted).toHaveBeenCalledOnce();
  });

  it('手动移交失败留前台，完成后无计时器残留', async () => {
    const state = controlled(300, true);
    expect(state.command.detach('user')).toBeNull();
    state.complete({ exitCode: 0 });
    expect(await state.outcome).toEqual({ exitCode: 0 });
    await vi.advanceTimersByTimeAsync(400);
    expect(state.aborted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function setup(timeoutAction: 'background' | 'kill' = 'background', adoptError?: Error) {
  const adopted: DetachableProcess[] = [];
  const deadlines: Array<number | undefined> = [];
  const schedule = { yieldMs: 45_000, deadlineAt: undefined as number | undefined };
  const command = new ForegroundCommand(schedule, {
    adopt: (proc, _reason, deadlineAt) => {
      if (adoptError) throw adoptError;
      adopted.push(proc);
      deadlines.push(deadlineAt);
      return `task-${adopted.length}`;
    },
    attachFinalize: () => {},
  });
  const controller = new AbortController();
  bindForegroundCommand(controller.signal, command);
  const ops = withDetachableExec(createLocalBashOperations());
  const seen: string[] = [];
  const run = (script: string, timeout?: number) => {
    if (timeoutAction === 'background')
      schedule.yieldMs = timeout === undefined ? 45_000 : timeout * 1000;
    else schedule.deadlineAt = timeout === undefined ? undefined : Date.now() + timeout * 1000;
    return ops.exec(script, process.cwd(), {
      onData: (chunk) => seen.push(chunk.toString()),
      signal: controller.signal,
      timeout,
    });
  };
  return { command, controller, adopted, deadlines, seen, run };
}

describe('withDetachableExec', () => {
  it('未登记前台命令的 signal 原样透传给底层 exec', async () => {
    const calls: unknown[] = [];
    const inner: BashOperations = {
      exec: async (_command, _cwd, options) => {
        calls.push(options.timeout);
        return { exitCode: 0 };
      },
    };
    const result = await withDetachableExec(inner).exec('true', '/', {
      onData: () => {},
      signal: new AbortController().signal,
      timeout: 7,
    });
    expect(result).toEqual({ exitCode: 0 });
    expect(calls).toEqual([7]);
  });

  it('转后台：前台立即以带已有输出的 ForegroundDetachedError 结束，进程继续运行并移交输出', async () => {
    const { command, adopted, seen, run } = setup();
    const pending = run('echo before; sleep 0.4; echo after');
    await until(() => seen.join('').includes('before'));

    expect(command.detach('user')).toBe('task-1');
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForegroundDetachedError);
    expect(error).toMatchObject({ taskId: 'task-1', reason: 'user' });
    expect((error as ForegroundDetachedError).output).toContain('before');

    const later: string[] = [];
    adopted[0].pipe((chunk) => later.push(chunk.toString()));
    await expect(adopted[0].done).resolves.toBe(0);
    expect(later.join('')).toContain('after');
    expect(seen.join('')).not.toContain('after');
  });

  it('转后台后的 kill 终止进程', async () => {
    const { command, adopted, seen, run } = setup();
    const pending = run('echo go; sleep 30');
    await until(() => seen.join('').includes('go'));
    command.detach('user');
    await pending.catch(() => {});
    adopted[0].kill();
    await expect(adopted[0].done).rejects.toThrow('aborted');
  });

  it('默认超时转后台而不是杀进程', async () => {
    const { adopted, run } = setup('background');
    const error = await run('sleep 0.6; echo late', 0.2).catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: 'timeout', taskId: 'task-1' });
    await expect(adopted[0].done).resolves.toBe(0);
  });

  it('显式超时仍按 pi 约定杀进程并报 timeout', async () => {
    const { adopted, run } = setup('kill');
    await expect(run('sleep 5', 0.2)).rejects.toThrow('timeout:0.2');
    expect(adopted).toHaveLength(0);
  });

  it('显式截止的命令转后台时把原截止交给 owner', async () => {
    const { command, adopted, deadlines, seen, run } = setup('kill');
    const startedAt = Date.now();
    const pending = run('echo go; sleep 0.5', 0.3);
    await until(() => seen.join('').includes('go'));
    command.detach('user');
    await pending.catch(() => {});
    expect(deadlines[0]).toBeGreaterThanOrEqual(startedAt + 300);
    expect(deadlines[0]).toBeLessThan(startedAt + 350);
    adopted[0].kill();
    await expect(adopted[0].done).rejects.toThrow('aborted');
  });

  it('自动让位被拒（配额满）且无截止时受控停止', async () => {
    const { run } = setup('background', new Error('full'));
    await expect(run('sleep 5', 0.2)).rejects.toThrow('yield_failed');
  });

  it('用户中止按 aborted 结束', async () => {
    const { controller, seen, run } = setup();
    const pending = run('echo go; sleep 30');
    await until(() => seen.join('').includes('go'));
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });

  it('命令结束后或尚未启动时 detach 返回 null', async () => {
    const { command, run } = setup();
    expect(command.detach('user')).toBeNull();
    await expect(run('exit 3')).resolves.toEqual({ exitCode: 3 });
    expect(command.detach('user')).toBeNull();
  });
});
