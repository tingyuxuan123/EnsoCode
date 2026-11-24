import type { HostToPhone, PhoneToHost } from '@enso/pair';

/**
 * 会话图片（read / 生成图片）的手机端端口：
 * 手机只发 sessionId + 工作区相对路径，host 按权威根解析并压到单帧预算内回 data URL。
 * 同 key 去重请求、内存缓存、失败可按 key 重试、断线统一失败。
 */

type Frame = Extract<HostToPhone, { type: 'session-image-result' }>;
export type SessionImageLoad = { dataUrl: string } | { error: string };
export type SessionImageTarget =
  | { kind: 'workspace'; rel: string }
  | { kind: 'tool-call'; id: string };

const IMAGE_DATA_URL =
  /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|bmp|avif|x-icon);base64,[A-Za-z0-9+/=]+$/;
/** host 侧错误码；未知值按 failed 报，不把原始字符串塞进界面 */
const ERRORS = new Set([
  'invalid',
  'unavailable',
  'not-found',
  'unsupported',
  'too-large',
  'changed',
]);

/**
 * 缓存 key：会话 id + 执行目录（scope，仅本地缓存判别，不上行）+ 相对路径。
 * 会话换了工作树/目录时天然 miss，不会把旧目录的像素当成同一张图。
 */
const normalizeTarget = (target: SessionImageTarget | string): SessionImageTarget =>
  typeof target === 'string' ? { kind: 'workspace', rel: target } : target;

const targetKey = (target: SessionImageTarget): string =>
  target.kind === 'workspace' ? `workspace:${target.rel}` : `tool-call:${target.id}`;

export const sessionImageKey = (
  sessionId: string,
  target: SessionImageTarget | string,
  scope = ''
): string => `${sessionId}|${scope}|${targetKey(normalizeTarget(target))}`;

/** 缓存成功图的条数上限：超了按插入顺序丢最早的（手机内存有限） */
const CACHE_LIMIT = 24;

export class SessionImagePort {
  private readonly cache = new Map<string, SessionImageLoad>();
  private readonly waiters = new Map<string, ((result: SessionImageLoad) => void)[]>();
  private readonly requests = new Map<string, { key: string; gen: number }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly generations = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly send: (command: PhoneToHost) => unknown,
    private readonly timeoutMs = 30_000
  ) {}

  /** 已拿到的图（只缓存成功：失败要能重试）；没有则 undefined */
  peek(
    sessionId: string,
    target: SessionImageTarget | string,
    scope = ''
  ): SessionImageLoad | undefined {
    return this.cache.get(sessionImageKey(sessionId, target, scope));
  }

  /**
   * 作废某个 key 的缓存（同张图被覆盖、解码失败、目录换代）。
   * 用代次号作废在途请求：旧回包到达时不能再重新填进缓存。
   */
  evict(sessionId: string, target: SessionImageTarget | string, scope = ''): void {
    const key = sessionImageKey(sessionId, target, scope);
    this.generations.set(key, this.generation(key) + 1);
    this.cache.delete(key);
    for (const [requestId, entry] of [...this.requests]) {
      if (entry.key !== key) continue;
      const timer = this.timers.get(requestId);
      if (timer) clearTimeout(timer);
      this.timers.delete(requestId);
      this.requests.delete(requestId);
    }
    const pending = this.waiters.get(key);
    this.waiters.delete(key);
    // 在途请求已经作废：让等待方拿到可重试的失败，而不是永久挂起
    for (const settle of pending ?? []) settle({ error: 'changed' });
  }

  load(
    sessionId: string,
    rawTarget: SessionImageTarget | string,
    scope = ''
  ): Promise<SessionImageLoad> {
    const target = normalizeTarget(rawTarget);
    const key = sessionImageKey(sessionId, target, scope);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const queued = this.waiters.get(key);
    if (queued) return new Promise((resolve) => queued.push(resolve));
    const requestId = `img-${++this.seq}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve) => {
      this.requests.set(requestId, { key, gen: this.generation(key) });
      this.waiters.set(key, [resolve]);
      this.timers.set(
        requestId,
        setTimeout(() => this.settle(requestId, { error: 'timeout' }), this.timeoutMs)
      );
      try {
        // 宿主明确表示「没发出去」（未连接）时立刻失败，不等超时
        const command: PhoneToHost =
          target.kind === 'workspace'
            ? { type: 'session-image', requestId, sessionId, rel: target.rel }
            : { type: 'session-image', requestId, sessionId, toolCallId: target.id };
        if (this.send(command) === false) this.settle(requestId, { error: 'offline' });
      } catch {
        this.settle(requestId, { error: 'failed' });
      }
    });
  }

  receive(frame: Frame): void {
    const entry = this.requests.get(frame.requestId);
    if (!entry) return;
    if (frame.dataUrl && IMAGE_DATA_URL.test(frame.dataUrl)) {
      this.settle(frame.requestId, { dataUrl: frame.dataUrl });
      return;
    }
    this.settle(frame.requestId, {
      error: typeof frame.error === 'string' && ERRORS.has(frame.error) ? frame.error : 'failed',
    });
  }

  /** 断线/换设备：在途请求统一失败并清缓存，避免把旧会话的像素留给新会话 */
  reset(error = 'offline'): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.requests.clear();
    for (const waiters of this.waiters.values()) for (const settle of waiters) settle({ error });
    this.waiters.clear();
    this.cache.clear();
    this.generations.clear();
  }

  private generation(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  private settle(requestId: string, result: SessionImageLoad): void {
    const timer = this.timers.get(requestId);
    if (timer) clearTimeout(timer);
    this.timers.delete(requestId);
    const entry = this.requests.get(requestId);
    if (!entry) return;
    this.requests.delete(requestId);
    // 代次变了 = 这次应答已被 evict 作废：不落缓存，也不喂给新一次请求的等待者
    if (entry.gen !== this.generation(entry.key)) return;
    // 只缓存成功：加载失败必须能重试，不能把一次坏结果钉死
    if ('dataUrl' in result) this.remember(entry.key, result);
    const waiters = this.waiters.get(entry.key) ?? [];
    this.waiters.delete(entry.key);
    for (const settle of waiters) settle(result);
  }

  /** 缓存成功图；超过上限按插入顺序丢最早的，避免长会话把内存吃满 */
  private remember(key: string, result: SessionImageLoad): void {
    this.cache.set(key, result);
    if (this.cache.size <= CACHE_LIMIT) return;
    for (const oldest of this.cache.keys()) {
      if (oldest === key) continue;
      this.cache.delete(oldest);
      break;
    }
  }
}
