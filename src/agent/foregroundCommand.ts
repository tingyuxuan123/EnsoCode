import type { BashOperations } from '@earendil-works/pi-coding-agent';
import { parseRtkToolStats, type RtkToolStats } from '@shared/rtk';

export type DetachReason = 'user' | 'timeout' | 'steer';

/** 移交给后台任务的在跑进程：输出改接到新的接收者，退出码经 done 送达 */
export interface DetachableProcess {
  output(): string;
  pipe(onData: (chunk: Buffer) => void): void;
  done: Promise<number | null>;
  kill(): void;
}

export interface ForegroundOwner {
  /** 接管进程并返回后台任务 id；拒绝（如配额满）时抛错，命令留在前台 */
  adopt(proc: DetachableProcess, reason: DetachReason, deadlineAt?: number): string;
  attachFinalize(taskId: string, details: unknown, finalize?: () => Promise<unknown>): void;
  onYieldFailed?(deadlineAt: number, output: string): void;
}

/** 前台命令已移交后台：沿工具包装链上抛，由 withBackground 转成正常工具结果 */
export class ForegroundDetachedError extends Error {
  details: unknown;

  constructor(
    readonly taskId: string,
    readonly reason: DetachReason,
    readonly output: string,
    private readonly owner: ForegroundOwner
  ) {
    super(`Command moved to background task ${taskId}`);
    this.name = 'ForegroundDetachedError';
  }

  /** 命令包装层（rtk）把收尾推迟到后台任务结束 */
  defer(details: unknown, finalize?: () => Promise<unknown>): void {
    this.details = details;
    this.owner.attachFinalize(this.taskId, details, finalize);
  }
}

/** 与后台任务缓冲同量级：移交时作为任务初始输出 */
const SEED_OUTPUT_LIMIT = 200_000;
export interface ForegroundSchedule {
  yieldMs: number;
  deadlineAt?: number;
}

interface Running {
  proc: DetachableProcess;
  release(error: Error): void;
}

/** 一次前台命令调用：进程在跑时可随时移交后台，不杀不重启 */
export class ForegroundCommand {
  private running: Running | undefined;
  private cause: 'deadline' | 'aborted' | 'yield_failed' | undefined;
  failureDetails?: { rtk: RtkToolStats };

  get terminationCause() {
    return this.cause;
  }

  constructor(
    private readonly schedule: ForegroundSchedule,
    private readonly owner: ForegroundOwner
  ) {}

  detach(reason: DetachReason): string | null {
    const entry = this.running;
    if (
      !entry ||
      this.cause ||
      (this.schedule.deadlineAt !== undefined && Date.now() >= this.schedule.deadlineAt)
    )
      return null;
    let taskId: string;
    try {
      taskId = this.owner.adopt(entry.proc, reason, this.schedule.deadlineAt);
    } catch {
      return null;
    }
    entry.release(new ForegroundDetachedError(taskId, reason, entry.proc.output(), this.owner));
    return taskId;
  }

  run(
    inner: BashOperations,
    command: string,
    cwd: string,
    options: Parameters<BashOperations['exec']>[2]
  ): Promise<{ exitCode: number | null }> {
    const { onData, signal, env, timeout } = options;
    // 只有本层拥有前台计时器；移交后 manager 接管原绝对截止。
    const controller = new AbortController();
    let sink = onData;
    let capture = true;
    let output = '';
    const done = inner
      .exec(command, cwd, {
        onData: (chunk) => {
          if (capture) output = (output + chunk.toString()).slice(-SEED_OUTPUT_LIMIT);
          sink(chunk);
        },
        signal: controller.signal,
        env,
      })
      .then((result) => result.exitCode);
    const proc: DetachableProcess = {
      output: () => output,
      pipe: (next) => {
        capture = false;
        sink = next;
      },
      done,
      kill: () => controller.abort(),
    };
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.cause ??= 'aborted';
        controller.abort();
      };
      const { yieldMs, deadlineAt } = this.schedule;
      const deadlineTimer =
        deadlineAt === undefined
          ? undefined
          : setTimeout(
              () => {
                this.cause ??= 'deadline';
                controller.abort();
              },
              Math.max(0, deadlineAt - Date.now())
            );
      const yieldTimer =
        deadlineAt !== undefined && deadlineAt <= Date.now() + yieldMs
          ? undefined
          : setTimeout(() => {
              if (this.cause || this.detach('timeout')) return;
              if (deadlineAt !== undefined) {
                this.owner.onYieldFailed?.(deadlineAt, output);
                return;
              }
              this.cause = 'yield_failed';
              controller.abort();
            }, yieldMs);
      const entry: Running = {
        proc,
        release: (error) => {
          settle();
          reject(error);
        },
      };
      const settle = () => {
        this.running = undefined;
        clearTimeout(deadlineTimer);
        clearTimeout(yieldTimer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.running = entry;
      done.then(
        (exitCode) => {
          if (this.running !== entry) return;
          settle();
          if (this.cause === 'deadline') reject(new Error(`timeout:${timeout}`));
          else if (this.cause === 'yield_failed')
            reject(new Error('yield_failed: background task adoption failed; command stopped'));
          else if (this.cause === 'aborted') reject(new Error('aborted'));
          else resolve({ exitCode });
        },
        (error: unknown) => {
          if (this.running !== entry) return;
          settle();
          reject(
            this.cause === 'deadline'
              ? new Error(`timeout:${timeout}`)
              : this.cause === 'yield_failed'
                ? new Error('yield_failed: background task adoption failed; command stopped')
                : error
          );
        }
      );
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
}

const bound = new WeakMap<AbortSignal, ForegroundCommand>();

/** pi 把工具 execute 的 signal 原样交给 operations.exec，以此把调用关联到 exec */
export function bindForegroundCommand(signal: AbortSignal, command: ForegroundCommand): void {
  bound.set(signal, command);
}

/** Preserve wrapper statistics when the SDK rethrows a timeout after formatting its output. */
export function attachForegroundFailureDetails(
  signal: AbortSignal | undefined,
  details: unknown
): void {
  const foreground = signal && bound.get(signal);
  if (!foreground || !details || typeof details !== 'object' || !('rtk' in details)) return;
  const rtk = parseRtkToolStats(details.rtk);
  if (rtk) foreground.failureDetails = { rtk };
}

/** 包装任意 bash/powershell operations（本地或远程），使登记过的前台调用可移交后台 */
export function withDetachableExec(inner: BashOperations): BashOperations {
  return {
    exec(command, cwd, options) {
      const foreground = options.signal ? bound.get(options.signal) : undefined;
      const timeoutMs = options.timeout === undefined ? undefined : options.timeout * 1000;
      const validTimeout =
        timeoutMs === undefined ||
        (Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2_147_483_647);
      if (!foreground || !validTimeout) return inner.exec(command, cwd, options);
      return foreground.run(inner, command, cwd, options);
    },
  };
}
