import { randomUUID } from 'node:crypto';
import type { ComposerOp, SessionUiOp } from './gate';
import { pluginError } from './process';
export interface DraftSink {
  id: number;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}
interface Pending {
  origin: number;
  resolve(v: unknown): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
export class DraftBroker {
  private readonly pending = new Map<string, Pending>();
  constructor(
    private readonly deps: {
      channel: string;
      find(id: number): DraftSink | null;
      timeoutMs?: number;
    }
  ) {}
  get pendingCount(): number {
    return this.pending.size;
  }
  request(
    origin: number | null,
    sessionId: string,
    op: ComposerOp | SessionUiOp,
    payload: Record<string, unknown>,
    /** 会话类操作（新建 / 唤起 / 打开插件页面）冷启动更慢，调用方可以放宽 */
    timeoutMs = this.deps.timeoutMs ?? 5000
  ): Promise<unknown> {
    const sink = origin === null ? null : this.deps.find(origin);
    if (origin === null || !sink || sink.isDestroyed())
      return Promise.reject(pluginError('NO_COMPOSER', '发起窗口不可用'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(pluginError('TIMEOUT', '输入框没有响应'));
      }, timeoutMs);
      this.pending.set(requestId, { origin, resolve, reject, timer });
      try {
        sink.send(this.deps.channel, { requestId, sessionId, op, payload });
      } catch {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(pluginError('NO_COMPOSER', '窗口不可用'));
      }
    });
  }
  respond(senderId: number, raw: unknown): void {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('requestId' in raw) ||
      typeof raw.requestId !== 'string'
    )
      return;
    const p = this.pending.get(raw.requestId);
    if (!p || p.origin !== senderId) return;
    this.pending.delete(raw.requestId);
    clearTimeout(p.timer);
    const r = raw as Record<string, unknown>;
    if (r.ok === true) p.resolve(r.value ?? null);
    else
      p.reject(
        pluginError(
          typeof r.code === 'string' ? r.code.slice(0, 64) : 'DRAFT_FAILED',
          typeof r.error === 'string' ? r.error.slice(0, 500) : '草稿操作失败'
        )
      );
  }
  releaseOwner(origin: number): void {
    for (const [id, p] of this.pending)
      if (p.origin === origin) {
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.reject(pluginError('ABORTED', '窗口已关闭'));
      }
  }
  dispose(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(pluginError('ABORTED', '应用已关闭'));
    }
    this.pending.clear();
  }
}
