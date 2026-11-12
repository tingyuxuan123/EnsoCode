import { randomUUID } from 'node:crypto';
import type {
  DesignErrorCode,
  DesignHookEvent,
  DesignRuntimeRegistration,
  DesignToolContent,
  DesignToolName,
  DesignToolResult,
} from '@shared/types/design';
import { IPC_CHANNELS } from '@shared/types/ipc';

export interface DesignRuntimeSink {
  id: number;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
}

export class DesignToolError extends Error {
  constructor(
    readonly code: DesignErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DesignToolError';
  }
}

export interface DesignToolCall {
  sessionId: string;
  /** 由调用方从会话权威记录推导，不采信 worker / renderer。 */
  cwd: string;
  /** Bot 聊天归属同样由 Main 推导，不能按相同 cwd 猜测。 */
  botChatId?: string;
  tool: DesignToolName;
  params: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
}

interface Pending {
  origin: number;
  resolve(result: DesignToolResult): void;
  reject(error: DesignToolError): void;
}

interface Runtime {
  viewingSessionId: string | null;
  /** 最近一次登记的顺序号；同条件多个窗口时取最新。 */
  order: number;
  /**
   * 独立设计窗口：由 Main 按窗口绑定的会话登记，只服务那一个会话。
   * 它优先于正在看同一会话的主窗口，且绝不作为其它会话的兜底。
   */
  dedicated: boolean;
}

/** 单次工具结果的总量上限（图片 base64 计入）。 */
const MAX_RESULT_CHARS = 32 * 1024 * 1024;

/**
 * worker 的 vetd_* 工具调用经 Main 转给 Renderer 设计运行时执行（设计稿 D1）。
 * 路由：绑定该会话的独立设计窗口 → 正在看该会话的窗口 → 主窗口 → 最近登记的普通窗口。
 * 只认被询问窗口的回复。
 */
export class DesignToolBroker {
  private readonly runtimes = new Map<number, Runtime>();
  private readonly pending = new Map<string, Pending>();
  private order = 0;

  constructor(
    private readonly deps: {
      find(id: number): DesignRuntimeSink | null;
      fallbackId(): number | null;
    }
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  register(senderId: number, registration: DesignRuntimeRegistration, dedicated = false): void {
    this.runtimes.set(senderId, {
      viewingSessionId: registration.viewingSessionId,
      order: ++this.order,
      dedicated,
    });
  }

  hasRuntime(): boolean {
    return this.pick(null) !== null;
  }

  request(call: DesignToolCall): Promise<DesignToolResult> {
    if (call.signal?.aborted)
      return Promise.reject(new DesignToolError('ABORTED', 'Design tool call aborted'));
    const target = this.pick(call.sessionId);
    if (!target)
      return Promise.reject(
        new DesignToolError('NO_RUNTIME', 'Design runtime is not available; open Collabra window')
      );
    const requestId = randomUUID();
    const { promise, resolve, reject } = Promise.withResolvers<DesignToolResult>();
    const cancelRemote = () => {
      try {
        if (!target.isDestroyed()) target.send(IPC_CHANNELS.DESIGN_TOOL_CANCEL, { requestId });
      } catch {
        // 窗口已不可用，运行时随窗口一起消失。
      }
    };
    const timer = setTimeout(() => {
      if (!settle()) return;
      cancelRemote();
      reject(
        new DesignToolError(
          'TIMEOUT',
          `Design tool ${call.tool} timed out after ${call.timeoutMs}ms`
        )
      );
    }, call.timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      if (!settle()) return;
      cancelRemote();
      reject(new DesignToolError('ABORTED', 'Design tool call aborted'));
    };
    const settle = () => {
      if (!this.pending.delete(requestId)) return false;
      clearTimeout(timer);
      call.signal?.removeEventListener('abort', onAbort);
      return true;
    };
    this.pending.set(requestId, {
      origin: target.id,
      resolve: (result) => settle() && resolve(result),
      reject: (error) => settle() && reject(error),
    });
    call.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      target.send(IPC_CHANNELS.DESIGN_TOOL_REQUEST, {
        requestId,
        tool: call.tool,
        params: call.params,
        session: {
          sessionId: call.sessionId,
          cwd: call.cwd,
          ...(call.botChatId ? { botChatId: call.botChatId } : {}),
        },
      });
    } catch {
      this.pending
        .get(requestId)
        ?.reject(new DesignToolError('NO_RUNTIME', 'Design window unavailable'));
    }
    return promise;
  }

  /** Renderer 回复；入参不可信。未知 requestId / 非原窗口一律丢弃。 */
  respond(senderId: number, raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false;
    const value = raw as Record<string, unknown>;
    if (typeof value.requestId !== 'string') return false;
    const entry = this.pending.get(value.requestId);
    if (!entry || entry.origin !== senderId) return false;
    if (value.ok === true) {
      const result = parseToolResult(value.result);
      if (result) entry.resolve(result);
      else
        entry.reject(new DesignToolError('FAILED', 'Design runtime returned a malformed result'));
    } else {
      const message =
        typeof value.error === 'string' && value.error
          ? value.error.slice(0, 4000)
          : 'Design tool failed';
      entry.reject(new DesignToolError('FAILED', message));
    }
    return true;
  }

  /** 历史自动提交等会话 hook：只投给一个运行时，避免重复提交。 */
  emitHook(event: DesignHookEvent): boolean {
    const target = this.pick(event.sessionId);
    if (!target) return false;
    try {
      target.send(IPC_CHANNELS.DESIGN_HOOK, event);
      return true;
    } catch {
      return false;
    }
  }

  releaseOwner(senderId: number): void {
    this.runtimes.delete(senderId);
    for (const entry of [...this.pending.values()])
      if (entry.origin === senderId)
        entry.reject(
          new DesignToolError('NO_RUNTIME', 'Design window closed during the tool call')
        );
  }

  dispose(): void {
    for (const entry of [...this.pending.values()])
      entry.reject(new DesignToolError('ABORTED', 'Application is quitting'));
    this.runtimes.clear();
  }

  private pick(sessionId: string | null): DesignRuntimeSink | null {
    const live: Array<[DesignRuntimeSink, Runtime]> = [];
    for (const [id, runtime] of this.runtimes) {
      const target = this.deps.find(id);
      if (target && !target.isDestroyed()) live.push([target, runtime]);
    }
    if (live.length === 0) return null;
    const newest = (list: Array<[DesignRuntimeSink, Runtime]>) =>
      list.reduce((a, b) => (b[1].order > a[1].order ? b : a))[0];
    const viewing = sessionId ? live.filter(([, r]) => r.viewingSessionId === sessionId) : [];
    const dedicated = viewing.filter(([, r]) => r.dedicated);
    if (dedicated.length) return newest(dedicated);
    if (viewing.length) return newest(viewing);
    const shared = live.filter(([, r]) => !r.dedicated);
    if (shared.length === 0) return null;
    const fallbackId = this.deps.fallbackId();
    const fallback = shared.find(([target]) => target.id === fallbackId);
    return fallback ? fallback[0] : newest(shared);
  }
}

function parseToolResult(raw: unknown): DesignToolResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.content)) return null;
  const content: DesignToolContent[] = [];
  let total = 0;
  for (const item of value.content) {
    if (!item || typeof item !== 'object') return null;
    const part = item as Record<string, unknown>;
    if (part.type === 'text' && typeof part.text === 'string') {
      total += part.text.length;
      content.push({ type: 'text', text: part.text });
    } else if (
      part.type === 'image' &&
      typeof part.data === 'string' &&
      typeof part.mimeType === 'string' &&
      /^image\/(png|jpeg|webp|gif)$/.test(part.mimeType)
    ) {
      total += part.data.length;
      content.push({ type: 'image', data: part.data, mimeType: part.mimeType });
    } else return null;
    if (total > MAX_RESULT_CHARS) return null;
  }
  return 'details' in value ? { content, details: value.details } : { content };
}
