import type { EventEmitter } from 'node:events';
import {
  type MainToPluginHost,
  PLUGIN_HOST_APIS,
  type PluginAgentSource,
  type PluginCallMethod,
  type PluginHostApi,
  type PluginRegistrations,
} from '@shared/extensionPlugins/protocol';

export type PluginError = Error & { code: string };
export const pluginError = (code: string, message: string): PluginError =>
  Object.assign(new Error(message), { code });
export type PluginLogLevel = 'info' | 'warn' | 'error';
/** Structural Electron UtilityProcess contract; no platform/headless dependency. */
export interface PluginChild extends EventEmitter {
  postMessage(message: unknown): void;
  kill(): boolean;
}
export interface PluginForkOptions {
  serviceName?: string;
  env?: NodeJS.ProcessEnv;
}
export interface PluginProcessDeps {
  fork(modulePath: string, args: string[], options: PluginForkOptions): PluginChild;
  hostPath: string;
  env: NodeJS.ProcessEnv;
  init: { pluginId: string; pluginRoot: string; main: string; dataDir: string };
  handleHostCall(
    api: PluginHostApi,
    args: unknown,
    invocationId: string | undefined
  ): Promise<unknown>;
  onExit(info: { unexpected: boolean }): void;
  /** 插件进程里的 console / 失败日志；由 Main 落到插件日志文件 */
  onLog?(level: PluginLogLevel, message: string): void;
  idleMs?: number;
  readyTimeoutMs?: number;
  /** 常驻进程：启用即拉起，空闲也不退出 */
  resident?: boolean;
}
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  invocationId: string;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const registrations = (v: unknown): v is PluginRegistrations =>
  record(v) &&
  ['tools', 'commands', 'triggers', 'rendererMethods'].every(
    (k) => Array.isArray(v[k]) && v[k].every((x) => typeof x === 'string')
  ) &&
  ['events', 'schedules', 'exports'].every(
    // 老宿主可能只上报四项；缺省按空处理，出现时必须是字符串数组
    (k) => v[k] === undefined || (Array.isArray(v[k]) && v[k].every((x) => typeof x === 'string'))
  );

/** Dedicated full-trust Node process, NOT a security sandbox. */
export class PluginProcess {
  private child: PluginChild | null = null;
  private readyPromise: Promise<PluginRegistrations> | null = null;
  private rejectReady: ((e: Error) => void) | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly starting = new Set<string>();
  private readonly cancelled = new Set<string>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWait: Promise<void> | null = null;
  private finishStop: (() => void) | null = null;
  private nextId = 1;
  constructor(private readonly deps: PluginProcessDeps) {}
  get running(): boolean {
    return this.child !== null && this.stopWait === null;
  }
  get inflight(): number {
    return this.pending.size + this.starting.size;
  }
  whenStopped(): Promise<void> {
    return this.stopWait ?? Promise.resolve();
  }
  ready(): Promise<PluginRegistrations> {
    if (this.stopWait) return this.stopWait.then(() => this.ready());
    try {
      this.readyPromise ??= this.spawn();
    } catch (error) {
      this.deps.onExit({ unexpected: true });
      throw error;
    }
    return this.readyPromise;
  }
  async call(
    method: PluginCallMethod,
    payload: unknown,
    options: {
      invocationId: string;
      sessionId: string | null;
      projectRoot: string | null;
      /** 来自子会话时的来源；主会话不带 */
      agent?: PluginAgentSource;
      timeoutMs: number;
    }
  ): Promise<unknown> {
    this.starting.add(options.invocationId);
    try {
      await this.ready();
    } finally {
      this.starting.delete(options.invocationId);
    }
    if (this.cancelled.delete(options.invocationId)) throw pluginError('ABORTED', '调用已取消');
    const child = this.child;
    if (!child) throw pluginError('PLUGIN_EXITED', '插件进程已退出');
    this.clearIdle();
    const id = `m${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        this.post({ t: 'cancel', invocationId: options.invocationId });
        reject(pluginError('TIMEOUT', '插件调用超时'));
        this.armIdle();
      }, options.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, invocationId: options.invocationId });
      try {
        child.postMessage({
          t: 'call',
          id,
          method,
          payload,
          invocationId: options.invocationId,
          sessionId: options.sessionId,
          projectRoot: options.projectRoot,
          ...(options.agent ? { agent: options.agent } : {}),
        });
      } catch {
        this.stop();
      }
    });
  }
  cancel(invocationId: string): void {
    if (this.starting.has(invocationId)) this.cancelled.add(invocationId);
    for (const [id, e] of this.pending)
      if (e.invocationId === invocationId) {
        this.pending.delete(id);
        clearTimeout(e.timer);
        e.reject(pluginError('ABORTED', '调用已取消'));
      }
    this.post({ t: 'cancel', invocationId });
    this.armIdle();
  }
  stop(unexpected = false): void {
    const child = this.child;
    if (!child || this.stopWait) return;
    // Revoke calls now, but never allow the next generation to start before exit.
    this.stopWait = new Promise((resolve) => {
      this.finishStop = resolve;
    });
    this.clearIdle();
    this.rejectReady?.(pluginError('PLUGIN_INIT_FAILED', '插件进程在加载期间退出'));
    this.rejectReady = null;
    for (const e of this.pending.values()) {
      clearTimeout(e.timer);
      e.reject(pluginError('PLUGIN_EXITED', '插件进程已退出'));
    }
    this.pending.clear();
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const exit = () => {
      if (killTimer) clearTimeout(killTimer);
      this.cleanup(child, unexpected);
      const finish = this.finishStop;
      this.stopWait = null;
      this.finishStop = null;
      finish?.();
    };
    child.removeAllListeners('exit');
    child.once('exit', exit);
    try {
      child.postMessage({ t: 'shutdown' });
    } catch {
      /* Already exited. */
    }
    killTimer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* Keep waiting: no exit means it is not safe to replace. */
      }
    }, 3000);
    killTimer.unref?.();
    // UtilityProcess kill requests termination; its exit event is authoritative.
    try {
      child.kill();
    } catch {
      /* Already exited. */
    }
  }
  private post(message: MainToPluginHost): void {
    try {
      this.child?.postMessage(message);
    } catch {
      this.stop();
    }
  }
  private cleanup(child: PluginChild, unexpected: boolean): void {
    if (this.child !== child) return;
    this.child = null;
    this.readyPromise = null;
    this.clearIdle();
    this.rejectReady?.(pluginError('PLUGIN_INIT_FAILED', '插件进程在加载期间退出'));
    this.rejectReady = null;
    for (const e of this.pending.values()) {
      clearTimeout(e.timer);
      e.reject(pluginError('PLUGIN_EXITED', '插件进程已退出'));
    }
    this.pending.clear();
    child.removeAllListeners();
    this.deps.onExit({ unexpected });
  }
  private spawn(): Promise<PluginRegistrations> {
    const child = this.deps.fork(this.deps.hostPath, [], {
      serviceName: `enso-plugin-${this.deps.init.pluginId}`,
      env: this.deps.env,
    });
    this.child = child;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      this.rejectReady = fail;
      const timer = setTimeout(() => {
        fail(pluginError('PLUGIN_INIT_FAILED', '插件加载超时'));
        this.stop(true);
      }, this.deps.readyTimeoutMs ?? 10_000);
      child.once('spawn', () => this.post({ t: 'init', ...this.deps.init }));
      child.on('message', (raw: unknown) => {
        if (this.child !== child || this.stopWait || !record(raw)) return;
        if (raw.t === 'ready' && !settled) {
          if (!registrations(raw.registered)) {
            fail(pluginError('PLUGIN_INIT_FAILED', '插件注册表不合法'));
            this.stop(true);
            return;
          }
          settled = true;
          clearTimeout(timer);
          this.rejectReady = null;
          resolve(raw.registered);
          this.armIdle();
          return;
        }
        if (raw.t === 'init-error') {
          fail(
            pluginError(
              'PLUGIN_INIT_FAILED',
              typeof raw.message === 'string' ? raw.message : '加载失败'
            )
          );
          this.stop(true);
          return;
        }
        this.onMessage(raw, child);
      });
      child.once('exit', () => this.cleanup(child, true));
    });
  }
  private onMessage(m: Record<string, unknown>, child: PluginChild): void {
    if (m.t === 'log') {
      const level: PluginLogLevel =
        m.level === 'warn' || m.level === 'error' || m.level === 'info' ? m.level : 'info';
      this.deps.onLog?.(level, typeof m.message === 'string' ? m.message : '');
      return;
    }
    if (m.t === 'res' && typeof m.id === 'string') {
      const e = this.pending.get(m.id);
      if (!e) return;
      this.pending.delete(m.id);
      clearTimeout(e.timer);
      if (m.ok === true) e.resolve(m.value);
      else {
        const error = record(m.error) ? m.error : {};
        e.reject(
          pluginError(
            typeof error.code === 'string' ? error.code : 'PLUGIN_ERROR',
            typeof error.message === 'string' ? error.message : '插件调用失败'
          )
        );
      }
      this.armIdle();
      return;
    }
    if (m.t !== 'call' || typeof m.id !== 'string') return;
    const id = m.id;
    const reply = (message: MainToPluginHost) => {
      if (this.child === child && !this.stopWait) this.post(message);
    };
    if (!(PLUGIN_HOST_APIS as readonly unknown[]).includes(m.api)) {
      reply({ t: 'res', id, ok: false, error: { code: 'UNKNOWN_API', message: '未知宿主接口' } });
      return;
    }
    Promise.resolve()
      .then(() =>
        this.child !== child || this.stopWait
          ? Promise.reject(pluginError('PLUGIN_EXITED', '插件进程已退出'))
          : this.deps.handleHostCall(
              m.api as PluginHostApi,
              m.args,
              typeof m.invocationId === 'string' ? m.invocationId : undefined
            )
      )
      .then(
        (value) => reply({ t: 'res', id, ok: true, value }),
        (error: unknown) =>
          reply({
            t: 'res',
            id,
            ok: false,
            error: {
              code:
                error instanceof Error && 'code' in error && typeof error.code === 'string'
                  ? error.code
                  : 'HOST_ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
          })
      );
  }
  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
  private armIdle(): void {
    this.clearIdle();
    if (this.deps.resident || this.pending.size || this.starting.size || !this.child) return;
    this.idleTimer = setTimeout(() => this.stop(), this.deps.idleMs ?? 300_000);
    this.idleTimer.unref?.();
  }
}
