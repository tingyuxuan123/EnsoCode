import type { HostToPhone, PhoneToHost } from '@enso/pair';

/**
 * 会话图片（read / 生成图片）的手机端端口：
 * 手机只发 sessionId + 工作区相对路径，host 按权威根解析并压到单帧预算内回 data URL。
 * 与 botArtifactsPort 同构：同 key 去重请求、内存缓存、失败可按 key 重试、断线统一失败。
 */

type Frame = Extract<HostToPhone, { type: 'session-image-result' }>;
export type SessionImageLoad = { dataUrl: string } | { error: string };

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

export const sessionImageKey = (sessionId: string, rel: string): string => `${sessionId}|${rel}`;

export class SessionImagePort {
  private readonly cache = new Map<string, SessionImageLoad>();
  private readonly waiters = new Map<string, ((result: SessionImageLoad) => void)[]>();
  private readonly requests = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;

  constructor(
    private readonly send: (command: PhoneToHost) => unknown,
    private readonly timeoutMs = 30_000
  ) {}

  /** 已拿到的图（只缓存成功：失败要能重试）；没有则 undefined */
  peek(sessionId: string, rel: string): SessionImageLoad | undefined {
    return this.cache.get(sessionImageKey(sessionId, rel));
  }

  load(sessionId: string, rel: string): Promise<SessionImageLoad> {
    const key = sessionImageKey(sessionId, rel);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const queued = this.waiters.get(key);
    if (queued) return new Promise((resolve) => queued.push(resolve));
    const requestId = `img-${++this.seq}-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve) => {
      this.requests.set(requestId, key);
      this.waiters.set(key, [resolve]);
      this.timers.set(
        requestId,
        setTimeout(() => this.settle(requestId, { error: 'timeout' }), this.timeoutMs)
      );
      try {
        this.send({ type: 'session-image', requestId, sessionId, rel });
      } catch {
        this.settle(requestId, { error: 'failed' });
      }
    });
  }

  receive(frame: Frame): void {
    const key = this.requests.get(frame.requestId);
    if (!key) return;
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
  }

  private settle(requestId: string, result: SessionImageLoad): void {
    const timer = this.timers.get(requestId);
    if (timer) clearTimeout(timer);
    this.timers.delete(requestId);
    const key = this.requests.get(requestId);
    if (!key) return;
    this.requests.delete(requestId);
    // 只缓存成功：加载失败必须能重试，不能把一次坏结果钉死
    if ('dataUrl' in result) this.cache.set(key, result);
    const waiters = this.waiters.get(key) ?? [];
    this.waiters.delete(key);
    for (const settle of waiters) settle(result);
  }
}
